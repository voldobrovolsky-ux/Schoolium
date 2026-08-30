import { Injectable } from '@nestjs/common';
import { randomBytes, randomInt } from 'node:crypto';
import { ACCESS_PARAMS, type SchoolRole } from '@edustore/shared';
import { verifyPassword } from '../staff/credentials';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { SchoolSessionService } from '../../common/auth/school-session.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { newEvent } from '../../common/events/domain-event';
import { SCHOOL_EVENTS, type SessionRevokedV1, type SessionStartedV1 } from '../schoolium.contract';
import { SchoolError } from '../schoolium.errors';

const MIN = 60_000;

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
 * bootstrap-ссылки платформой (AR-93).
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
   * Токен одноразов: повторный скан — `TOKEN_USED`.
   */
  async approveDeviceLink(token: string, scanner: { userId: string; workspaceId: string; roles: string[] }, deviceHint: string) {
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
      deviceHint,
    });
    await TenantContext.runAsSystem(() =>
      this.prisma.deviceLinkToken.update({
        where: { id: t.id },
        data: { state: 'approved', approvedBy: scanner.userId, sessionId: session.id, workspaceId: scanner.workspaceId },
      }),
    );
    await this.publishSessionStarted(scanner.userId, scanner.workspaceId, 'device_link', deviceHint);
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
  async verifyLoginCode(code: string, deviceHint: string) {
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
      deviceHint,
    });
    await this.publishSessionStarted(row.userId, row.workspaceId, 'login_code', deviceHint);
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
  async loginWithPassword(username: string, password: string, deviceHint: string) {
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
    if (!membership.activatedAt) {
      await TenantContext.runAsSystem(() =>
        this.prisma.membership.update({ where: { id: membership.id }, data: { activatedAt: new Date() } }),
      );
    }
    const session = await this.sessions.issue({
      userId: user.id,
      workspaceId: membership.workspaceId,
      roles: membership.roles,
      deviceHint,
    });
    await this.publishSessionStarted(user.id, membership.workspaceId, 'password', deviceHint);
    return { session, roles: membership.roles as SchoolRole[] };
  }

  // ─────────────── одноразовая ссылка bootstrap (AR-93) ───────────────

  /** Вход первого модератора школы по ссылке платформенной операции, 24 часа. */
  async useBootstrapLink(token: string, deviceHint: string) {
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
    const session = await this.sessions.issue({
      userId: link.userId,
      workspaceId: link.workspaceId,
      roles: membership.roles,
      deviceHint,
    });
    await this.publishSessionStarted(link.userId, link.workspaceId, 'bootstrap_link', deviceHint);
    return session;
  }

  // ─────────────── факты сессий в аудит ───────────────

  async publishSessionStarted(
    userId: string,
    workspaceId: string,
    via: SessionStartedV1['via'],
    deviceHint: string,
  ): Promise<void> {
    await TenantContext.runAsSystem(() =>
      this.prisma.$transaction((tx) =>
        this.outbox.enqueue(
          tx,
          newEvent<SessionStartedV1>({
            type: SCHOOL_EVENTS.sessionStarted,
            workspaceId,
            actor: userId,
            payload: { userId, via, deviceHint },
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
