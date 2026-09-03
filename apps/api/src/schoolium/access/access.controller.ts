import { Body, Controller, Delete, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ACCESS_PARAMS, safeNext, startScreenFor, type MeDto, type SchoolRole, type SessionDto } from '@edustore/shared';
import { Public } from '../../common/auth/public.decorator';
import type { SessionUser } from '../../common/auth/flor.service';
import { SCHOOL_COOKIE, schoolCookieOptions, SchoolSessionService } from '../../common/auth/school-session.service';
import { AuthzService } from '../../common/authz/authz.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { AccessService, type SessionClient } from './access.service';
import { clientIp } from './client-ip';
import { SchoolStateService } from '../school-state.service';
import { SchoolError } from '../schoolium.errors';

type Req0 = Request & { user?: SessionUser; sessionId?: string };

const deviceHint = (req: Request): string => {
  const ua = String(req.headers['user-agent'] ?? '');
  const browser = /Firefox/.test(ua) ? 'Firefox' : /Edg/.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'браузер';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
};

/**
 * Что HTTP-запрос знает об устройстве (AR-187) — ОДНА функция на все маршруты,
 * выдающие сессию (входы `v1/auth/*`, активация `staff/join/:token`):
 *   · `clientKind` — заголовок `x-schoolium-client: pwa` ставит установленное
 *     приложение; всё остальное — вкладка браузера;
 *   · `ip` — из `x-forwarded-for` с конца, отступив `TRUSTED_PROXY_HOPS`
 *     доверенных прокси (`clientIp`): первый элемент дописывает сам клиент,
 *     и верить ему нельзя; заголовка нет — адрес сокета. Обрезан до 45
 *     знаков — длина IPv6 с зоной, а не «сколько пришлёт прокси».
 */
export function clientOf(req: Request): SessionClient {
  const kind = String(req.headers['x-schoolium-client'] ?? '').trim().toLowerCase();
  const ip = clientIp(req.headers['x-forwarded-for'], req.socket?.remoteAddress);
  return {
    deviceHint: deviceHint(req),
    clientKind: kind === 'pwa' ? 'pwa' : 'browser',
    ip: ip ? ip.slice(0, 45) : null,
  };
}

/**
 * Контур входа (`S-00`, `S-01`, `S-05`, `S-80`). Мутации 1, 2, 3, 36, 38 из
 * `70-screens.md` §11 плюс чтения без собственной мутации: статус токена
 * привязки (поллинг раз в 2 секунды, AR-87) и список сессий.
 *
 * Гейты здесь не по каталогу прав, а по владению: строка 1 — аноним (страница
 * входа), 2 — сессия якорного устройства, 3 и 38 — владелец сессии, 36 — аноним
 * с одноразовым кодом. Причины перечислены в whitelist ворот G-10.
 */
@Controller('v1/auth')
export class SchoolAuthController {
  constructor(
    private readonly access: AccessService,
    private readonly sessions: SchoolSessionService,
    private readonly authz: AuthzService,
    private readonly prisma: PrismaService,
    private readonly state: SchoolStateService,
  ) {}

  private setCookie(res: Response, token: string): void {
    // maxAge и path живут в schoolCookieOptions() — одно место на все маршруты.
    res.cookie(SCHOOL_COOKIE, token, schoolCookieOptions());
  }

  /** §11 строка 1 · `S-01`: страница входа заводит токен привязки (аноним). */
  @Public()
  @Post('device-link/token')
  async deviceLinkToken(@Body() body: { next?: string }) {
    const next = safeNext(body?.next ?? null, '');
    const t = await this.access.createDeviceLinkToken(next || null);
    return { id: t.id, token: t.token, status: 'waiting', expiresAt: t.expiresAt.toISOString() };
  }

  /** Поллинг статуса раз в 2 секунды (AR-87); успех — сессия и редирект на `next`. */
  @Public()
  @Get('device-link/token/:id')
  async deviceLinkStatus(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const r = await this.access.deviceLinkStatus(id);
    if (r.status === 'used' && r.sessionToken) {
      this.setCookie(res, r.sessionToken);
      return { status: 'used', nextPath: r.nextPath ?? null };
    }
    return { status: r.status };
  }

  /** §11 строка 2 · `S-80`: якорное устройство подтверждает привязку сканом. */
  @Post('device-link/approve')
  async deviceLinkApprove(@Req() req: Req0, @Body() body: { token: string }) {
    const u = req.user;
    if (!u?.workspaceId) throw new SchoolError('ACCESS_REVOKED');
    return this.access.approveDeviceLink(
      body.token,
      { userId: u.florusUserId, workspaceId: u.workspaceId, roles: u.roles ?? [], sessionId: req.sessionId ?? null },
      clientOf(req),
    );
  }

  /** `S-05′` (AR-156): вход по юзернейму и паролю — фолбэк слетевшей сессии. */
  @Public()
  @Post('login')
  async login(@Req() req: Request, @Body() body: { username?: string; password?: string }, @Res({ passthrough: true }) res: Response) {
    const { session, roles } = await this.access.loginWithPassword(
      String(body?.username ?? ''),
      String(body?.password ?? ''),
      clientOf(req),
    );
    this.setCookie(res, session.token);
    const access = await this.authz.resolveForRoles(roles);
    return { ok: true, startScreen: startScreenFor(access.permissions) };
  }

  /** §11 строка 36 · `S-05`: вход по коду от модератора (аноним). */
  @Public()
  @Post('login-code/verify')
  async verifyLoginCode(@Req() req: Request, @Body() body: { code: string }, @Res({ passthrough: true }) res: Response) {
    const { session, roles } = await this.access.verifyLoginCode(String(body?.code ?? ''), clientOf(req));
    this.setCookie(res, session.token);
    const access = await this.authz.resolveForRoles(roles);
    return { ok: true, startScreen: startScreenFor(access.permissions) };
  }

  /**
   * Вход по одноразовой ссылке (AR-93, AR-189): платформенной либо выпущенной
   * администратором с карточки. Ссылка открывает страницу приложения, а она
   * обменивает токен здесь: мутация не прячется за GET, который браузер вправе
   * предзагрузить. Стартовый экран — по правам роли, а не `/classes`: по
   * ссылке входит и завуч, чей день начинается с `/deputy` (AR-186).
   */
  @Public()
  @Post('bootstrap/consume')
  async bootstrap(@Req() req: Request, @Body() body: { token: string }, @Res({ passthrough: true }) res: Response) {
    const { session, roles } = await this.access.useBootstrapLink(String(body?.token ?? ''), clientOf(req));
    this.setCookie(res, session.token);
    const access = await this.authz.resolveForRoles(roles);
    return { ok: true, startScreen: startScreenFor(access.permissions) };
  }

  /** §11 строка 3 · `M-15`: выход из сессии (владелец). */
  @Post('logout')
  async logout(@Req() req: Req0, @Res({ passthrough: true }) res: Response) {
    if (req.sessionId) await this.sessions.revoke(req.sessionId, 'manual');
    res.clearCookie(SCHOOL_COOKIE, { path: '/' });
    return { ok: true };
  }

  /** `S-80.list.sessions`: только свои устройства — с каналом входа и видом клиента (AR-187). */
  @Get('sessions')
  async list(@Req() req: Req0): Promise<SessionDto[]> {
    const u = req.user;
    if (!u) return [];
    const rows = await this.sessions.list(u.florusUserId);
    const onlineSince = Date.now() - ACCESS_PARAMS.sessionOnlineMinutes * 60_000;
    return rows.map((s) => ({
      id: s.id,
      deviceHint: s.deviceHint || 'устройство',
      lastSeenAt: s.lastSeenAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      current: s.id === req.sessionId,
      via: s.via as SessionDto['via'],
      clientKind: s.clientKind as SessionDto['clientKind'],
      parentSessionId: s.parentSessionId,
      online: s.lastSeenAt.getTime() >= onlineSince,
    }));
  }

  /** §11 строка 38 · `S-80.btn.endSession`: адресное завершение — ровно одна. */
  @Delete('sessions/:sid')
  async endSession(@Req() req: Req0, @Param('sid') sid: string) {
    const u = req.user;
    if (!u) throw new SchoolError('ACCESS_REVOKED');
    const own = await this.sessions.list(u.florusUserId);
    if (!own.some((s) => s.id === sid)) throw new SchoolError('ACCESS_REVOKED');
    await this.sessions.revoke(sid, 'manual');
    await this.access.publishSessionRevoked(u.florusUserId, u.workspaceId!, 'manual', u.florusUserId);
    return { ok: true };
  }
}

/** Идентичность текущего пользователя: роли, права и стартовый экран (AR-95). */
@Controller('v1')
export class MeController {
  constructor(
    private readonly authz: AuthzService,
    private readonly prisma: PrismaService,
    private readonly state: SchoolStateService,
  ) {}

  /**
   * `GET /api/v1/me` отвечает ТОЛЬКО сессии контура 1.1.1 (AR-94): массив ролей
   * заполняет он, а у вытесненного OIDC-контура он пуст. Без этого различения
   * корень сайта не смог бы решить, чей браузер к нему пришёл, и увёл бы
   * пользователя legacy-кабинета в Schoolium (AR-83: два контура живут в одной
   * базе, но не в одном сценарии).
   */
  @Get('me')
  async me(@Req() req: Req0): Promise<MeDto> {
    const u = req.user;
    if (!u?.workspaceId || !u.roles?.length) throw new SchoolError('ACCESS_REVOKED');
    const roles = u.roles as SchoolRole[];
    const access = await this.authz.resolveForRoles(roles);
    const [user, ws] = await TenantContext.runAsSystem(() =>
      Promise.all([
        this.prisma.user.findUnique({ where: { id: u.florusUserId } }),
        this.prisma.workspace.findUnique({ where: { id: u.workspaceId! } }),
      ]),
    );
    return {
      userId: u.florusUserId,
      name: user?.displayName ?? u.name,
      avatarUrl: user?.avatarUrl ?? null,
      workspaceId: u.workspaceId,
      schoolName: ws?.name ?? '',
      roles,
      permissions: access.permissions as MeDto['permissions'],
      startScreen: startScreenFor(access.permissions),
      schoolState: await this.state.resolve(u.workspaceId),
    };
  }
}
