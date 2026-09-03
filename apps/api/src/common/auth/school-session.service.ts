import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomBytes } from 'node:crypto';
import {
  ACCESS_PARAMS,
  type SessionClientKind,
  type SessionLimits,
  type SessionRevokeReason,
  type SessionVia,
} from '@edustore/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { OutboxService } from '../outbox/outbox.service';
import { newEvent } from '../events/domain-event';
import { SCHOOL_EVENTS, type SessionRevokedV1 } from '../../schoolium/schoolium.contract';
import type { SessionUser } from './flor.service';

/** Имя httpOnly-cookie контура доступа 1.1.1. Legacy `flor_sid` не переиспользуется. */
export const SCHOOL_COOKIE = 'sch_sid';

/**
 * Флаги cookie сессии — ОДНО место на ВСЕ маршруты, которые её ставят (входы
 * `v1/auth/*`, активация `staff/join/:token`, продление в guard). Раздельные
 * литералы уже расходились: `secure` был выведен из `NODE_ENV`, и на стенде по
 * голому IP вход молча не срабатывал; позже `join/:token` ставил куку БЕЗ
 * `maxAge` — сессионную, и установленное на телефон приложение просило «Войти»
 * после каждого закрытия (правка владельца 2026-08-31).
 *
 * `maxAge` обязателен: без него кука живёт до закрытия браузера, какой бы
 * долгой ни была серверная сессия. Срок равен серверному `sessionDays` и
 * скользит вместе с ним — guard перевыставляет куку при продлении сессии.
 *
 * `COOKIE_INSECURE=1` снимает `secure` и предназначен ТОЛЬКО для стенда без
 * TLS (демо по IP, локальная проверка). С реальными данными школы он
 * недопустим: cookie уйдёт по открытому каналу.
 */
export const schoolCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_INSECURE !== '1',
  maxAge: ACCESS_PARAMS.sessionDays * 24 * 3600 * 1000,
  path: '/',
});

const DAY_MS = 24 * 3600 * 1000;

/**
 * Происхождение сессии (AR-187): что маршрут входа знает об устройстве. Несут
 * все маршруты выдачи — карта устройств администратора читает эти поля, а не
 * выводит их задним числом.
 */
export interface SessionOrigin {
  via: SessionVia;
  clientKind?: SessionClientKind;
  ip?: string | null;
  /** Сессия телефона, подтвердившая подключение сканом; `null` — прямой вход. */
  parentSessionId?: string | null;
}

/**
 * Сессии Schoolium 1.1.1 (AR-94). SMS-контура нет вовсе: сессия и есть ключ.
 *
 * Живёт 90 дней в httpOnly-cookie и продлевается при активности — школьный
 * сотрудник входит с одного устройства годами. Отзыв: немедленный при
 * деактивации и удалении (AR-92), адресный — из `S-80`, административный —
 * из `S-62` (AR-188: адресно, инцидентом и лимитом роли).
 *
 * Таблица `AppSession` вне tenant-guard осознанно (AR-99): сессия читается ДО
 * того, как тенант известен, — это она его и называет. Изоляция обеспечивается
 * тем, что сессия НЕСЁТ `workspaceId`, который становится тенантом запроса.
 */
@Injectable()
export class SchoolSessionService {
  private readonly log = new Logger('SchoolSession');

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Выдать сессию 90 дней. Каждый маршрут входа называет школу и канал сам.
   *
   * Лимит одновременных сессий (AR-188) применяется ЗДЕСЬ — в единственной
   * точке выдачи: новый вход не отклоняется никогда, вместо этого гаснут самые
   * давние по активности сессии того же человека в той же школе, и каждая
   * такая потеря записывается событием с причиной `limit`. Отказ во входе
   * оставил бы человека без кабинета из-за забытой вкладки — это хуже, чем
   * попросить вкладку войти снова.
   */
  async issue(args: {
    userId: string;
    workspaceId: string;
    roles: string[];
    deviceHint?: string;
  } & SessionOrigin): Promise<{ id: string; token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + ACCESS_PARAMS.sessionDays * DAY_MS);
    // Вытеснение по лимиту и вставка новой сессии — ОДНА транзакция: два
    // одновременных входа одного человека иначе оба насчитали бы «место есть»
    // и оставили бы на одну живую сессию больше лимита.
    const s = await TenantContext.runAsSystem(() =>
      this.prisma.$transaction(async (tx) => {
        await this.enforceLimit(tx, args.userId, args.workspaceId, args.roles);
        return tx.appSession.create({
          data: {
            token,
            userId: args.userId,
            workspaceId: args.workspaceId,
            roles: args.roles,
            deviceHint: args.deviceHint ?? '',
            via: args.via,
            clientKind: args.clientKind ?? 'browser',
            ip: args.ip ? args.ip.slice(0, 45) : null,
            parentSessionId: args.parentSessionId ?? null,
            expiresAt,
          },
        });
      }),
    );
    return { id: s.id, token, expiresAt };
  }

  /**
   * Лимит роли из политики школы: наименьший из ненулевых по ролям человека —
   * совмещение ролей не расширяет лимит, а сужает (строже из двух). Политики
   * нет либо лимиты не заданы — поведение прежнее, без потолка.
   *
   * Работает ВНУТРИ транзакции выдачи: выдачи одного человека в одной школе
   * сериализуются advisory-lock'ом (второй вход ждёт, пока первый не вставит
   * свою строку, и считает уже с ней), а живые строки берутся `FOR UPDATE` —
   * параллельный отзыв той же сессии не перепишет причину.
   */
  private async enforceLimit(tx: Prisma.TransactionClient, userId: string, workspaceId: string, roles: string[]): Promise<void> {
    const policy = await tx.schoolAccessPolicy.findUnique({ where: { workspaceId } });
    const limits = (policy?.sessionLimits ?? {}) as SessionLimits;
    const applicable = roles
      .map((r) => limits[r as keyof SessionLimits])
      .filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0);
    if (applicable.length === 0) return;
    const limit = Math.min(...applicable);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${workspaceId}`}))`;
    const live = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "AppSession"
      WHERE "userId" = ${userId} AND "workspaceId" = ${workspaceId} AND "revokedAt" IS NULL AND "expiresAt" > now()
      ORDER BY "lastSeenAt" ASC
      FOR UPDATE`;
    if (live.length < limit) return;
    const victims = live.slice(0, live.length - limit + 1);
    await tx.appSession.updateMany({
      where: { id: { in: victims.map((v) => v.id) } },
      data: { revokedAt: new Date(), revokedReason: 'limit' },
    });
    // Событие — тем же transactional outbox, что и остальные отзывы (AR-5):
    // аудит узнаёт о потере сессии из леджера, а не из лога сервера.
    await this.outbox.enqueue(
      tx,
      newEvent<SessionRevokedV1>({
        type: SCHOOL_EVENTS.sessionRevoked,
        workspaceId,
        actor: userId,
        payload: { userId, reason: 'limit' },
      }),
    );
    this.log.log(`лимит ${limit} сессий: отозвано ${victims.length} (${userId})`);
  }

  /**
   * Прочитать сессию. Возвращает `null`, если её нет, срок вышел, она отозвана
   * либо членство деактивировано: деактивация закрывает вход немедленно, а не
   * через 90 дней (AR-92).
   */
  async read(token: string): Promise<(SessionUser & { sessionId: string; renewed?: boolean }) | null> {
    return TenantContext.runAsSystem(async () => {
      const s = await this.prisma.appSession.findUnique({ where: { token } });
      if (!s || s.revokedAt || s.expiresAt < new Date()) return null;

      const m = await this.prisma.membership.findFirst({
        where: { userId: s.userId, workspaceId: s.workspaceId },
      });
      if (!m || m.deactivatedAt) {
        await this.prisma.appSession.update({
          where: { id: s.id },
          data: { revokedAt: new Date(), revokedReason: 'deactivated' },
        });
        return null;
      }

      const [user, ws] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: s.userId } }),
        this.prisma.workspace.findUnique({ where: { id: s.workspaceId } }),
      ]);
      // продление при активности — без записи на каждый запрос чаще раза в час.
      // `renewed` сообщает guard'у перевыставить куку: без этого даже
      // 90-дневная кука истекала на клиенте ровно через 90 календарных дней
      // при живой серверной сессии.
      let renewed = false;
      if (Date.now() - s.lastSeenAt.getTime() > 3600_000) {
        renewed = true;
        void this.prisma.appSession
          .update({
            where: { id: s.id },
            data: {
              lastSeenAt: new Date(),
              expiresAt: new Date(Date.now() + ACCESS_PARAMS.sessionDays * DAY_MS),
            },
          })
          .catch(() => undefined);
      }
      return {
        renewed,
        sessionId: s.id,
        florusUserId: s.userId,
        workspaceId: s.workspaceId,
        florusWorkspaceId: null,
        florusOrgId: null,
        // legacy-поля резолва: массив ролей 1.1.1 идёт отдельным полем и имеет приоритет
        role: m.florusRole,
        subRole: m.subRole,
        name: user?.displayName ?? '',
        orgName: ws?.name,
        roles: m.roles,
      };
    });
  }

  list(userId: string) {
    return TenantContext.runAsSystem(() =>
      this.prisma.appSession.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { lastSeenAt: 'desc' },
      }),
    );
  }

  /** Адресное завершение: убивает ровно одну сессию, остальные устройства живут. */
  async revoke(sessionId: string, reason: SessionRevokeReason): Promise<number> {
    const r = await TenantContext.runAsSystem(() =>
      this.prisma.appSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: reason },
      }),
    );
    return r.count;
  }

  /** Отзыв всех сессий человека — деактивация и удаление делают это немедленно. */
  async revokeAllForUser(userId: string, reason: SessionRevokeReason): Promise<number> {
    const r = await TenantContext.runAsSystem(() =>
      this.prisma.appSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: reason },
      }),
    );
    if (r.count) this.log.log(`отозвано сессий: ${r.count} (${reason})`);
    return r.count;
  }

  /**
   * Журнал подключений (AR-187) хранит завершённые сессии `sessionJournalDays`
   * дней — столько же, сколько живёт сама сессия. Дальше строки удаляются:
   * след входа остаётся в аудите событием `staff.session.started.v1`, а
   * строка сессии с адресом — ПДн, которым срок вышел (AR-194). Раз в сутки;
   * `now` подставляется проверкой, чтобы доказать правило без ожидания.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'session-journal-cleanup' })
  async cleanupJournal(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - ACCESS_PARAMS.sessionJournalDays * DAY_MS);
    const r = await TenantContext.runAsSystem(() =>
      this.prisma.appSession.deleteMany({
        where: { OR: [{ revokedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] },
      }),
    );
    if (r.count) this.log.log(`журнал подключений: удалено ${r.count} строк старше ${ACCESS_PARAMS.sessionJournalDays} дней`);
    return r.count;
  }
}
