import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  ACCESS_PARAMS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  effectiveRoleLimit,
  type ActivationTokenDto,
  type CreateStaffCardDto,
  type CredentialsDto,
  type FillStaffCardDto,
  type IssueLoginLinkDto,
  type LoginLinkDto,
  type RoleLimits,
  type SchoolRole,
  type SessionClientKind,
  type SetStaffPasswordDto,
  type StaffActivityDto,
  type StaffCardDto,
  type TokenStatus,
  type UpdateStaffAccountDto,
} from '@edustore/shared';
import type { PrismaClient } from '@prisma/client';
import { createAccountWithMembership, generatePassword, hashPassword, resolveUsername } from './credentials';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { OutboxService } from '../../common/outbox/outbox.service';
import { newEvent } from '../../common/events/domain-event';
import { SchoolSessionService } from '../../common/auth/school-session.service';
import {
  SCHOOL_EVENTS,
  type AccountUpdatedV1,
  type PasswordSetV1,
  type StaffDeactivatedV1,
  type StaffDeletedV1,
  type StaffReactivatedV1,
  type StaffRegisteredV1,
  type TeacherUnboundV1,
} from '../schoolium.contract';
import { SchoolError } from '../schoolium.errors';
import { AccessService } from '../access/access.service';
import { JournalContractService } from '../journal/journal.service';
import { SubjectsContractService } from '../subjects/subjects.service';
import type { SchoolActor } from '../actor';
import { journalSince, sessionsOfUser, withoutAddress } from '../cabinets/session-view';

const MIN = 60_000;

/**
 * Носители роли в школе (AR-205, уточняет AR-182): живые членства
 * (`deactivatedAt: null`) ПЛЮС пустые bootstrap-слоты (`userId: null`,
 * `plannedRoles` содержит роль) — слот заполнится этой ролью, значит он уже
 * носитель. Деактивированные не считаются: их роль освобождена (AR-89).
 *
 * Одна функция на проверку лимита (`StaffService.assertRoleFree`), на ответ
 * политики (`AccessPolicyDto.roleHolders`) и на предупреждение консольного
 * `school:provision` — цифра «занято N» везде одна (П-5). Вызывать вне
 * tenant-guard либо под `TenantContext.runAsSystem`: фильтр по школе явный.
 */
export async function countRoleHolders(
  db: Pick<PrismaClient, 'membership' | 'staffCard'>,
  workspaceId: string,
  role: SchoolRole,
): Promise<number> {
  const [members, slots] = await Promise.all([
    db.membership.count({ where: { workspaceId, deactivatedAt: null, roles: { has: role } } }),
    db.staffCard.count({ where: { workspaceId, userId: null, plannedRoles: { has: role } } }),
  ]);
  return members + slots;
}

/**
 * Персонал: карточки, присутственная QR-регистрация (AR-76), роли (AR-102),
 * удаление, деактивация и реактивация (AR-89).
 *
 * Отдельной секции «Модераторы» на `S-30` нет: модератор — уровень доступа, а не
 * должность в штатном расписании школы. Роль выдаётся кнопкой «Добавить роль» на
 * карточке любого зарегистрированного сотрудника и той же кнопкой снимается.
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly sessions: SchoolSessionService,
    private readonly access: AccessService,
    private readonly journal: JournalContractService,
    private readonly subjects: SubjectsContractService,
  ) {}

  // ─────────────── чтение ───────────────

  async list(): Promise<StaffCardDto[]> {
    const cards = await this.prisma.staffCard.findMany({ orderBy: [{ section: 'asc' }, { seq: 'asc' }] });
    return Promise.all(cards.map((c) => this.toDto(c)));
  }

  async get(id: string): Promise<StaffCardDto> {
    const c = await this.prisma.staffCard.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('карточка не найдена');
    return this.toDto(c);
  }

  private async toDto(c: { id: string; section: number; plannedRoles: string[]; userId: string | null; workspaceId: string }): Promise<StaffCardDto> {
    if (!c.userId) {
      // пустая карточка-слот (синглтон из bootstrap до заведения учётки)
      return {
        id: c.id,
        section: c.section as 1 | 2 | 3,
        roles: c.plannedRoles as SchoolRole[],
        registered: false,
        filled: false,
        userId: null,
        name: null,
        lastName: null,
        firstName: null,
        middleName: null,
        username: null,
        avatarUrl: null,
        deactivated: false,
        hasHistory: false,
      };
    }
    const [user, membership] = await TenantContext.runAsSystem(() =>
      Promise.all([
        this.prisma.user.findUnique({ where: { id: c.userId! } }),
        this.prisma.membership.findFirst({ where: { userId: c.userId!, workspaceId: c.workspaceId } }),
      ]),
    );
    return {
      id: c.id,
      section: c.section as 1 | 2 | 3,
      // роли живут в членстве — оно единственный их носитель
      roles: (membership?.roles ?? []) as SchoolRole[],
      // 1.2.0 (AR-161): «зарегистрирован» = активировал вход, а не «форма заполнена»
      registered: Boolean(membership?.activatedAt),
      filled: true,
      userId: c.userId,
      name: user?.displayName ?? null,
      lastName: user?.lastName ?? null,
      firstName: user?.firstName ?? null,
      middleName: user?.middleName ?? null,
      username: user?.username ?? null,
      avatarUrl: user?.avatarUrl ?? null,
      deactivated: membership?.deactivatedAt !== null && membership?.deactivatedAt !== undefined,
      hasHistory: await this.hasHistory(c.userId),
    };
  }

  /**
   * «История» сотрудника (AR-89): привязки к предметам либо выставленные отметки.
   * Решает СЕРВЕР, а не интерфейс: ответ карточки несёт `hasHistory`, и экран
   * показывает ровно одну кнопку из двух.
   */
  private async hasHistory(userId: string): Promise<boolean> {
    if (await this.subjects.hasBindings(userId)) return true;
    return this.journal.teacherHasMarks(userId);
  }

  // ─────────────── заведение учётки модератором (AR-154, AR-161) ───────────────

  /**
   * Учётку целиком заводит модератор: ФИО + юзернейм (пустой — транслитерация
   * ФИО) + пароль (пустой — генерация). Пароль возвращается открытым текстом
   * ОДИН раз — на карточку модератора; человек при активации не вводит ничего.
   */
  private async createAccount(
    workspaceId: string,
    dto: FillStaffCardDto,
    roles: SchoolRole[],
  ): Promise<{ userId: string; credentials: CredentialsDto }> {
    return TenantContext.runAsSystem(() =>
      createAccountWithMembership(this.prisma, { workspaceId, ...dto, roles }),
    );
  }

  /**
   * `S-30.btn.addFounder` / `addTeacher` / `addDeputyAcademic` /
   * `addDeputyUpbringing`: карточка + учётка сразу. Роль с лимитом носителей
   * (AR-205; дефолт 1 у директора и замов — прежние синглтоны AR-182)
   * ЗАВОДИТСЯ, пока лимит не исчерпан: bootstrap слотов замов не создаёт, и
   * безусловный запрет оставлял школу без завуча.
   */
  async addCard(dto: CreateStaffCardDto): Promise<{ card: StaffCardDto; credentials: CredentialsDto }> {
    const role = dto.role;
    const ws = TenantContext.require();
    await this.assertRoleFree(ws, role);
    const section = role === 'founder' || role === 'director' ? 1 : role === 'teacher' ? 3 : 2;
    const seq = await this.prisma.staffCard.count({ where: { section } });
    const { userId, credentials } = await this.createAccount(ws, dto, [role]);
    const c = await this.prisma.staffCard.create({
      data: { workspaceId: ws, section, plannedRoles: [role], seq, userId },
    });
    return { card: await this.get(c.id), credentials };
  }

  /** Заполнение пустой карточки-слота (синглтоны из bootstrap): та же учётка. */
  async fillCard(cardId: string, dto: FillStaffCardDto): Promise<{ card: StaffCardDto; credentials: CredentialsDto }> {
    const card = await this.prisma.staffCard.findUnique({ where: { id: cardId } });
    if (!card) throw new NotFoundException('карточка не найдена');
    if (card.userId) throw new ForbiddenException('учётка на карточке уже заведена');
    const { userId, credentials } = await this.createAccount(card.workspaceId, dto, card.plannedRoles as SchoolRole[]);
    await this.prisma.staffCard.update({ where: { id: cardId }, data: { userId } });
    return { card: await this.get(cardId), credentials };
  }

  /** `S-31.btn.reissuePassword`: новый пароль, показан модератору один раз (= `setPassword` с пустым полем, AR-203). */
  async regenerateCredentials(cardId: string, actor: SchoolActor): Promise<CredentialsDto> {
    return this.setPassword(cardId, {}, actor);
  }

  // ─────────────── учётка с карточки (§11 строки 51, 52; AR-203) ───────────────

  /**
   * `S-31.btn.saveAccount` → `PUT /staff/:id/account`: ФИО и логин учётки
   * правит `staff.manage`. Юзернейм уникален на всю инсталляцию (AR-154) —
   * занятый в другой школе тоже `USERNAME_TAKEN`; `displayName` пересобирается
   * тем же правилом, что при заведении. Событие несёт список изменённых полей,
   * сами значения в аудит не едут.
   */
  async updateAccount(cardId: string, dto: UpdateStaffAccountDto, actor: SchoolActor): Promise<StaffCardDto> {
    const { membership, userId, workspaceId } = await this.registered(cardId);
    this.assertMayManageAccount(membership, actor, await this.displayNameOf(userId));
    const lastName = String(dto?.lastName ?? '').trim();
    const firstName = String(dto?.firstName ?? '').trim();
    if (!lastName || !firstName) throw new BadRequestException('фамилия и имя обязательны');
    const middleName = dto?.middleName === undefined || dto?.middleName === null ? null : String(dto.middleName).trim() || null;
    const given = String(dto?.username ?? '').trim().toLowerCase();

    const user = await TenantContext.runAsSystem(() => this.prisma.user.findUnique({ where: { id: userId } }));
    if (!user) throw new NotFoundException('учётка не найдена');
    // тот же логин — не занятость: правила и занятость проверяются только при смене
    const username =
      given === (user.username ?? '')
        ? (user.username ?? '')
        : await TenantContext.runAsSystem(() => resolveUsername(this.prisma, given, { lastName, firstName }));

    const fields: string[] = [];
    if (lastName !== user.lastName) fields.push('lastName');
    if (firstName !== user.firstName) fields.push('firstName');
    if (middleName !== (user.middleName ?? null)) fields.push('middleName');
    if (username !== (user.username ?? '')) fields.push('username');
    if (fields.length === 0) return this.get(cardId);

    const displayName = `${lastName} ${firstName}`.trim();
    await TenantContext.runAsSystem(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: { lastName, firstName, middleName, displayName, username },
        });
        await this.outbox.enqueue(
          tx,
          newEvent<AccountUpdatedV1>({
            type: SCHOOL_EVENTS.accountUpdated,
            workspaceId,
            actor: actor.userId,
            payload: { userId, updatedBy: actor.userId, fields },
          }),
        );
      }),
    );
    return this.get(cardId);
  }

  /**
   * `M-32.btn.save` → `POST /staff/:id/password` и `S-31.btn.reissuePassword`:
   * пустое поле — пароль генерируется (`generated: true`), иначе берётся заданный
   * (короче `passwordMinLength` — `PASSWORD_TOO_SHORT`). Хранится только bcrypt-хэш,
   * открытый текст показывается один раз в ответе и в событие не попадает (AR-156).
   */
  async setPassword(cardId: string, dto: SetStaffPasswordDto, actor: SchoolActor): Promise<CredentialsDto> {
    const { membership, userId, workspaceId } = await this.registered(cardId);
    this.assertMayManageAccount(membership, actor, await this.displayNameOf(userId));
    const given = String(dto?.password ?? '').trim();
    const generated = given === '';
    const password = generated ? generatePassword() : given;
    const passwordHash = hashPassword(password);
    const user = await TenantContext.runAsSystem(() =>
      this.prisma.$transaction(async (tx) => {
        const u = await tx.user.update({ where: { id: userId }, data: { passwordHash } });
        await this.outbox.enqueue(
          tx,
          newEvent<PasswordSetV1>({
            type: SCHOOL_EVENTS.passwordSet,
            workspaceId,
            actor: actor.userId,
            payload: { userId, setBy: actor.userId, generated },
          }),
        );
        return u;
      }),
    );
    return { username: user.username ?? '', password };
  }

  /** Живая проверка занятости юзернейма для формы заведения учётки. */
  async usernameFree(username: string): Promise<{ free: boolean }> {
    const u = username.trim().toLowerCase();
    const taken = await TenantContext.runAsSystem(() => this.prisma.user.findUnique({ where: { username: u } }));
    return { free: !taken };
  }

  // ─────────────── QR-активация (§11 строка 4, AR-76, AR-87) ───────────────

  /** Именной QR (AR-161): подпись над кодом — ФИО владельца карточки. */
  async createActivationToken(cardId: string): Promise<ActivationTokenDto> {
    const ws = TenantContext.require();
    const card = await this.prisma.staffCard.findUnique({ where: { id: cardId } });
    if (!card) throw new NotFoundException('карточка не найдена');
    if (!card.userId) throw new ForbiddenException('сначала заведите учётку: ФИО и юзернейм');
    const t = await this.prisma.activationToken.create({
      data: {
        workspaceId: ws,
        token: randomBytes(20).toString('hex'),
        purpose: 'staff_activation',
        targetId: cardId,
        roles: card.plannedRoles,
        expiresAt: new Date(Date.now() + ACCESS_PARAMS.activationTtlMinutes * MIN),
      },
    });
    return { token: t.token, status: 'waiting', expiresAt: t.expiresAt.toISOString(), fullName: await this.fullName(card.userId) };
  }

  private async fullName(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const u = await TenantContext.runAsSystem(() => this.prisma.user.findUnique({ where: { id: userId } }));
    return u ? [u.lastName, u.firstName].filter(Boolean).join(' ') || u.displayName : null;
  }

  /** Поллинг статуса раз в 2 секунды, пока карточка открыта (AR-87). */
  async activationStatus(cardId: string): Promise<ActivationTokenDto> {
    const t = await this.prisma.activationToken.findFirst({
      where: { purpose: 'staff_activation', targetId: cardId },
      orderBy: { createdAt: 'desc' },
    });
    const card = await this.prisma.staffCard.findUnique({ where: { id: cardId } });
    // «Зарегистрирован: ФИО» — только после активации (AR-161), а не по факту
    // заведения учётки: её модератор завёл сам и это не событие
    const membership = card?.userId
      ? await TenantContext.runAsSystem(() =>
          this.prisma.membership.findFirst({ where: { userId: card.userId!, workspaceId: card.workspaceId } }),
        )
      : null;
    const registeredName = membership?.activatedAt ? await this.fullName(card!.userId) : null;
    const fullName = await this.fullName(card?.userId ?? null);
    if (!t) return { token: '', status: 'expired', expiresAt: new Date().toISOString(), registeredName, fullName };
    const status: TokenStatus = t.state === 'used' ? 'used' : t.expiresAt < new Date() ? 'expired' : (t.state as TokenStatus);
    return { token: t.token, status, expiresAt: t.expiresAt.toISOString(), registeredName, fullName };
  }

  /** `S-31.btn.close`: закрытие карточки ГАСИТ QR — код не переживает встречу. */
  async closeCard(cardId: string) {
    await this.prisma.activationToken.updateMany({
      where: { purpose: 'staff_activation', targetId: cardId, state: 'waiting' },
      data: { state: 'expired' },
    });
    return { ok: true };
  }

  // ─────────────── активация одним сканом (§11 строка 5, AR-161) ───────────────

  /**
   * Скан именного QR — и всё: учётка заведена модератором целиком, человек не
   * вводит ничего, скан и есть подтверждение «я — это я». Устройство становится
   * верифицированным носителем: сессия 90 дней, кабинет роли сразу.
   *
   * Сессия выдаётся, только если страницу открыл САМ человек (AR-91): чужое
   * устройство не становится его кабинетом — с устройства модератора активация
   * не проходит, вход выполняется кодом с карточки.
   */
  async activate(
    token: string,
    opts: { openedByOtherSession: boolean; deviceHint: string; clientKind?: SessionClientKind; ip?: string | null },
  ) {
    const t = await TenantContext.runAsSystem(() =>
      this.prisma.activationToken.findUnique({ where: { token } }),
    );
    const purposes = ['staff_activation', 'student_activation', 'guardian_activation'];
    if (!t || !purposes.includes(t.purpose)) throw new SchoolError('TOKEN_EXPIRED');
    if (t.state === 'used') throw new SchoolError('TOKEN_USED');
    if (t.expiresAt < new Date() || t.state === 'expired') throw new SchoolError('TOKEN_EXPIRED');

    const ws = t.workspaceId;

    return TenantContext.runAsSystem(async () => {
      // один маршрут скана на все три вида карточек: различие только в том, где
      // карточка хранит учётку (персонал / запись контингента / родитель)
      const userId =
        t.purpose === 'staff_activation'
          ? (await this.prisma.staffCard.findUnique({ where: { id: t.targetId } }))?.userId
          : t.purpose === 'student_activation'
            ? (await this.prisma.schoolStudent.findUnique({ where: { id: t.targetId } }))?.userId
            : (await this.prisma.guardianCard.findUnique({ where: { id: t.targetId } }))?.userId;
      if (!userId) throw new SchoolError('TOKEN_EXPIRED');
      const membership = await this.prisma.membership.findFirst({ where: { userId, workspaceId: ws } });
      if (!membership || membership.deactivatedAt) throw new SchoolError('ACCESS_REVOKED');
      const roles = membership.roles as SchoolRole[];

      await this.prisma.$transaction(async (tx) => {
        await tx.activationToken.update({
          where: { id: t.id },
          data: { state: 'used', usedAt: new Date(), scannedBy: userId },
        });
        if (!membership.activatedAt) {
          await tx.membership.update({ where: { id: membership.id }, data: { activatedAt: new Date() } });
        }
        // событие регистрации — только у персонала; вход ученика и родителя
        // фиксируется фактом сессии (session.started ниже), отдельного
        // доменного события у него нет — контракт событий не расширяется
        if (t.purpose === 'staff_activation') {
          await this.outbox.enqueue(
            tx,
            newEvent<StaffRegisteredV1>({
              type: SCHOOL_EVENTS.staffRegistered,
              workspaceId: ws,
              actor: userId,
              payload: { userId, roles, registeredVia: 'moderator_qr' },
            }),
          );
        }
      });

      if (opts.openedByOtherSession) {
        // QR открыт под живой чужой сессией (устройство модератора): якорь не
        // выдаётся, вход человека — код с карточки (AR-91, AR-92)
        return { ok: true, sessionToken: null as string | null, userId, roles };
      }
      const session = await this.sessions.issue({
        userId,
        workspaceId: ws,
        roles,
        deviceHint: opts.deviceHint,
        via: 'registration',
        clientKind: opts.clientKind ?? 'browser',
        ip: opts.ip ?? null,
      });
      await this.access.publishSessionStarted(userId, ws, 'registration', opts.deviceHint, opts.clientKind ?? 'browser');
      return { ok: true, sessionToken: session.token, userId, roles };
    });
  }

  /**
   * «Просканировал не тот» (AR-153): все сессии учётки закрываются, карточка
   * возвращается в «Не авторизованные», токен перевыпускается кнопкой. Креды не
   * трогаются — их заводил модератор, чужой сканер их не знает. История
   * карточки не затрагивается: это не удаление и не деактивация.
   */
  async revokeActivation(cardId: string, actor: SchoolActor) {
    const { membership, workspaceId, userId } = await this.registered(cardId);
    await this.sessions.revokeAllForUser(userId, 'activation_revoked');
    await TenantContext.runAsSystem(() =>
      this.prisma.membership.update({ where: { id: membership.id }, data: { activatedAt: null } }),
    );
    await this.prisma.activationToken.updateMany({
      where: { purpose: 'staff_activation', targetId: cardId, state: 'waiting' },
      data: { state: 'expired' },
    });
    await this.access.publishSessionRevoked(userId, workspaceId, 'activation_revoked', actor.userId);
    return this.get(cardId);
  }

  // ─────────────── роли (§11 строки 7, 32; AR-102) ───────────────

  /** `S-31.btn.addRole`. Роль `moderator` выдаётся любому — так появляется второй.
   *  Лимит носителей и здесь держит сервер (AR-205, П-4): без этой проверки M-07
   *  позволял второго завуча, и лимит оставался декларацией. */
  async addRole(cardId: string, role: SchoolRole, actor: SchoolActor) {
    const { membership, workspaceId } = await this.registered(cardId);
    if (membership.roles.includes(role)) return this.get(cardId);
    await this.assertRoleFree(workspaceId, role);
    await TenantContext.runAsSystem(() =>
      this.prisma.membership.update({ where: { id: membership.id }, data: { roles: [...membership.roles, role] } }),
    );
    return this.get(cardId);
  }

  /**
   * `S-31.btn.removeRole`. Два предохранителя: роль последнего активного
   * модератора не снимается (`LAST_MODERATOR`), последняя роль сотрудника не
   * снимается вовсе (`LAST_ROLE`) — для закрытия доступа есть деактивация, а
   * сотрудник без единой роли это запись, о правах которой нельзя рассуждать.
   */
  async removeRole(cardId: string, role: SchoolRole, actor: SchoolActor) {
    const { membership, workspaceId } = await this.registered(cardId);
    if (role === 'moderator' && (await this.activeModerators(workspaceId)) <= 1) {
      throw new SchoolError('LAST_MODERATOR');
    }
    if (membership.roles.length <= 1) throw new SchoolError('LAST_ROLE');
    await TenantContext.runAsSystem(() =>
      this.prisma.membership.update({
        where: { id: membership.id },
        data: { roles: membership.roles.filter((r) => r !== role) },
      }),
    );
    return this.get(cardId);
  }

  /**
   * AR-211: контур доступа к учётной записи АДМИНИСТРАТОРА школы держит только
   * `school.admin`. Пароль, ссылка входа и смена логина — это выдача доступа, а
   * не ведение персонала: с `staff.manage` модератор задал бы администратору
   * пароль (или выпустил ссылку) и вошёл бы под ним, и разделение кабинетов
   * (AR-186) держалось бы на честном слове. Остальной персонал модератор ведёт
   * как прежде (AR-88), включая роли, деактивацию и удаление.
   */
  /** Имя владельца карточки для текста отказа: `User` — справочник вне tenant-guard. */
  private async displayNameOf(userId: string): Promise<string | null> {
    const u = await TenantContext.runAsSystem(() =>
      this.prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } }),
    );
    return u?.displayName ?? null;
  }

  private assertMayManageAccount(membership: { roles: string[] }, actor: SchoolActor, name: string | null): void {
    if (!membership.roles.includes('admin')) return;
    if (actor.roles.some((r) => (ROLE_PERMISSIONS[r] ?? []).includes('school.admin'))) return;
    throw new SchoolError('ADMIN_ACCOUNT_LOCKED', { name: name ?? 'администратор' });
  }

  private async registered(cardId: string) {
    const card = await this.prisma.staffCard.findUnique({ where: { id: cardId } });
    if (!card?.userId) throw new NotFoundException('сотрудник не зарегистрирован');
    const membership = await TenantContext.runAsSystem(() =>
      this.prisma.membership.findFirst({ where: { userId: card.userId!, workspaceId: card.workspaceId } }),
    );
    if (!membership) throw new NotFoundException('членство не найдено');
    return { card, membership, workspaceId: card.workspaceId, userId: card.userId };
  }

  private async activeModerators(workspaceId: string): Promise<number> {
    return TenantContext.runAsSystem(() =>
      this.prisma.membership.count({
        where: { workspaceId, deactivatedAt: null, roles: { has: 'moderator' } },
      }),
    );
  }

  /** Занято носителей роли: живые членства + пустые слоты (AR-205). */
  roleHolders(workspaceId: string, role: SchoolRole): Promise<number> {
    return TenantContext.runAsSystem(() => countRoleHolders(this.prisma, workspaceId, role));
  }

  /**
   * Лимит носителей роли (AR-205): читается из политики школы
   * (`SchoolAccessPolicy.roleLimits`), отсутствие ключа — дефолт
   * `DEFAULT_ROLE_LIMITS` (директор и оба зама по одному — прежние синглтоны
   * AR-182), `null` — без лимита. Носителей уже столько, сколько разрешено, —
   * `ROLE_LIMIT_REACHED` с ролью словами и цифрами «N из M».
   */
  private async assertRoleFree(workspaceId: string, role: SchoolRole): Promise<void> {
    const policy = await TenantContext.runAsSystem(() =>
      this.prisma.schoolAccessPolicy.findUnique({ where: { workspaceId } }),
    );
    const limit = effectiveRoleLimit((policy?.roleLimits ?? {}) as RoleLimits, role);
    if (limit === null) return;
    const count = await this.roleHolders(workspaceId, role);
    if (count >= limit) {
      throw new SchoolError('ROLE_LIMIT_REACHED', { role, roleLabel: ROLE_LABELS[role], count, limit });
    }
  }

  // ─────────────── удаление, деактивация, реактивация (§11 строки 29–31) ───────────────

  /**
   * Каскад один для удаления и деактивации (AR-89): привязки к предметам
   * снимаются, покрытие предметов падает, сетка помечается `stale` — уроки без
   * исполнителя человек видит плашкой, а не узнаёт в сентябре. Выставленные
   * отметки ОСТАЮТСЯ: `postedBy` — историческая ссылка, а не живая связь.
   */
  private async cascadeUnbind(userId: string, workspaceId: string, actor: SchoolActor): Promise<string[]> {
    const unbound = await this.subjects.unbindAllOfTeacher(userId);
    for (const u of unbound) {
      await this.prisma.$transaction((tx) =>
        this.outbox.enqueue(
          tx,
          newEvent<TeacherUnboundV1>({
            type: SCHOOL_EVENTS.teacherUnbound,
            workspaceId,
            actor: actor.userId,
            payload: { subjectId: u.subjectId, classId: u.classId, teacherId: userId, reason: 'staff_removed' },
          }),
        ),
      );
    }
    return unbound.map((u) => u.subjectId);
  }

  async deactivate(cardId: string, actor: SchoolActor) {
    const { membership, workspaceId, userId } = await this.registered(cardId);
    if (membership.roles.includes('moderator') && (await this.activeModerators(workspaceId)) <= 1) {
      throw new SchoolError('LAST_MODERATOR');
    }
    const unboundSubjects = await this.cascadeUnbind(userId, workspaceId, actor);
    await TenantContext.runAsSystem(() =>
      this.prisma.membership.update({ where: { id: membership.id }, data: { deactivatedAt: new Date() } }),
    );
    // деактивация отзывает активные сессии НЕМЕДЛЕННО — иначе доступ уволенного
    // живёт 90 дней (AR-92)
    await this.sessions.revokeAllForUser(userId, 'deactivated');
    await this.prisma.$transaction((tx) =>
      this.outbox.enqueue(
        tx,
        newEvent<StaffDeactivatedV1>({
          type: SCHOOL_EVENTS.staffDeactivated,
          workspaceId,
          actor: actor.userId,
          payload: { userId, unboundSubjects },
        }),
      ),
    );
    await this.access.publishSessionRevoked(userId, workspaceId, 'deactivated', actor.userId);
    return this.get(cardId);
  }

  /**
   * Реактивация возвращает доступ; сессии не воскресают — вход заново.
   * Лимиты ролей перепроверяются (AR-205): пока сотрудник был деактивирован, его
   * роль могла уйти другому — реактивация не даёт носителей сверх лимита.
   */
  async reactivate(cardId: string, actor: SchoolActor) {
    const { membership, workspaceId, userId } = await this.registered(cardId);
    for (const role of membership.roles as SchoolRole[]) {
      await this.assertRoleFree(workspaceId, role);
    }
    await TenantContext.runAsSystem(() =>
      this.prisma.membership.update({ where: { id: membership.id }, data: { deactivatedAt: null } }),
    );
    await this.prisma.$transaction((tx) =>
      this.outbox.enqueue(
        tx,
        newEvent<StaffReactivatedV1>({
          type: SCHOOL_EVENTS.staffReactivated,
          workspaceId,
          actor: actor.userId,
          payload: { userId },
        }),
      ),
    );
    return this.get(cardId);
  }

  /**
   * Удаление доступно сотруднику БЕЗ привязок и БЕЗ выставленных отметок;
   * сотрудник с историей деактивируется, и деактивация обратима (AR-89).
   * Последний активный модератор не удаляется — правило защищает школу, а не
   * должность: при двух модераторах любой удаляется свободно.
   */
  async remove(cardId: string, actor: SchoolActor) {
    const { membership, workspaceId, userId } = await this.registered(cardId);
    if (membership.roles.includes('moderator') && (await this.activeModerators(workspaceId)) <= 1) {
      throw new SchoolError('LAST_MODERATOR');
    }
    // Гейт живёт в контракте, а не в интерфейсе (красная линия 3): карточка могла
    // показать «Удалить» до того, как сотрудник выставил отметку (AR-113).
    if (await this.hasHistory(userId)) throw new SchoolError('STAFF_HAS_HISTORY');
    const unboundSubjects = await this.cascadeUnbind(userId, workspaceId, actor);
    await this.sessions.revokeAllForUser(userId, 'deleted');
    await TenantContext.runAsSystem(async () => {
      await this.prisma.membership.deleteMany({ where: { id: membership.id } });
      await this.prisma.staffCard.update({ where: { id: cardId }, data: { userId: null } });
    });
    await this.prisma.$transaction((tx) =>
      this.outbox.enqueue(
        tx,
        newEvent<StaffDeletedV1>({
          type: SCHOOL_EVENTS.staffDeleted,
          workspaceId,
          actor: actor.userId,
          payload: { userId, unboundSubjects },
        }),
      ),
    );
    await this.access.publishSessionRevoked(userId, workspaceId, 'deleted', actor.userId);
    return { ok: true };
  }

  // ─────────────── код входа и сессии (§11 строки 35, 37) ───────────────

  /** `S-31.btn.loginCode`: выдаётся повторно столько раз, сколько нужно (AR-92). */
  async issueLoginCode(cardId: string) {
    const { userId, workspaceId } = await this.registered(cardId);
    return this.access.issueLoginCode(userId, workspaceId);
  }

  async revokeSessions(cardId: string, actor: SchoolActor) {
    const { userId, workspaceId } = await this.registered(cardId);
    const count = await this.sessions.revokeAllForUser(userId, 'manual');
    await this.access.publishSessionRevoked(userId, workspaceId, 'manual', actor.userId);
    return { ok: true, revoked: count };
  }

  // ─────────────── ссылка входа и активность учётки 1.3.0 (§11 строка 39, AR-187, AR-204) ───────────────

  /**
   * `S-31.btn.loginLink` / `S-62.devices.btn.grant`: ссылка входа с карточки
   * сотрудника с параметрами (AR-204): срок из `loginLinkTtlOptions` (дефолт
   * 48 ч) и число открытий из `loginLinkUsesOptions` (дефолт без лимита) —
   * значение вне меню отклоняется, а не округляется. Адрес строится от
   * публичного origin школы (`WEB_ORIGIN`), а не от хоста запроса: за прокси
   * хост запроса — внутренний.
   */
  async issueLoginLink(cardId: string, actor: SchoolActor, origin: string, dto: IssueLoginLinkDto = {}): Promise<LoginLinkDto> {
    const { membership, userId, workspaceId } = await this.registered(cardId);
    this.assertMayManageAccount(membership, actor, await this.displayNameOf(userId));
    const ttlHours: number = dto?.ttlHours ?? ACCESS_PARAMS.loginLinkTtlHours;
    const maxUses: number | null = dto?.maxUses === undefined ? null : dto.maxUses;
    const ttlOptions: readonly number[] = ACCESS_PARAMS.loginLinkTtlOptions;
    const usesOptions: readonly (number | null)[] = ACCESS_PARAMS.loginLinkUsesOptions;
    if (!ttlOptions.includes(ttlHours)) {
      throw new BadRequestException(`срок ссылки: одно из ${ttlOptions.join(', ')} часов`);
    }
    if (!usesOptions.includes(maxUses)) {
      throw new BadRequestException(`число открытий ссылки: одно из ${usesOptions.map((v) => (v === null ? 'без лимита' : v)).join(', ')}`);
    }
    const link = await this.access.issueLoginLink(userId, workspaceId, actor.userId, { ttlHours, maxUses });
    return { url: `${origin}/bootstrap/${link.token}`, token: link.token, expiresAt: link.expiresAt.toISOString(), maxUses: link.maxUses, useCount: link.useCount };
  }

  /**
   * Активность учётки для карточки `M-06` (AR-187): активирована ли, когда
   * была в сети, сколько устройств живо, и журнал подключений за
   * `sessionJournalDays` — теми же словами, что карта устройств администратора.
   */
  async activity(cardId: string, origin: string, showAddress = false): Promise<StaffActivityDto> {
    const { userId, workspaceId, membership } = await this.registered(cardId);
    const now = new Date();
    const rows = await TenantContext.runAsSystem(() =>
      this.prisma.appSession.findMany({
        where: {
          userId,
          workspaceId,
          OR: [{ revokedAt: null, expiresAt: { gt: now } }, { revokedAt: { gte: journalSince(now) } }, { expiresAt: { gte: journalSince(now) } }],
        },
      }),
    );
    const sessions = showAddress ? sessionsOfUser(rows, now) : withoutAddress(sessionsOfUser(rows, now));
    const lastSeen = rows.reduce<Date | null>((m, r) => (m === null || r.lastSeenAt > m ? r.lastSeenAt : m), null);
    return {
      userId,
      activated: Boolean(membership.activatedAt),
      activatedAt: membership.activatedAt ? membership.activatedAt.toISOString() : null,
      lastSeenAt: lastSeen ? lastSeen.toISOString() : null,
      activeSessions: sessions.filter((s) => s.status === 'active').length,
      totalSessions: sessions.length,
      sessions,
      profileUrl: `${origin}/staff/${cardId}`,
    };
  }

  // ─────────────── аватар (§11 строки 6, 33) ───────────────

  async setAvatar(userId: string, url: string) {
    await TenantContext.runAsSystem(() =>
      this.prisma.user.update({ where: { id: userId }, data: { avatarUrl: url } }),
    );
    return { ok: true };
  }

  async clearAvatar(userId: string) {
    await TenantContext.runAsSystem(() =>
      this.prisma.user.update({ where: { id: userId }, data: { avatarUrl: null } }),
    );
    return { ok: true };
  }
}
