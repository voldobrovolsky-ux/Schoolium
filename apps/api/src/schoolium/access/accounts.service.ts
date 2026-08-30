import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  ACCESS_PARAMS,
  type ActivationTokenDto,
  type CreateGuardianDto,
  type CredentialsDto,
  type FillStaffCardDto,
  type GuardianCardDto,
  type PendingActivationsDto,
  type SchoolRole,
  type StudentAccessDto,
  type TokenStatus,
} from '@edustore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { SchoolSessionService } from '../../common/auth/school-session.service';
import { AccessService } from './access.service';
import { createAccountWithMembership, generatePassword, hashPassword } from '../staff/credentials';
import { SchoolError } from '../schoolium.errors';
import type { SchoolActor } from '../actor';

const MIN = 60_000;

/**
 * Учётки учеников и родителей (AR-155) поверх той же механики, что у персонала:
 * учётку целиком заводит модератор, вход — активация именным QR одним сканом
 * (AR-161), отзыв возвращает карточку в «Не авторизованные» (AR-153).
 *
 * Данные-минимум (G-69): ученик — только ФИО, уже лежащие в записи контингента;
 * родитель — только ФИО. Никаких новых ПДн-полей этот контур не заводит.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SchoolSessionService,
    private readonly access: AccessService,
  ) {}

  // ─────────────── ученик: доступ поверх записи контингента ───────────────

  private async student(id: string) {
    const s = await this.prisma.schoolStudent.findUnique({ where: { id }, include: { class: true } });
    if (!s) throw new NotFoundException('ученик не найден');
    return s;
  }

  async studentAccess(id: string): Promise<StudentAccessDto> {
    const s = await this.student(id);
    if (!s.userId) return { studentId: id, hasAccount: false, username: null, activated: false };
    const [user, membership] = await TenantContext.runAsSystem(() =>
      Promise.all([
        this.prisma.user.findUnique({ where: { id: s.userId! } }),
        this.prisma.membership.findFirst({ where: { userId: s.userId!, workspaceId: s.workspaceId } }),
      ]),
    );
    return {
      studentId: id,
      hasAccount: true,
      username: user?.username ?? null,
      activated: Boolean(membership?.activatedAt),
    };
  }

  /** Заведение доступа ученика: ФИО уже в записи, модератор задаёт только креды. */
  async createStudentAccess(
    id: string,
    dto: Pick<FillStaffCardDto, 'username' | 'password'>,
  ): Promise<{ access: StudentAccessDto; credentials: CredentialsDto }> {
    const s = await this.student(id);
    if (s.userId) throw new ForbiddenException('доступ ученика уже заведён');
    if (!s.lastName || !s.firstName) throw new ForbiddenException('сначала заполните ФИО в профиле ученика');
    const { userId, credentials } = await TenantContext.runAsSystem(() =>
      createAccountWithMembership(this.prisma, {
        workspaceId: s.workspaceId,
        lastName: s.lastName,
        firstName: s.firstName,
        middleName: s.middleName,
        username: dto.username,
        password: dto.password,
        roles: ['student'],
      }),
    );
    await this.prisma.schoolStudent.update({ where: { id }, data: { userId } });
    return { access: await this.studentAccess(id), credentials };
  }

  studentActivationToken(id: string): Promise<ActivationTokenDto> {
    return this.issueToken('student_activation', id, async () => {
      const s = await this.student(id);
      if (!s.userId) throw new ForbiddenException('сначала заведите доступ ученика');
      return [s.lastName, s.firstName].filter(Boolean).join(' ');
    });
  }

  async studentActivationStatus(id: string): Promise<ActivationTokenDto> {
    const s = await this.student(id);
    return this.tokenStatus('student_activation', id, s.userId, s.workspaceId);
  }

  async revokeStudentActivation(id: string, actor: SchoolActor) {
    const s = await this.student(id);
    if (!s.userId) throw new NotFoundException('доступ не заведён');
    await this.revokeActivation('student_activation', id, s.userId, s.workspaceId, actor);
    return this.studentAccess(id);
  }

  async studentCredentials(id: string): Promise<CredentialsDto> {
    const s = await this.student(id);
    if (!s.userId) throw new NotFoundException('доступ не заведён');
    return this.reissuePassword(s.userId);
  }

  // ─────────────── родитель: карточка + связи с детьми (S-14) ───────────────

  async listGuardians(): Promise<GuardianCardDto[]> {
    const cards = await this.prisma.guardianCard.findMany({
      orderBy: { seq: 'asc' },
      include: { links: { include: { student: { include: { class: true } } } } },
    });
    return Promise.all(cards.map((c) => this.guardianDto(c)));
  }

  private async guardianDto(c: {
    id: string;
    workspaceId: string;
    userId: string | null;
    links: { student: { id: string; lastName: string; firstName: string; class: { label: string } } }[];
  }): Promise<GuardianCardDto> {
    const children = c.links.map((l) => ({
      studentId: l.student.id,
      name: [l.student.lastName, l.student.firstName].filter(Boolean).join(' '),
      classLabel: l.student.class.label,
    }));
    if (!c.userId) {
      return { id: c.id, userId: null, name: null, lastName: null, firstName: null, middleName: null, username: null, registered: false, children };
    }
    const [user, membership] = await TenantContext.runAsSystem(() =>
      Promise.all([
        this.prisma.user.findUnique({ where: { id: c.userId! } }),
        this.prisma.membership.findFirst({ where: { userId: c.userId!, workspaceId: c.workspaceId } }),
      ]),
    );
    return {
      id: c.id,
      userId: c.userId,
      name: user?.displayName ?? null,
      lastName: user?.lastName ?? null,
      firstName: user?.firstName ?? null,
      middleName: user?.middleName ?? null,
      username: user?.username ?? null,
      registered: Boolean(membership?.activatedAt),
      children,
    };
  }

  async createGuardian(dto: CreateGuardianDto): Promise<{ card: GuardianCardDto; credentials: CredentialsDto }> {
    const ws = TenantContext.require();
    const { userId, credentials } = await TenantContext.runAsSystem(() =>
      createAccountWithMembership(this.prisma, { workspaceId: ws, ...dto, roles: ['parent'] }),
    );
    const seq = await this.prisma.guardianCard.count();
    const card = await this.prisma.guardianCard.create({ data: { workspaceId: ws, userId, seq } });
    for (const sid of dto.studentIds ?? []) await this.addLink(card.id, sid);
    return { card: await this.getGuardian(card.id), credentials };
  }

  async getGuardian(id: string): Promise<GuardianCardDto> {
    const c = await this.prisma.guardianCard.findUnique({
      where: { id },
      include: { links: { include: { student: { include: { class: true } } } } },
    });
    if (!c) throw new NotFoundException('карточка родителя не найдена');
    return this.guardianDto(c);
  }

  /** Связь родитель→ребёнок ведёт модератор вручную (решение владельца 2026-08-28). */
  async addLink(guardianCardId: string, studentId: string) {
    const [card, s] = await Promise.all([
      this.prisma.guardianCard.findUnique({ where: { id: guardianCardId } }),
      this.student(studentId),
    ]);
    if (!card) throw new NotFoundException('карточка родителя не найдена');
    await this.prisma.guardianLink.upsert({
      where: { guardianCardId_studentId: { guardianCardId, studentId } },
      update: {},
      create: { workspaceId: card.workspaceId, guardianCardId, studentId: s.id },
    });
    return this.getGuardian(guardianCardId);
  }

  async removeLink(guardianCardId: string, studentId: string) {
    await this.prisma.guardianLink.deleteMany({ where: { guardianCardId, studentId } });
    return this.getGuardian(guardianCardId);
  }

  /** У родителя истории нет по построению (проекции без записи) — удаляется свободно. */
  async removeGuardian(id: string, actor: SchoolActor) {
    const c = await this.prisma.guardianCard.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('карточка родителя не найдена');
    if (c.userId) {
      await this.sessions.revokeAllForUser(c.userId, 'deleted');
      await TenantContext.runAsSystem(() =>
        this.prisma.membership.deleteMany({ where: { userId: c.userId!, workspaceId: c.workspaceId } }),
      );
      await this.access.publishSessionRevoked(c.userId, c.workspaceId, 'deleted', actor.userId);
    }
    await this.prisma.guardianCard.delete({ where: { id } });
    return { ok: true };
  }

  guardianActivationToken(id: string): Promise<ActivationTokenDto> {
    return this.issueToken('guardian_activation', id, async () => {
      const c = await this.prisma.guardianCard.findUnique({ where: { id } });
      if (!c?.userId) throw new ForbiddenException('сначала заведите учётку родителя');
      const u = await TenantContext.runAsSystem(() => this.prisma.user.findUnique({ where: { id: c.userId! } }));
      return [u?.lastName, u?.firstName].filter(Boolean).join(' ');
    });
  }

  async guardianActivationStatus(id: string): Promise<ActivationTokenDto> {
    const c = await this.prisma.guardianCard.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('карточка родителя не найдена');
    return this.tokenStatus('guardian_activation', id, c.userId, c.workspaceId);
  }

  async revokeGuardianActivation(id: string, actor: SchoolActor) {
    const c = await this.prisma.guardianCard.findUnique({ where: { id } });
    if (!c?.userId) throw new NotFoundException('учётка не заведена');
    await this.revokeActivation('guardian_activation', id, c.userId, c.workspaceId, actor);
    return this.getGuardian(id);
  }

  async guardianCredentials(id: string): Promise<CredentialsDto> {
    const c = await this.prisma.guardianCard.findUnique({ where: { id } });
    if (!c?.userId) throw new NotFoundException('учётка не заведена');
    return this.reissuePassword(c.userId);
  }

  // ─────────────── «Не авторизованные» (S-32) ───────────────

  /**
   * Рабочий экран модератора на событии: все заведённые, но не активированные
   * учётки, сгруппированные персонал / классы / родители. Активация убирает
   * строку сама (поллинг экрана), «остаток» после события — план добора.
   */
  async pending(): Promise<PendingActivationsDto> {
    const ws = TenantContext.require();
    const [staffCards, students, guardians] = await Promise.all([
      this.prisma.staffCard.findMany({ where: { userId: { not: null } }, orderBy: [{ section: 'asc' }, { seq: 'asc' }] }),
      this.prisma.schoolStudent.findMany({
        where: { deactivatedAt: null },
        include: { class: true },
        orderBy: [{ classId: 'asc' }, { lastName: 'asc' }],
      }),
      this.prisma.guardianCard.findMany({ orderBy: { seq: 'asc' } }),
    ]);
    const userIds = [
      ...staffCards.map((c) => c.userId!),
      ...students.map((s) => s.userId).filter((v): v is string => Boolean(v)),
      ...guardians.map((g) => g.userId).filter((v): v is string => Boolean(v)),
    ];
    const [memberships, users] = await TenantContext.runAsSystem(() =>
      Promise.all([
        this.prisma.membership.findMany({ where: { workspaceId: ws, userId: { in: userIds } } }),
        this.prisma.user.findMany({ where: { id: { in: userIds } } }),
      ]),
    );
    const activated = new Set(memberships.filter((m) => m.activatedAt).map((m) => m.userId));
    const nameOf = new Map(users.map((u) => [u.id, [u.lastName, u.firstName].filter(Boolean).join(' ') || u.displayName]));

    const staff = staffCards
      .filter((c) => !activated.has(c.userId!))
      .map((c) => ({ cardId: c.id, name: nameOf.get(c.userId!) ?? '', roles: c.plannedRoles as SchoolRole[] }));

    const byClass = new Map<string, { classId: string; classLabel: string; items: { studentId: string; name: string; hasAccount: boolean }[] }>();
    for (const s of students) {
      if (s.userId && activated.has(s.userId)) continue;
      const g = byClass.get(s.classId) ?? { classId: s.classId, classLabel: s.class.label, items: [] };
      g.items.push({
        studentId: s.id,
        name: [s.lastName, s.firstName].filter(Boolean).join(' ') || `ученик №${s.seq + 1}`,
        hasAccount: Boolean(s.userId),
      });
      byClass.set(s.classId, g);
    }

    return {
      staff,
      students: [...byClass.values()],
      guardians: guardians
        .filter((g) => !g.userId || !activated.has(g.userId))
        .map((g) => ({ cardId: g.id, name: g.userId ? (nameOf.get(g.userId) ?? '') : '' })),
    };
  }

  // ─────────────── общая механика токенов и отзыва ───────────────

  private async issueToken(
    purpose: 'student_activation' | 'guardian_activation',
    targetId: string,
    fullNameOf: () => Promise<string>,
  ): Promise<ActivationTokenDto> {
    const ws = TenantContext.require();
    const fullName = await fullNameOf();
    const t = await this.prisma.activationToken.create({
      data: {
        workspaceId: ws,
        token: randomBytes(20).toString('hex'),
        purpose,
        targetId,
        roles: [purpose === 'student_activation' ? 'student' : 'parent'],
        expiresAt: new Date(Date.now() + ACCESS_PARAMS.activationTtlMinutes * MIN),
      },
    });
    return { token: t.token, status: 'waiting', expiresAt: t.expiresAt.toISOString(), fullName };
  }

  private async tokenStatus(
    purpose: string,
    targetId: string,
    userId: string | null,
    workspaceId: string,
  ): Promise<ActivationTokenDto> {
    const t = await this.prisma.activationToken.findFirst({
      where: { purpose, targetId },
      orderBy: { createdAt: 'desc' },
    });
    const membership = userId
      ? await TenantContext.runAsSystem(() =>
          this.prisma.membership.findFirst({ where: { userId, workspaceId } }),
        )
      : null;
    const user = userId
      ? await TenantContext.runAsSystem(() => this.prisma.user.findUnique({ where: { id: userId } }))
      : null;
    const fullName = user ? [user.lastName, user.firstName].filter(Boolean).join(' ') || user.displayName : null;
    const registeredName = membership?.activatedAt ? fullName : null;
    if (!t) return { token: '', status: 'expired', expiresAt: new Date().toISOString(), registeredName, fullName };
    const status: TokenStatus = t.state === 'used' ? 'used' : t.expiresAt < new Date() ? 'expired' : (t.state as TokenStatus);
    return { token: t.token, status, expiresAt: t.expiresAt.toISOString(), registeredName, fullName };
  }

  private async revokeActivation(
    purpose: string,
    targetId: string,
    userId: string,
    workspaceId: string,
    actor: SchoolActor,
  ): Promise<void> {
    await this.sessions.revokeAllForUser(userId, 'activation_revoked');
    await TenantContext.runAsSystem(() =>
      this.prisma.membership.updateMany({ where: { userId, workspaceId }, data: { activatedAt: null } }),
    );
    await this.prisma.activationToken.updateMany({
      where: { purpose, targetId, state: 'waiting' },
      data: { state: 'expired' },
    });
    await this.access.publishSessionRevoked(userId, workspaceId, 'activation_revoked', actor.userId);
  }

  private async reissuePassword(userId: string): Promise<CredentialsDto> {
    const password = generatePassword();
    const user = await TenantContext.runAsSystem(() =>
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash: hashPassword(password) } }),
    );
    return { username: user.username ?? '', password };
  }
}
