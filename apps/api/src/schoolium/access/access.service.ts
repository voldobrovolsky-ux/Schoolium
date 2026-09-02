import { Injectable } from '@nestjs/common';
import { randomBytes, randomInt } from 'node:crypto';
import { ACCESS_PARAMS, type SchoolRole, type SessionClientKind, type SessionVia } from '@edustore/shared';
import { verifyPassword } from '../staff/credentials';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { SchoolSessionService } from '../../common/auth/school-session.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { newEvent } from '../../common/events/domain-event';
import {
  SCHOOL_EVENTS,
  type LoginLinkIssuedV1,
  type SessionRevokedV1,
  type SessionStartedV1,
} from '../schoolium.contract';
import { SchoolError } from '../schoolium.errors';

const MIN = 60_000;
const HOUR = 3600_000;

/**
 * Что маршрут входа знает об устройстве (AR-187): подпись устройства, вид
 * клиента (вкладка либо установленное приложение) и адрес первого хопа.
 * Строка вместо объекта — короткая форма для проверок и не-HTTP вызовов:
 * `deviceHint` без вида клиента и адреса.
 */
export interface SessionClient {
  deviceHint: string;
  clientKind: SessionClientKind;
  ip: string | null;
}
export type ClientArg = string | SessionClient;

export const asClient = (c: ClientArg): SessionClient =>
  typeof c === 'string' ? { deviceHint: c, clientKind: 'browser', ip: null } : c;

/**
 * Контур входа Schoolium 1.1.1 — БЕЗ SMS вовсе (AR-94).
 *
 * Три механизма закрывают решётку «устройство × якорная сессия × камера ×
 * присутствие модератора» (эталон — `loginRoute` в `model/states.mjs`):
 *   1. регистрация по QR выдаёт сессию 90 дней на телефоне сотрудника (AR-91) —
 *      телефон становится якорным устройством;
 *   2. новое устройство подключается по QR со страницы `/login` сканом из
 *      «Настройки → Подключить устройство» (паттерн Telegram, TTL 3 минуты);
 *   3. восстановление без якорной сессии — одноразовый код с карточки у
 *      модератора (AR-92): QR и шесть цифр одновременно, 5 минут.
 *
 * Тупика «входа нет и никто не поможет» не существует по построению: у
 * единственного модератора без единой живой сессии остаётся перевыпуск
 * bootstrap-ссылки платформой (AR-93), а с 1.3.0 — та же одноразовая ссылка
 * с карточки сотрудника у администратора (AR-189, 48 часов).
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SchoolSessionService,
    private readonly outbox: OutboxService,
  ) {}

  // ─────────────── привязка устройства (AR-94, паттерн Telegram) ───────────────

  /** Страница `/login` создаёт токен привязки: 3 минуты, одноразов, анонимен. */
  createDeviceLinkToken(nextPath: string | null) {
    return TenantContext.runAsSystem(() =>
      this.prisma.deviceLinkToken.create({
        data: {
          token: randomBytes(24).toString('hex'),
          nextPath,
          expiresAt: new Date(Date.now() + ACCESS_PARAMS.deviceLinkTtlMinutes * MIN),
        },
      }),
    );
  }

  /**
   * Поллинг статуса раз в 2 секунды (AR-87): страница входа читает
   * `waiting` / `approved` / `expired` и, после подтверждения, забирает сессию.
   * Просроченный токен страница перевыпускает сама — человек видит новый QR, а
   * не ошибку.
   */
  async deviceLinkStatus(id: string) {
    const t = await TenantContext.runAsSystem(() => this.prisma.deviceLinkToken.findUnique({ where: { id } }));
    if (!t) throw new SchoolError('LINK_CODE_EXPIRED');
    if (t.state === 'waiting' && t.expiresAt < new Date()) return { status: 'expired' as const };
    if (t.state === 'approved') {
      const session = t.sessionId
        ? await TenantContext.runAsSystem(() => this.prisma.appSession.findUnique({ where: { id: t.sessionId! } }))
        : null;
      return { status: 'used' as const, sessionToken: session?.token ?? null, nextPath: t.nextPath };
    }
    return { status: 'waiting' as const };
  }

  /**
   * Скан якорным устройством. Сессия нового устройства — копия контекста
   * сканирующего: ТА ЖЕ школа и ТЕ ЖЕ роли (эталон `deviceLink.approve`).
   * Токен одноразов: повторный скан — `TOKEN_USED`. Сессия сканирующего
   * записывается родителем новой (AR-187): карта устройств показывает, какой
   * телефон подтвердил какой ноутбук.
   */
  async approveDeviceLink(
    token: string,
    scanner: { userId: string; workspaceId: string; roles: string[]; sessionId?: string | null },
    client: ClientArg,
  ) {
    const c = asClient(client);
    const t = await TenantContext.runAsSystem(() => this.prisma.deviceLinkToken.findUnique({ where: { token } }));
    if (!t) throw new SchoolError('LINK_CODE_EXPIRED');
    if (t.state === 'approved') throw new SchoolError('TOKEN_USED');
    if (t.expiresAt < new Date()) throw new SchoolError('LINK_CODE_EXPIRED');

    const membership = await TenantContext.runAsSystem(() =>
      this.prisma.membership.findFirst({ where: { userId: scanner.userId, workspaceId: scanner.workspaceId } }),
    );
    if (!membership || membership.deactivatedAt) throw new SchoolError('ACCESS_REVOKED');

    const session = await this.sessions.issue({
      userId: scanner.userId,
      workspaceId: scanner.workspaceId,
      roles: scanner.roles,
      deviceHint: c.deviceHint,
      via: 'device_link',
      clientKind: c.clientKind,
      ip: c.ip,
      parentSessionId: scanner.sessionId ?? null,
    });
    await TenantContext.runAsSystem(() =>
      this.prisma.deviceLinkToken.update({
        where: { id: t.id },
        data: { state: 'approved', approvedBy: scanner.userId, sessionId: session.id, workspaceId: scanner.workspaceId },
      }),
    );
    await this.publishSessionStarted(scanner.userId, scanner.workspaceId, 'device_link', c.deviceHint, c.clientKind);
    return { ok: true, nextPath: t.nextPath };
  }

  // ─────────────── код входа с карточки (AR-92) ───────────────

  /** Модератор выдаёт код: шесть цифр и QR одновременно, 5 минут, одноразов. */
  async issueLoginCode(userId: string, workspaceId: string) {
    const code = String(randomInt(0, 10 ** ACCESS_PARAMS.loginCodeDigits)).padStart(ACCESS_PARAMS.loginCodeDigits, '0');
    const row = await this.prisma.loginCode.create({
      data: {
        workspaceId,
        userId,
        code,
        expiresAt: new Date(Date.now() + ACCESS_PARAMS.loginCodeTtlMinutes * MIN),
      },
    });
    return { code: row.code, expiresAt: row.expiresAt.toISOString() };
  }

  /** Гасит код первой успешной проверкой; выдаёт сессию 90 дней. */
  async verifyLoginCode(code: string, client: ClientArg) {
    const c = asClient(client);
    const row = await TenantContext.runAsSystem(() =>
      this.prisma.loginCode.findFirst({ where: { code }, orderBy: { createdAt: 'desc' } }),
    );
    if (!row) throw new SchoolError('LOGIN_CODE_INVALID');
    if (row.usedAt) throw new SchoolError('LOGIN_CODE_INVALID');
    if (row.expiresAt < new Date()) throw new SchoolError('LOGIN_CODE_EXPIRED');

    const membership = await TenantContext.runAsSystem(() =>
      this.prisma.membership.findFirst({ where: { userId: row.userId, workspaceId: row.workspaceId } }),
    );
    if (!membership || membership.deactivatedAt) throw new SchoolError('ACCESS_REVOKED');

    await TenantContext.runAsSystem(() =>
      this.prisma.loginCode.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    );
    const session = await this.sessions.issue({
      userId: row.userId,
      workspaceId: row.workspaceId,
      roles: membership.roles,
      deviceHint: c.deviceHint,
      via: 'login_code',
      clientKind: c.clientKind,
      ip: c.ip,
    });
    await this.publishSessionStarted(row.userId, row.workspaceId, 'login_code', c.deviceHint, c.clientKind);
    return { session, roles: membership.roles as SchoolRole[] };
  }

  // ─────────────── вход по юзернейму и паролю (AR-156, `S-05′`) ───────────────

  /**
   * Фолбэк слетевшей сессии: креды заведены модератором вместе с учёткой.
   * Отказ не различает «нет такого юзернейма» и «пароль неверен» (`LOGIN_FAILED`,
   * защита от перечисления); сравнение выравнено по времени фиктивным хэшем.
   * Школу маршрут не называет — берётся последнее активное членство с ролями
   * [дефолт: мультишкольный выбор школы — отложенное, `00-scope.md` §4].
   */
  async loginWithPassword(username: string, password: string, client: ClientArg) {
    const c = asClient(client);
    const u = username.trim().toLowerCase();
    const user = await TenantContext.runAsSystem(() => this.prisma.user.findUnique({ where: { username: u } }));
    const ok = verifyPassword(password, user?.passwordHash ?? null);
    if (!user || !ok) throw new SchoolError('LOGIN_FAILED');

    const membership = await TenantContext.runAsSystem(() =>
      this.prisma.membership.findFirst({
        where: { userId: user.id, deactivatedAt: null, NOT: { roles: { isEmpty: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    );
    if (!membership) throw new SchoolError('ACCESS_REVOKED');

    // вход по паролю тоже делает устройство верифицированным носителем
    await this.markActivated(membership.id, membership.activatedAt);
    const session = await this.sessions.issue({
      userId: user.id,
      workspaceId: membership.workspaceId,
      roles: membership.roles,
      deviceHint: c.deviceHint,
      via: 'password',
      clientKind: c.clientKind,
      ip: c.ip,
    });
    await this.publishSessionStarted(user.id, membership.workspaceId, 'password', c.deviceHint, c.clientKind);
    return { session, roles: membership.roles as SchoolRole[] };
  }

  // ─────────────── одноразовая ссылка: bootstrap (AR-93) и ссылка входа (AR-189) ───────────────

  /**
   * Вход по одноразовой ссылке, 48 часов: платформенной (`purpose = bootstrap`,
   * первый модератор школы и учётки `provision`) либо выпущенной администратором
   * с карточки сотрудника (`purpose = login_link`). Канал сессии различает их —
   * карта устройств показывает, чьей ссылкой человек вошёл.
   *
   * Вошедший по ссылке — активированный носитель (AR-161): до 1.3.0 учётки,
   * заведённые `provision`, оставались «не авторизованными» после входа, потому
   * что `activatedAt` ставила только QR-активация и пароль.
   */
  async useBootstrapLink(token: string, client: ClientArg) {
    const c = asClient(client);
    const link = await TenantContext.runAsSystem(() => this.prisma.bootstrapLink.findUnique({ where: { token } }));
    if (!link) throw new SchoolError('TOKEN_EXPIRED');
    if (link.usedAt) throw new SchoolError('TOKEN_USED');
    if (link.expiresAt < new Date()) throw new SchoolError('TOKEN_EXPIRED');
    const membership = await TenantContext.runAsSystem(() =>
      this.prisma.membership.findFirst({ where: { userId: link.userId, workspaceId: link.workspaceId } }),
    );
    if (!membership || membership.deactivatedAt) throw new SchoolError('ACCESS_REVOKED');
    await TenantContext.runAsSystem(() =>
      this.prisma.bootstrapLink.update({ where: { id: link.id }, data: { usedAt: new Date() } }),
    );
    await this.markActivated(membership.id, membership.activatedAt);
    const via: SessionVia = link.purpose === 'bootstrap' ? 'bootstrap_link' : 'login_link';
    const session = await this.sessions.issue({
      userId: link.userId,
      workspaceId: link.workspaceId,
      roles: membership.roles,
      deviceHint: c.deviceHint,
      via,
      clientKind: c.clientKind,
      ip: c.ip,
    });
    await this.publishSessionStarted(link.userId, link.workspaceId, via, c.deviceHint, c.clientKind);
    return { session, roles: membership.roles as SchoolRole[] };
  }

  /**
   * Ссылка входа с карточки сотрудника (AR-189): та же одноразовая ссылка, что
   * у bootstrap, но выпускает её администратор из `S-62`/`S-31`, и аудит
   * помнит, кто и кому. Срок — 48 часов; повторный выпуск не гасит прежнюю —
   * каждая одноразова сама по себе.
   */
  async issueLoginLink(userId: string, workspaceId: string, issuedBy: string) {
    const expiresAt = new Date(Date.now() + ACCESS_PARAMS.loginLinkTtlHours * HOUR);
    const row = await this.prisma.$transaction(async (tx) => {
      const link = await tx.bootstrapLink.create({
        data: {
          workspaceId,
          userId,
          token: randomBytes(24).toString('hex'),
          purpose: 'login_link',
          issuedBy,
          expiresAt,
        },
      });
      await this.outbox.enqueue(
        tx,
        newEvent<LoginLinkIssuedV1>({
          type: SCHOOL_EVENTS.loginLinkIssued,
          workspaceId,
          actor: issuedBy,
          payload: { userId, issuedBy, expiresAt: expiresAt.toISOString() },
        }),
      );
      return link;
    });
    return { token: row.token, expiresAt: row.expiresAt };
  }

  /** Первый верифицированный вход ставит `activatedAt` — карточка уходит из «Не авторизованных». */
  private async markActivated(membershipId: string, activatedAt: Date | null): Promise<void> {
    if (activatedAt) return;
    await TenantContext.runAsSystem(() =>
      this.prisma.membership.update({ where: { id: membershipId }, data: { activatedAt: new Date() } }),
    );
  }

  // ─────────────── факты сессий в аудит ───────────────

  async publishSessionStarted(
    userId: string,
    workspaceId: string,
    via: SessionStartedV1['via'],
    deviceHint: string,
    clientKind: SessionClientKind = 'browser',
  ): Promise<void> {
    await TenantContext.runAsSystem(() =>
      this.prisma.$transaction((tx) =>
        this.outbox.enqueue(
          tx,
          newEvent<SessionStartedV1>({
            type: SCHOOL_EVENTS.sessionStarted,
            workspaceId,
            actor: userId,
            payload: { userId, via, deviceHint, clientKind },
          }),
        ),
      ),
    );
  }

  async publishSessionRevoked(
    userId: string,
    workspaceId: string,
    reason: SessionRevokedV1['reason'],
    actor: string,
  ): Promise<void> {
    await TenantContext.runAsSystem(() =>
      this.prisma.$transaction((tx) =>
        this.outbox.enqueue(
          tx,
          newEvent<SessionRevokedV1>({
            type: SCHOOL_EVENTS.sessionRevoked,
            workspaceId,
            actor,
            payload: { userId, reason },
          }),
        ),
      ),
    );
  }
}
