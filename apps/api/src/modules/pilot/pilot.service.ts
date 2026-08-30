import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { StructureService } from '../structure/structure.service';
import {
  ARCHIMED_FLOR_WS_ID,
  ARCHIMED_NAME,
  toSessionRole,
  type CabinetState,
  type PilotRole,
} from './pilot.contract';

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // как у OIDC-сессии
const INVITE_TTL_MS = 7 * 24 * 3600 * 1000; // одноразовый инвайт живёт неделю

/**
 * Пилотный auth (AUTH_MODE=pilot-qr, ВРЕМЕННЫЙ). Owner-экран: добавить сотрудника → QR, создать
 * дисциплину/класс (переиспользует StructureService), назначить (существующая TeachingAssignment).
 * QR-вход резолвится по инвайт-токену (НЕ по телефону) и выдаёт сессию ТОЙ ЖЕ формы, что Флёр OIDC.
 */
@Injectable()
export class PilotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly structure: StructureService,
  ) {}

  /** Школа «Архимед» с ПОСТОЯННЫМ florusWorkspaceId (Флёр позже прикрутится к нему же). Идемпотентно. */
  private ensureArchimed(): Promise<string> {
    return TenantContext.runAsSystem(async () => {
      const platform = await this.prisma.organization.upsert({
        where: { id: 'org-edustore-platform' },
        update: {},
        create: { id: 'org-edustore-platform', name: 'EduStore', type: 'platform', status: 'active' },
      });
      const ws = await this.prisma.workspace.upsert({
        where: { florusWorkspaceId: ARCHIMED_FLOR_WS_ID },
        update: {},
        create: { florusWorkspaceId: ARCHIMED_FLOR_WS_ID, orgId: platform.id, name: ARCHIMED_NAME, status: 'active' },
      });
      return ws.id;
    });
  }

  // ─── Owner-экран ───
  async createInvite(input: { role: PilotRole; displayName?: string }) {
    const workspaceId = await this.ensureArchimed();
    const token = randomBytes(9).toString('base64url'); // одноразовый инвайт из QR
    const invite = await TenantContext.runAsSystem(() =>
      this.prisma.pilotInvite.create({
        data: { workspaceId, role: input.role, displayName: input.displayName ?? null, token },
      }),
    );
    return { inviteId: invite.id, token, role: invite.role, displayName: invite.displayName };
  }

  /** Список сотрудников: видны сразу; вход/назначение; ярлыки назначений; token — для повторного QR. */
  async listStaff() {
    const workspaceId = await this.ensureArchimed();
    return TenantContext.runAsSystem(async () => {
      const invites = await this.prisma.pilotInvite.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
      const userIds = invites.flatMap((i) => (i.userId ? [i.userId] : []));
      const assigns = userIds.length
        ? await this.prisma.teachingAssignment.findMany({
            where: { workspaceId, teacherId: { in: userIds } },
            include: { class: { select: { label: true } }, subject: { select: { name: true } } },
          })
        : [];
      const byTeacher = new Map<string, string[]>();
      for (const a of assigns) {
        const label = `${a.class.label} · ${a.subject.name}`;
        byTeacher.set(a.teacherId, [...(byTeacher.get(a.teacherId) ?? []), label]);
      }
      return invites.map((i) => ({
        inviteId: i.id,
        role: i.role,
        displayName: i.displayName,
        phone: i.phone,
        status: i.status,
        userId: i.userId,
        loggedIn: !!i.userId,
        assigned: !!(i.userId && byTeacher.has(i.userId)),
        assignments: i.userId ? byTeacher.get(i.userId) ?? [] : [],
        // токен отдаём ТОЛЬКО пока сотрудник не вошёл (повторный показ QR); после входа он не нужен
        token: i.userId ? null : i.token,
      }));
    });
  }

  /** Отозвать приглашение: только пока сотрудник НЕ вошёл (active — уже человек с данными, не отзываем в один клик). */
  async revokeInvite(inviteId: string) {
    return TenantContext.runAsSystem(async () => {
      const invite = await this.prisma.pilotInvite.findUnique({ where: { id: inviteId } });
      if (!invite) throw new NotFoundException('приглашение не найдено');
      if (invite.userId) {
        throw new ConflictException({ code: 'INVITE_ACTIVE', message: 'сотрудник уже вошёл — отзыв приглашения невозможен' });
      }
      await this.prisma.pilotInvite.delete({ where: { id: inviteId } });
      return { ok: true };
    });
  }

  createClass(dto: { parallel: number; letter: string }) {
    return this.inArchimed((ws) => this.structure.createClass(dto));
  }
  listClasses() {
    return this.inArchimed(() => this.structure.listClasses());
  }
  createSubject(dto: { name: string; color?: string }) {
    return this.inArchimed(() => this.structure.createSubject(dto));
  }
  listSubjects() {
    return this.inArchimed(() => this.structure.listSubjects());
  }

  /** Назначение сотрудника → дисциплина/класс: существующая TeachingAssignment (не изобретаем). */
  assign(input: { userId: string; classId: string; subjectId: string; subGroupId?: string }) {
    return this.inArchimed(async (ws) => {
      const res = await this.structure.assign({ teacherId: input.userId, classId: input.classId, subjectId: input.subjectId, subGroupId: input.subGroupId });
      await this.ensureTimetable(ws, input.classId);
      return res;
    });
  }

  /**
   * Пилотный стаб геометрии: у свежесозданного класса нет Timetable → Solver не смог бы разложить
   * КПП (NO_TIMETABLE). Первое назначение на класс заводит дефолтную сетку 5 дней × 4 слота
   * (идемпотентно). Реальная сборка геометрии — у завуча/движка, вне пилотного онбординга.
   */
  private async ensureTimetable(workspaceId: string, classId: string): Promise<void> {
    const exists = await this.prisma.timetable.findFirst({ where: { classId } });
    if (exists) return;
    await this.prisma.timetable.create({
      data: {
        workspaceId,
        classId,
        source: 'pilot-default',
        slots: {
          create: Array.from({ length: 20 }, (_, i) => ({
            workspaceId,
            day: Math.floor(i / 4) + 1,
            position: (i % 4) + 1,
            durationMin: 45,
          })),
        },
      },
    });
  }

  // ─── QR-вход ───
  /**
   * Резолв входа ПО ТОКЕНУ (не по телефону — номер только ярлык/подпись). Первый вход создаёт
   * User/Membership/Teacher; выдаёт Session ТОЙ ЖЕ формы, что Флёр OIDC (role/workspace_id).
   */
  async resolveInvite(input: { token: string; phone?: string }): Promise<{ sid: string; userId: string }> {
    const invite = await TenantContext.runAsSystem(() => this.prisma.pilotInvite.findUnique({ where: { token: input.token } }));
    if (!invite) throw new NotFoundException('приглашение не найдено или истекло');
    // одноразовость: токен используется РОВНО один раз (bootstrap). После входа — только cookie-сессия;
    // повторный вход = новый инвайт от owner. Закрывает replay токена из URL/истории/логов.
    if (invite.userId) throw new ConflictException({ code: 'INVITE_USED', message: 'приглашение уже использовано — попросите новый QR' });
    if (Date.now() - invite.createdAt.getTime() > INVITE_TTL_MS) throw new NotFoundException('приглашение истекло — попросите новый QR');
    const { florusRole, subRole } = toSessionRole(invite.role as PilotRole);
    const name = invite.displayName ?? (input.phone ? `Сотрудник ${input.phone}` : 'Сотрудник');

    return TenantContext.runAsSystem(async () => {
      let userId = invite.userId; // всегда null здесь (одноразовость проверена выше)
      if (!userId) {
        // первый вход — генерируем florus_user_id (реальный Флёр-sub позже = отдельная сверка идентичности)
        userId = `pilot-${randomBytes(12).toString('hex')}`;
        await this.prisma.user.create({ data: { id: userId, firstName: name, lastName: '', displayName: name } });
        await this.prisma.membership.create({ data: { florusUserId: userId, workspaceId: invite.workspaceId, florusRole, subRole } });
        await this.prisma.teacher.create({ data: { id: userId, workspaceId: invite.workspaceId } });
        await this.prisma.pilotInvite.update({ where: { id: invite.id }, data: { userId, phone: input.phone ?? invite.phone, status: 'active' } });
      }
      const sid = randomBytes(24).toString('base64url');
      await this.prisma.session.create({
        data: {
          sid,
          florusUserId: userId,
          workspaceId: invite.workspaceId,
          florusWorkspaceId: ARCHIMED_FLOR_WS_ID,
          florusOrgId: null,
          role: florusRole,
          subRole,
          name,
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        },
      });
      return { sid, userId };
    });
  }

  /** Состояние кабинета: назначены ли дисциплина/класс. «preparing» — спокойный статус, не ошибка. */
  async cabinetState(userId: string): Promise<CabinetState> {
    const count = await this.inArchimed(() => this.prisma.teachingAssignment.count({ where: { teacherId: userId } }));
    return count === 0
      ? { state: 'preparing', message: 'Мы подготавливаем вам рабочее место, это может занять несколько минут.' }
      : { state: 'ready' };
  }

  /** Выполнить операцию в tenant-контексте «Архимеда» (StructureService пишет по TenantContext.require()). */
  private async inArchimed<T>(fn: (ws: string) => Promise<T> | T): Promise<T> {
    const ws = await this.ensureArchimed();
    return TenantContext.run({ tenantId: ws, system: false }, () => fn(ws));
  }
}
