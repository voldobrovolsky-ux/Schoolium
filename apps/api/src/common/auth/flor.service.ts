import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Issuer, generators, type Client, type TokenSet } from 'openid-client';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { PrismaService } from '../prisma/prisma.service';

export interface SessionUser {
  florusUserId: string;
  workspaceId: string | null; // активный тенант = школа (ключ изоляции)
  florusWorkspaceId: string | null; // claim workspace_id
  florusOrgId: string | null; // платформенная org (flor:org) — не тенант
  role: string; // доменная роль: teacher|student|parent|staff
  subRole: string | null;
  name: string;
  orgName?: string; // отображаемое имя школы (Workspace.name)
  /**
   * Роли Schoolium 1.1.1 (AR-60): совмещение выражается массивом, а не строкой.
   * Заполняется контуром доступа версии (AppSession); у legacy-сессий OIDC пусто,
   * и резолв доступа падает обратно на (role, subRole) — старый контур не ломается.
   */
  roles?: string[];
}

interface FlorOrg { org_id: string; org_name?: string; role: string }
// tx переживает редирект в Флёрус и обратно (cookie). next/subRole — подсказки онбординга
// из continue-URL агентского инвайта: куда вернуть и какую staff-подроль назначить.
interface AuthTx { code_verifier: string; state: string; nonce: string; next?: string; subRole?: string | null }

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

/**
 * Флёрус OIDC RP (BFF, ADR-0005). Confidential-клиент: api держит секрет/токены,
 * SPA — httpOnly-сессию. Конфиг — из discovery. Lazy-provision локальной орг
 * и членства из claims — онбординг НЕ зависит от события покупки (см. docs/ONBOARDING.md).
 */
@Injectable()
export class FlorService {
  private readonly log = new Logger('Florus');
  private clientPromise?: Promise<Client>;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly prisma: PrismaService) {}

  private get issuer(): string {
    return process.env.FLOR_ISSUER ?? 'https://accounts.flor-group.ru';
  }

  // discovery — лениво (чтобы приложение поднималось без доступа к Флёрусу)
  private getClient(): Promise<Client> {
    if (!this.clientPromise) {
      this.clientPromise = Issuer.discover(this.issuer).then(
        (iss) =>
          new iss.Client({
            client_id: process.env.FLOR_CLIENT_ID ?? 'edustore',
            client_secret: process.env.FLOR_CLIENT_SECRET,
            redirect_uris: [process.env.FLOR_REDIRECT_URI!],
            post_logout_redirect_uris: [
              process.env.FLOR_POST_LOGOUT_REDIRECT_URI ?? 'https://edustore-flor-group.ru',
            ],
            response_types: ['code'],
            token_endpoint_auth_method: 'client_secret_basic',
          }),
      );
    }
    return this.clientPromise;
  }

  private getJwks() {
    if (!this.jwks) this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
    return this.jwks;
  }

  /** Шаг 1 — URL авторизации + транзакция (PKCE/state/nonce + подсказки онбординга). */
  async buildAuthUrl(opts?: { next?: string; subRole?: string | null }): Promise<{ url: string; tx: AuthTx }> {
    const client = await this.getClient();
    const code_verifier = generators.codeVerifier();
    const code_challenge = generators.codeChallenge(code_verifier);
    const state = generators.state();
    const nonce = generators.nonce();
    const scope = process.env.FLOR_SCOPES ?? 'openid profile phone flor:org flor:roles flor:workspace offline_access';
    const url = client.authorizationUrl({ scope, code_challenge, code_challenge_method: 'S256', state, nonce });
    return { url, tx: { code_verifier, state, nonce, next: opts?.next, subRole: opts?.subRole ?? null } };
  }

  /** Шаг 2 — обмен кода, верификация id_token (openid-client), provision, сессия. */
  async handleCallback(req: unknown, tx: AuthTx): Promise<{ sid: string; next?: string }> {
    const client = await this.getClient();
    const params = client.callbackParams(req as never);
    const tokenSet = await client.callback(process.env.FLOR_REDIRECT_URI!, params, {
      code_verifier: tx.code_verifier,
      state: tx.state,
      nonce: tx.nonce,
    });
    const claims = tokenSet.claims();
    let userinfo: Record<string, unknown> = {};
    try {
      if (tokenSet.access_token) userinfo = await client.userinfo(tokenSet.access_token);
    } catch {
      /* userinfo опционален */
    }
    const { sid } = await this.provision({ ...userinfo, ...claims }, tokenSet, tx.subRole);
    return { sid, next: tx.next };
  }

  private async provision(
    c: Record<string, unknown>,
    tokenSet: TokenSet,
    subRoleHint?: string | null,
  ): Promise<{ sid: string }> {
    const sub = String(c.sub);
    const fullName = String(c.name ?? c.preferred_username ?? 'Пользователь');
    const [last = '', first = ''] = fullName.split(/\s+/);
    await this.prisma.user.upsert({
      where: { id: sub },
      update: { displayName: fullName, email: (c.email as string) ?? undefined },
      create: { id: sub, firstName: first || fullName, lastName: last, displayName: fullName, email: (c.email as string) ?? undefined },
    });

    // ДОМЕННАЯ роль (teacher|student|parent|staff) — из florus_orgs[].role/org_role.
    // admin/owner — tenancy-роли (RoleAssignment Флёра), в токен не приходят (канон §7.4).
    const orgs = (c.florus_orgs as FlorOrg[] | undefined) ?? [];
    const activeFlorOrg = (c.org_id as string) ?? orgs[0]?.org_id ?? null; // платформенная org Флёра
    const activeOrg = orgs.find((o) => o.org_id === activeFlorOrg) ?? orgs[0];
    const role = (c.org_role as string) ?? activeOrg?.role ?? 'teacher';
    // ШКОЛА = workspace из claim workspace_id (flor:workspace). Fallback на org — переходный период.
    const florusWorkspaceId = (c.workspace_id as string) ?? activeFlorOrg ?? null;
    const workspaceName =
      (c.workspace_name as string) ?? (c.org_name as string) ?? activeOrg?.org_name ?? 'Школа';
    this.log.log(
      `provision sub=${sub} role=${role} workspace=${florusWorkspaceId ?? '—'} org=${activeFlorOrg ?? '—'}`,
    );

    let workspaceId: string | null = null;
    let subRole: string | null = null;
    if (florusWorkspaceId) {
      // платформа EduStore — singleton (арендатор у Флёра, org_type=platform)
      const platform = await this.prisma.organization.upsert({
        where: { id: 'org-edustore-platform' },
        update: { florusOrgId: activeFlorOrg ?? undefined },
        create: { id: 'org-edustore-platform', florusOrgId: activeFlorOrg, name: (c.org_name as string) ?? 'EduStore', type: 'platform', status: 'active' },
      });
      // школа (Workspace) — зеркало Flör workspace; worknet — СТАБ (florus_worknets[] = P1 Флёра)
      const ws = await this.prisma.workspace.upsert({
        where: { florusWorkspaceId },
        update: { name: workspaceName },
        create: { florusWorkspaceId, orgId: platform.id, name: workspaceName, status: 'active' },
      });
      workspaceId = ws.id;
      if (role === 'staff') {
        const existing = await this.prisma.membership.findUnique({
          where: { florusUserId_workspaceId: { florusUserId: sub, workspaceId: ws.id } },
        });
        // приоритет: уже назначенная админом → подсказка онбординга → дефолт (повторный вход
        // по старой ссылке не перетирает роль).
        subRole = existing?.subRole ?? subRoleHint ?? 'methodist';
      }
      await this.prisma.membership.upsert({
        where: { florusUserId_workspaceId: { florusUserId: sub, workspaceId: ws.id } },
        update: { florusRole: role, subRole },
        create: { florusUserId: sub, workspaceId: ws.id, florusRole: role, subRole },
      });
    }

    const sid = randomBytes(24).toString('base64url');
    await this.prisma.session.create({
      data: {
        sid,
        florusUserId: sub,
        florusSid: (c.sid as string) ?? null,
        workspaceId,
        florusWorkspaceId,
        florusOrgId: activeFlorOrg,
        role,
        subRole,
        name: fullName,
        accessToken: tokenSet.access_token,
        refreshToken: tokenSet.refresh_token,
        idToken: tokenSet.id_token,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return { sid };
  }

  /**
   * Device Authorization Flow (RFC 8628), purpose=login — киоск показывает QR,
   * учитель подтверждает вход с телефона. Возвращает данные для QR; device_code
   * хранит вызывающий (DeviceService) и опрашивает pollDeviceToken().
   */
  async deviceAuthorize(): Promise<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval: number;
  }> {
    const client = await this.getClient();
    const scope = process.env.FLOR_SCOPES ?? 'openid profile phone flor:org flor:roles flor:workspace offline_access';
    const handle = await client.deviceAuthorization({ scope });
    // interval не выведен в публичный тип DeviceFlowHandle; берём из рантайма, дефолт RFC 8628 — 5с
    const interval = (handle as unknown as { interval?: number }).interval ?? 5;
    return {
      device_code: handle.device_code,
      user_code: handle.user_code,
      verification_uri: handle.verification_uri,
      verification_uri_complete: handle.verification_uri_complete,
      expires_in: handle.expires_in,
      interval,
    };
  }

  /**
   * Опрос токен-эндпоинта по device_code. null — пока ожидаем подтверждения
   * (authorization_pending / slow_down). При успехе — provision + sid сессии.
   */
  async pollDeviceToken(deviceCode: string): Promise<{ sid: string } | null> {
    const client = await this.getClient();
    try {
      const tokenSet = await client.grant({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
      });
      const claims = tokenSet.claims();
      let userinfo: Record<string, unknown> = {};
      try {
        if (tokenSet.access_token) userinfo = await client.userinfo(tokenSet.access_token);
      } catch {
        /* userinfo опционален */
      }
      return this.provision({ ...userinfo, ...claims }, tokenSet);
    } catch (e) {
      const err = (e as { error?: string })?.error;
      if (err === 'authorization_pending' || err === 'slow_down') return null;
      throw e;
    }
  }

  /** Сессия по cookie sid (со скользящим продлением). */
  async getSession(sid: string): Promise<SessionUser | null> {
    const s = await this.prisma.session.findUnique({ where: { sid } });
    if (!s || s.expiresAt < new Date()) return null;
    void this.prisma.session
      .update({ where: { sid }, data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) } })
      .catch(() => undefined);
    let orgName: string | undefined;
    if (s.workspaceId) orgName = (await this.prisma.workspace.findUnique({ where: { id: s.workspaceId } }))?.name;
    return {
      florusUserId: s.florusUserId,
      workspaceId: s.workspaceId,
      florusWorkspaceId: s.florusWorkspaceId,
      florusOrgId: s.florusOrgId,
      role: s.role,
      subRole: s.subRole,
      name: s.name,
      orgName,
    };
  }

  /** RP-initiated logout: URL end-session + удаление локальной сессии. */
  async buildLogoutUrl(sid: string | undefined): Promise<string> {
    const fallback = process.env.FLOR_POST_LOGOUT_REDIRECT_URI ?? '/';
    if (!sid) return fallback;
    const s = await this.prisma.session.findUnique({ where: { sid } });
    await this.prisma.session.delete({ where: { sid } }).catch(() => undefined);
    if (!s?.idToken) return fallback;
    try {
      const client = await this.getClient();
      return client.endSessionUrl({ id_token_hint: s.idToken, post_logout_redirect_uri: fallback });
    } catch {
      return fallback;
    }
  }

  /** Back-channel logout: верификация logout_token и убийство локальных сессий. */
  async handleBackchannel(token: string): Promise<void> {
    const { payload } = await jwtVerify(token, this.getJwks(), {
      issuer: this.issuer,
      audience: process.env.FLOR_CLIENT_ID ?? 'edustore',
    });
    const events = (payload as JWTPayload & { events?: Record<string, unknown>; nonce?: string }).events;
    if (!events?.['http://schemas.openid.net/event/backchannel-logout']) throw new Error('not a logout event');
    if ('nonce' in payload && payload.nonce) throw new Error('logout token must not carry nonce');
    const sub = payload.sub;
    const sid = (payload as JWTPayload & { sid?: string }).sid;
    if (!sub && !sid) throw new Error('no subject');
    if (sid) await this.prisma.session.deleteMany({ where: { florusSid: sid } });
    else if (sub) await this.prisma.session.deleteMany({ where: { florusUserId: sub } });
  }
}
