import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ASSET_KINDS,
  NETWORK_AUDIENCES,
  ROLE_LIMIT_MAX,
  SCHOOL_ROLES,
  STAFF_ROLES,
  type AccessPolicyDto,
  type AdminDeviceMapDto,
  type AdminDeviceUserDto,
  type AdminOverviewDto,
  type AdminSessionDto,
  type IncidentResultDto,
  type SchoolAssetDto,
  type SchoolAuditEntryDto,
  type SchoolNetworkDto,
  type RoleLimits,
  type SchoolRole,
  type SessionLimits,
  type SetAccessPolicyDto,
  type UpsertAssetDto,
  type UpsertNetworkDto,
} from '@edustore/shared';
import { countRoleHolders } from '../staff/staff.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { OutboxService } from '../../common/outbox/outbox.service';
import { newEvent } from '../../common/events/domain-event';
import { SchoolSessionService } from '../../common/auth/school-session.service';
import { AccessService } from '../access/access.service';
import { SchoolStateService } from '../school-state.service';
import { SchoolError } from '../schoolium.errors';
import type { SchoolActor } from '../actor';
import {
  AUDIT_LABELS,
  SCHOOL_EVENTS,
  type PolicySetV1,
  type RegistryChangedV1,
  type SchoolEventType,
  type SessionRevokedV1,
} from '../schoolium.contract';
import { isLive, isOnline, journalSince, sessionsOfUser, type SessionRow } from './session-view';

/** Потолок лимита сессий роли (AR-188): больше двадцати устройств у одного человека — уже не лимит. */
const LIMIT_MAX = 20;
const NAME_MAX = 80;
const NOTE_MAX = 200;

interface AuditRow {
  id: string;
  actor: string | null;
  subjectUserId: string | null;
  action: string;
  occurredAt: Date;
}

/**
 * Кабинет администратора `S-62` (AR-186…AR-189): карта устройств и журнал
 * подключений, политика доступа с лимитами сессий и инцидент-режимом, реестры
 * Wi-Fi сетей и корпоративных устройств, аудит всей школы.
 *
 * Сессии живут в `AppSession` вне tenant-guard (AR-99) — каждый запрос здесь
 * называет `workspaceId` явно и работает в системном контексте только с ними;
 * реестры и политика — обычные доменные таблицы под guard, и school B их не
 * видит по построению (G-82).
 */
@Injectable()
export class AdminCabinetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly sessions: SchoolSessionService,
    private readonly access: AccessService,
    private readonly state: SchoolStateService,
  ) {}

  // ─────────────── обзор ───────────────

  async overview(): Promise<AdminOverviewDto> {
    const ws = TenantContext.require();
    const now = new Date();
    const [workspace, reg, state, memberships, live, networks, assets, policy] = await Promise.all([
      this.prisma.workspace.findUnique({ where: { id: ws } }),
      this.state.register(ws),
      this.state.resolve(ws),
      this.memberships(ws),
      this.liveSessions(ws, now),
      this.prisma.schoolNetwork.count(),
      this.prisma.schoolAsset.count(),
      this.policy(),
    ]);
    const active = memberships.filter((m) => m.deactivatedAt === null);
    const membersByRole: Partial<Record<SchoolRole, number>> = {};
    for (const m of active) {
      for (const r of m.roles as SchoolRole[]) membersByRole[r] = (membersByRole[r] ?? 0) + 1;
    }
    const activatedTotal = active.filter((m) => m.activatedAt !== null).length;
    return {
      schoolName: workspace?.name ?? '',
      logoUrl: workspace?.logoUrl ?? null,
      timezone: reg.timezone,
      state,
      membersByRole,
      membersTotal: active.length,
      activatedTotal,
      pendingActivations: active.length - activatedTotal,
      activeSessions: live.length,
      onlineSessions: live.filter((s) => isOnline(s, now)).length,
      pwaSessions: live.filter((s) => s.clientKind === 'pwa').length,
      browserSessions: live.filter((s) => s.clientKind !== 'pwa').length,
      networks,
      assets,
      policy,
    };
  }

  // ─────────────── карта устройств и журнал подключений (AR-187) ───────────────

  /**
   * Каждый человек школы с живыми сессиями. Персонал впереди учеников и
   * родителей — администратор ищет сотрудника, а не ученика; внутри группы —
   * по имени. `newNetwork` считается по ВСЕЙ истории человека, поэтому
   * читаются и завершённые сессии, хотя показываются только живые.
   */
  async devices(currentSessionId: string | null = null): Promise<AdminDeviceMapDto> {
    const ws = TenantContext.require();
    const now = new Date();
    const [memberships, rows] = await Promise.all([
      this.memberships(ws),
      TenantContext.runAsSystem(() => this.prisma.appSession.findMany({ where: { workspaceId: ws } })),
    ]);
    const users = await this.usersOf(memberships.map((m) => m.userId).filter((v): v is string => Boolean(v)));
    const byUser = new Map<string, SessionRow[]>();
    for (const r of rows) {
      const list = byUser.get(r.userId) ?? [];
      list.push(r);
      byUser.set(r.userId, list);
    }
    const nodes: AdminDeviceUserDto[] = memberships
      .filter((m) => m.userId !== null)
      .map((m) => {
        const u = users.get(m.userId!);
        const sessions = sessionsOfUser(byUser.get(m.userId!) ?? [], now, currentSessionId)
          .filter((s) => s.status === 'active')
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return {
          userId: m.userId!,
          name: u?.name ?? m.userId!,
          username: u?.username ?? null,
          avatarUrl: u?.avatarUrl ?? null,
          roles: m.roles as SchoolRole[],
          deactivated: m.deactivatedAt !== null,
          activated: m.activatedAt !== null,
          sessions,
        };
      });
    const isStaff = (n: AdminDeviceUserDto): boolean => n.roles.some((r) => STAFF_ROLES.includes(r));
    nodes.sort((a, b) => {
      const ga = isStaff(a) ? 0 : 1;
      const gb = isStaff(b) ? 0 : 1;
      return ga !== gb ? ga - gb : a.name.localeCompare(b.name, 'ru');
    });
    const live = rows.filter((r) => isLive(r, now));
    return {
      users: nodes,
      activeSessions: live.length,
      onlineSessions: live.filter((r) => isOnline(r, now)).length,
      generatedAt: now.toISOString(),
    };
  }

  /**
   * Журнал подключений: все сессии человека за `sessionJournalDays`, самые
   * новые первыми; без `userId` — вся школа, не больше 200 строк (страница
   * читается, а не выгружается).
   */
  async connections(userId: string | null, currentSessionId: string | null = null): Promise<AdminSessionDto[]> {
    const ws = TenantContext.require();
    const now = new Date();
    const since = journalSince(now);
    const rows = await TenantContext.runAsSystem(() =>
      this.prisma.appSession.findMany({
        where: {
          workspaceId: ws,
          ...(userId ? { userId } : {}),
          OR: [{ revokedAt: null, expiresAt: { gt: now } }, { revokedAt: { gte: since } }, { expiresAt: { gte: since } }],
        },
      }),
    );
    if (userId) return sessionsOfUser(rows, now, currentSessionId);
    // «новая сеть» — свойство истории человека, поэтому считается по людям
    const byUser = new Map<string, SessionRow[]>();
    for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
    const all = [...byUser.values()].flatMap((list) => sessionsOfUser(list, now, currentSessionId));
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200);
  }

  // ─────────────── отзыв сессий (§11 строки 40, 41; AR-188) ───────────────

  /** Адресный отзыв из `S-62`: чужая сессия — 404, уже завершённая — `ACCESS_REVOKED`. */
  async revokeSession(sessionId: string, actor: SchoolActor): Promise<{ ok: true }> {
    const ws = TenantContext.require();
    const s = await TenantContext.runAsSystem(() => this.prisma.appSession.findUnique({ where: { id: sessionId } }));
    if (!s || s.workspaceId !== ws) throw new NotFoundException('сессия не найдена');
    if (s.revokedAt !== null || s.expiresAt <= new Date()) throw new SchoolError('ACCESS_REVOKED');
    await this.sessions.revoke(sessionId, 'admin');
    await this.access.publishSessionRevoked(s.userId, ws, 'admin', actor.userId);
    return { ok: true };
  }

  /**
   * Инцидент-режим (`M-28`): все живые сессии школы гаснут, кроме той, из
   * которой нажата кнопка, — администратор не выбрасывает сам себя посреди
   * инцидента. Одно событие на каждого пострадавшего человека: аудит хранит
   * «кто потерял вход», а не сколько было вкладок.
   */
  async revokeAll(currentSessionId: string | null, actor: SchoolActor): Promise<IncidentResultDto> {
    const ws = TenantContext.require();
    const now = new Date();
    const victims = await TenantContext.runAsSystem(async () => {
      const live = await this.prisma.appSession.findMany({
        where: { workspaceId: ws, revokedAt: null, expiresAt: { gt: now }, ...(currentSessionId ? { NOT: { id: currentSessionId } } : {}) },
      });
      if (live.length) {
        await this.prisma.appSession.updateMany({
          where: { id: { in: live.map((s) => s.id) } },
          data: { revokedAt: now, revokedReason: 'incident' },
        });
      }
      return live;
    });
    const users = [...new Set(victims.map((v) => v.userId))];
    await this.prisma.$transaction(async (tx) => {
      await tx.schoolAccessPolicy.upsert({
        where: { workspaceId: ws },
        update: { incidentAt: now, incidentBy: actor.userId },
        create: { workspaceId: ws, incidentAt: now, incidentBy: actor.userId },
      });
      for (const userId of users) {
        await this.outbox.enqueue(
          tx,
          newEvent<SessionRevokedV1>({
            type: SCHOOL_EVENTS.sessionRevoked,
            workspaceId: ws,
            actor: actor.userId,
            payload: { userId, reason: 'incident' },
          }),
        );
      }
    });
    return { ok: true, revoked: victims.length, users: users.length };
  }

  // ─────────────── политика доступа (§11 строка 42; AR-188, AR-205) ───────────────

  /**
   * Чтение БЕЗ побочных эффектов: строки политики нет — школа живёт с
   * дефолтами (лимитов сессий нет, лимиты ролей — `DEFAULT_ROLE_LIMITS`,
   * инцидента не было), и ответ собирается из них. Ленивое `create` здесь уже
   * стреляло: `overview()` и `GET policy` читают политику параллельно, и второй
   * `create` падал на уникальности `workspaceId` — 500 при первом открытии
   * кабинета. Строку заводят только писатели (`setPolicy`, `revokeAll`) — через
   * `upsert`. `roleHolders` («занято N» в `S-62.policy.roleLimits`) считается
   * той же функцией, что и отказ `ROLE_LIMIT_REACHED` (AR-205): цифра одна.
   */
  async policy(): Promise<AccessPolicyDto> {
    const ws = TenantContext.require();
    const [row, roleHolders] = await Promise.all([
      this.prisma.schoolAccessPolicy.findUnique({ where: { workspaceId: ws } }),
      this.roleHolders(ws),
    ]);
    if (!row) return { sessionLimits: {}, roleLimits: {}, roleHolders, incidentAt: null, incidentByName: null, updatedAt: null };
    const by = row.incidentBy ? await this.usersOf([row.incidentBy]) : new Map<string, { name: string }>();
    return {
      sessionLimits: (row.sessionLimits ?? {}) as SessionLimits,
      roleLimits: (row.roleLimits ?? {}) as RoleLimits,
      roleHolders,
      incidentAt: row.incidentAt ? row.incidentAt.toISOString() : null,
      incidentByName: row.incidentBy ? (by.get(row.incidentBy)?.name ?? null) : null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Носители каждой штатной роли: живые членства + пустые слоты (`countRoleHolders`, AR-205). */
  private async roleHolders(ws: string): Promise<Partial<Record<SchoolRole, number>>> {
    const out: Partial<Record<SchoolRole, number>> = {};
    await TenantContext.runAsSystem(async () => {
      const counts = await Promise.all(STAFF_ROLES.map((role) => countRoleHolders(this.prisma, ws, role)));
      STAFF_ROLES.forEach((role, i) => {
        out[role] = counts[i];
      });
    });
    return out;
  }

  /**
   * Лимиты по ролям: `null` — без лимита, иначе целое от 1 до 20. Неизвестная
   * роль или число вне диапазона — отказ целиком: политика либо принята, либо
   * нет, «частично применённых» лимитов не бывает. Лимит сессий (AR-188)
   * задаётся любой роли и применяется следующей выдачей сессии
   * (`SchoolSessionService.issue`), живые сессии не трогаются. Лимит носителей
   * роли (AR-205) — только штатным ролям; `roleLimits` в теле нет — прежние
   * значения сохраняются; проверяется при заведении, выдаче роли и
   * реактивации (`StaffService.assertRoleFree`), живые носители не трогаются.
   */
  async setPolicy(dto: SetAccessPolicyDto, actor: SchoolActor): Promise<AccessPolicyDto> {
    const ws = TenantContext.require();
    const limits = parseLimits(dto?.sessionLimits, 'sessionLimits', SCHOOL_ROLES, LIMIT_MAX, 'лимит роли');
    const roleLimits = dto?.roleLimits === undefined ? undefined : parseLimits(dto.roleLimits, 'roleLimits', STAFF_ROLES, ROLE_LIMIT_MAX, 'лимит носителей роли');
    await this.prisma.$transaction(async (tx) => {
      const current = roleLimits === undefined ? await tx.schoolAccessPolicy.findUnique({ where: { workspaceId: ws } }) : null;
      const storedRoleLimits = roleLimits ?? ((current?.roleLimits ?? {}) as Record<string, number | null>);
      await tx.schoolAccessPolicy.upsert({
        where: { workspaceId: ws },
        update: { sessionLimits: limits, ...(roleLimits === undefined ? {} : { roleLimits }) },
        create: { workspaceId: ws, sessionLimits: limits, roleLimits: storedRoleLimits },
      });
      await this.outbox.enqueue(
        tx,
        newEvent<PolicySetV1>({
          type: SCHOOL_EVENTS.policySet,
          workspaceId: ws,
          actor: actor.userId,
          payload: { sessionLimits: limits, roleLimits: storedRoleLimits },
        }),
      );
    });
    return this.policy();
  }

  // ─────────────── аудит всей школы ───────────────

  async audit(limit = 200): Promise<SchoolAuditEntryDto[]> {
    const rows = await this.prisma.auditLog.findMany({ orderBy: { occurredAt: 'desc' }, take: limit });
    return this.auditEntries(rows);
  }

  /**
   * Строки леджера → слова кабинета (AR-116): подпись действия из каталога
   * событий, имя объекта — ФИО субъекта ПДн, если аудит его держит, имя
   * действующего — по его учётке. Общая для `S-60` и `S-62`: модератор и
   * администратор читают один и тот же след одними словами.
   */
  async auditEntries(rows: AuditRow[]): Promise<SchoolAuditEntryDto[]> {
    const subjectIds = [...new Set(rows.map((r) => r.subjectUserId).filter((v): v is string => Boolean(v)))];
    const actorIds = [...new Set(rows.map((r) => r.actor).filter((v): v is string => Boolean(v)))];
    const [subjects, actors] = await Promise.all([this.resolveNames(subjectIds), this.usersOf(actorIds)]);
    return rows.map((r) => {
      const label = AUDIT_LABELS[r.action as SchoolEventType];
      return {
        id: r.id,
        at: r.occurredAt.toISOString(),
        action: r.action,
        // Событие вне каталога версии (легаси-контур) не прячется и не
        // подписывается выдумкой — показывается своим техническим именем.
        actionLabel: label?.action ?? r.action,
        objectKind: label?.object ?? 'запись',
        objectName: r.subjectUserId ? (subjects.get(r.subjectUserId) ?? null) : null,
        actorId: r.actor,
        actorName: r.actor ? (actors.get(r.actor)?.name ?? null) : null,
      };
    });
  }

  /** Субъект ПДн — либо ученик, либо сотрудник: аудит хранит идентификатор, имя живёт в своём контуре. */
  private async resolveNames(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (ids.length === 0) return out;
    const [students, users] = await Promise.all([
      this.prisma.schoolStudent.findMany({ where: { id: { in: ids } } }),
      TenantContext.runAsSystem(() => this.prisma.user.findMany({ where: { id: { in: ids } } })),
    ]);
    for (const s of students) out.set(s.id, [s.lastName, s.firstName, s.middleName].filter(Boolean).join(' '));
    for (const u of users) out.set(u.id, [u.lastName, u.firstName, u.middleName].filter(Boolean).join(' ') || u.displayName);
    return out;
  }

  // ─────────────── реестр Wi-Fi сетей (§11 строки 43–45; AR-186) ───────────────

  async listNetworks(): Promise<SchoolNetworkDto[]> {
    const rows = await this.prisma.schoolNetwork.findMany({ orderBy: { ssid: 'asc' } });
    return rows.map(toNetworkDto);
  }

  async createNetwork(dto: UpsertNetworkDto, actor: SchoolActor): Promise<SchoolNetworkDto> {
    const data = validateNetwork(dto);
    const row = await this.prisma.$transaction(async (tx) => {
      const n = await tx.schoolNetwork.create({ data: { workspaceId: TenantContext.require(), ...data } });
      await this.publishRegistry(tx, actor, 'network', 'created', n.id, n.ssid);
      return n;
    });
    return toNetworkDto(row);
  }

  async updateNetwork(id: string, dto: UpsertNetworkDto, actor: SchoolActor): Promise<SchoolNetworkDto> {
    const found = await this.prisma.schoolNetwork.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('сеть не найдена');
    const data = validateNetwork(dto);
    const row = await this.prisma.$transaction(async (tx) => {
      const n = await tx.schoolNetwork.update({ where: { id }, data });
      await this.publishRegistry(tx, actor, 'network', 'updated', n.id, n.ssid);
      return n;
    });
    return toNetworkDto(row);
  }

  /** Устройства, привязанные к сети, остаются — ссылка на сеть у них снимается. */
  async deleteNetwork(id: string, actor: SchoolActor): Promise<{ ok: true }> {
    const found = await this.prisma.schoolNetwork.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('сеть не найдена');
    await this.prisma.$transaction(async (tx) => {
      await tx.schoolAsset.updateMany({ where: { networkId: id }, data: { networkId: null } });
      await tx.schoolNetwork.delete({ where: { id } });
      await this.publishRegistry(tx, actor, 'network', 'deleted', found.id, found.ssid);
    });
    return { ok: true };
  }

  // ─────────────── реестр корпоративных устройств (§11 строки 46–48; AR-186) ───────────────

  async listAssets(): Promise<SchoolAssetDto[]> {
    const rows = await this.prisma.schoolAsset.findMany({ orderBy: { name: 'asc' } });
    return rows.map(toAssetDto);
  }

  async createAsset(dto: UpsertAssetDto, actor: SchoolActor): Promise<SchoolAssetDto> {
    const data = await this.validateAsset(dto);
    const row = await this.prisma.$transaction(async (tx) => {
      const a = await tx.schoolAsset.create({ data: { workspaceId: TenantContext.require(), ...data } });
      await this.publishRegistry(tx, actor, 'asset', 'created', a.id, a.name);
      return a;
    });
    return toAssetDto(row);
  }

  async updateAsset(id: string, dto: UpsertAssetDto, actor: SchoolActor): Promise<SchoolAssetDto> {
    const found = await this.prisma.schoolAsset.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('устройство не найдено');
    const data = await this.validateAsset(dto);
    const row = await this.prisma.$transaction(async (tx) => {
      const a = await tx.schoolAsset.update({ where: { id }, data });
      await this.publishRegistry(tx, actor, 'asset', 'updated', a.id, a.name);
      return a;
    });
    return toAssetDto(row);
  }

  async deleteAsset(id: string, actor: SchoolActor): Promise<{ ok: true }> {
    const found = await this.prisma.schoolAsset.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('устройство не найдено');
    await this.prisma.$transaction(async (tx) => {
      await tx.schoolAsset.delete({ where: { id } });
      await this.publishRegistry(tx, actor, 'asset', 'deleted', found.id, found.name);
    });
    return { ok: true };
  }

  /** Сеть устройства — из реестра ЭТОЙ школы (guard сужает запрос тенантом) либо пусто. */
  private async validateAsset(dto: UpsertAssetDto) {
    const name = String(dto?.name ?? '').trim();
    if (!name || name.length > NAME_MAX) throw new BadRequestException(`название: от 1 до ${NAME_MAX} знаков`);
    if (!ASSET_KINDS.includes(dto.kind)) throw new BadRequestException(`вид устройства: одно из ${ASSET_KINDS.join(', ')}`);
    const location = optionalText(dto.location, 'расположение');
    const note = optionalText(dto.note, 'примечание');
    const networkId = dto.networkId ? String(dto.networkId) : null;
    if (networkId) {
      const net = await this.prisma.schoolNetwork.findUnique({ where: { id: networkId } });
      if (!net) throw new BadRequestException('сеть не найдена в реестре школы');
    }
    return { name, kind: dto.kind, location, note, networkId };
  }

  private publishRegistry(
    tx: Parameters<OutboxService['enqueue']>[0],
    actor: SchoolActor,
    kind: RegistryChangedV1['kind'],
    op: RegistryChangedV1['op'],
    id: string,
    name: string,
  ): Promise<void> {
    return this.outbox.enqueue(
      tx,
      newEvent<RegistryChangedV1>({
        type: SCHOOL_EVENTS.registryChanged,
        workspaceId: TenantContext.require(),
        actor: actor.userId,
        payload: { kind, op, id, name },
      }),
    );
  }

  // ─────────────── справочники ───────────────

  private memberships(ws: string) {
    return TenantContext.runAsSystem(() =>
      this.prisma.membership.findMany({ where: { workspaceId: ws, NOT: { roles: { isEmpty: true } } } }),
    );
  }

  private liveSessions(ws: string, now: Date) {
    return TenantContext.runAsSystem(() =>
      this.prisma.appSession.findMany({ where: { workspaceId: ws, revokedAt: null, expiresAt: { gt: now } } }),
    );
  }

  private async usersOf(ids: string[]): Promise<Map<string, { name: string; username: string | null; avatarUrl: string | null }>> {
    const out = new Map<string, { name: string; username: string | null; avatarUrl: string | null }>();
    if (ids.length === 0) return out;
    const users = await TenantContext.runAsSystem(() => this.prisma.user.findMany({ where: { id: { in: ids } } }));
    for (const u of users) {
      // Имя действующего и узла карты — `displayName`: так человек назван в
      // шапке и в `S-60`; полное ФИО остаётся у субъекта ПДн (`resolveNames`).
      out.set(u.id, {
        name: u.displayName || [u.lastName, u.firstName].filter(Boolean).join(' '),
        username: u.username,
        avatarUrl: u.avatarUrl,
      });
    }
    return out;
  }
}

// ─────────────── валидация и проекции реестров ───────────────

/**
 * Словарь «роль → лимит» (AR-188 сессии, AR-205 носители ролей): роль только из
 * `roles`, значение — целое 1..`max` либо `null`/пусто («без лимита»). Один
 * разбор на оба словаря — тексты отказов различаются лишь подписью `what`.
 */
function parseLimits(
  src: unknown,
  field: string,
  roles: readonly string[],
  max: number,
  what: string,
): Record<string, number | null> {
  if (!src || typeof src !== 'object' || Array.isArray(src)) throw new BadRequestException(`${field}: ожидается объект «роль → лимит»`);
  const out: Record<string, number | null> = {};
  for (const [role, raw] of Object.entries(src as Record<string, unknown>)) {
    if (!roles.includes(role)) {
      throw new BadRequestException(
        (SCHOOL_ROLES as readonly string[]).includes(role) ? `${what} ${role}: только штатные роли` : `роль ${role} не существует`,
      );
    }
    if (raw === null || raw === undefined) {
      out[role] = null;
      continue;
    }
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > max) {
      throw new BadRequestException(`${what} ${role}: целое число от 1 до ${max} либо пусто`);
    }
    out[role] = raw;
  }
  return out;
}

function optionalText(v: string | null | undefined, field: string): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  if (t.length > NOTE_MAX) throw new BadRequestException(`${field}: не длиннее ${NOTE_MAX} знаков`);
  return t || null;
}

function validateNetwork(dto: UpsertNetworkDto) {
  const ssid = String(dto?.ssid ?? '').trim();
  if (!ssid || ssid.length > NAME_MAX) throw new BadRequestException(`SSID: от 1 до ${NAME_MAX} знаков`);
  if (!NETWORK_AUDIENCES.includes(dto.audience)) throw new BadRequestException(`аудитория сети: одно из ${NETWORK_AUDIENCES.join(', ')}`);
  return { ssid, audience: dto.audience, note: optionalText(dto.note, 'примечание') };
}

function toNetworkDto(n: { id: string; ssid: string; audience: string; note: string | null; createdAt: Date; updatedAt: Date }): SchoolNetworkDto {
  return {
    id: n.id,
    ssid: n.ssid,
    audience: n.audience as SchoolNetworkDto['audience'],
    note: n.note,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

function toAssetDto(a: {
  id: string;
  name: string;
  kind: string;
  location: string | null;
  networkId: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SchoolAssetDto {
  return {
    id: a.id,
    name: a.name,
    kind: a.kind as SchoolAssetDto['kind'],
    location: a.location,
    networkId: a.networkId,
    note: a.note,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}
