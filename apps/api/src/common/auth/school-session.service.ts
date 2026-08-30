import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { ACCESS_PARAMS } from '@edustore/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import type { SessionUser } from './flor.service';

/** Имя httpOnly-cookie контура доступа 1.1.1. Legacy `flor_sid` не переиспользуется. */
export const SCHOOL_COOKIE = 'sch_sid';

/**
 * Флаги cookie сессии — ОДНО место на оба маршрута, которые её ставят (вход по
 * коду и вход по ссылке bootstrap). Раздельные литералы уже расходились бы:
 * `secure` там был выведен из `NODE_ENV`, и на стенде по голому IP вход молча
 * не срабатывал — браузер не сохранял cookie, а экран показывал не ошибку, а
 * возврат на форму.
 *
 * `COOKIE_INSECURE=1` снимает `secure` и предназначен ТОЛЬКО для стенда без
 * TLS (демо по IP, локальная проверка). С реальными данными школы он
 * недопустим: cookie уйдёт по открытому каналу.
 */
export const schoolCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_INSECURE !== '1',
});

const DAY_MS = 24 * 3600 * 1000;

/**
 * Сессии Schoolium 1.1.1 (AR-94). SMS-контура нет вовсе: сессия и есть ключ.
 *
 * Живёт 90 дней в httpOnly-cookie и продлевается при активности — школьный
 * сотрудник входит с одного устройства годами. Отзыв: немедленный при
 * деактивации и удалении (AR-92), адресный — из `S-80`.
 *
 * Таблица `AppSession` вне tenant-guard осознанно (AR-99): сессия читается ДО
 * того, как тенант известен, — это она его и называет. Изоляция обеспечивается
 * тем, что сессия НЕСЁТ `workspaceId`, который становится тенантом запроса.
 */
@Injectable()
export class SchoolSessionService {
  private readonly log = new Logger('SchoolSession');

  constructor(private readonly prisma: PrismaService) {}

  /** Выдать сессию 90 дней. Каждый маршрут входа называет школу сам. */
  async issue(args: {
    userId: string;
    workspaceId: string;
    roles: string[];
    deviceHint?: string;
  }): Promise<{ id: string; token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + ACCESS_PARAMS.sessionDays * DAY_MS);
    const s = await TenantContext.runAsSystem(() =>
      this.prisma.appSession.create({
        data: {
          token,
          userId: args.userId,
          workspaceId: args.workspaceId,
          roles: args.roles,
          deviceHint: args.deviceHint ?? '',
          expiresAt,
        },
      }),
    );
    return { id: s.id, token, expiresAt };
  }

  /**
   * Прочитать сессию. Возвращает `null`, если её нет, срок вышел, она отозвана
   * либо членство деактивировано: деактивация закрывает вход немедленно, а не
   * через 90 дней (AR-92).
   */
  async read(token: string): Promise<(SessionUser & { sessionId: string }) | null> {
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
      // продление при активности — без записи на каждый запрос чаще раза в час
      if (Date.now() - s.lastSeenAt.getTime() > 3600_000) {
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
  async revoke(sessionId: string, reason: 'manual' | 'deactivated' | 'deleted' | 'activation_revoked'): Promise<number> {
    const r = await TenantContext.runAsSystem(() =>
      this.prisma.appSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: reason },
      }),
    );
    return r.count;
  }

  /** Отзыв всех сессий человека — деактивация и удаление делают это немедленно. */
  async revokeAllForUser(userId: string, reason: 'deactivated' | 'deleted' | 'manual' | 'activation_revoked'): Promise<number> {
    const r = await TenantContext.runAsSystem(() =>
      this.prisma.appSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: reason },
      }),
    );
    if (r.count) this.log.log(`отозвано сессий: ${r.count} (${reason})`);
    return r.count;
  }
}
