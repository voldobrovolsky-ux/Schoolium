import { Injectable } from '@nestjs/common';
import {
  ROLE_PERMISSIONS,
  SCHOOL_ROLES,
  applyOverrides,
  isLockedRoleGrant,
  LOCKED_ADMIN_PERMISSION,
  type PermissionMatrixDto,
  type PermissionOverrides,
  type PermissionUserDto,
  type SchoolPermission,
  type SchoolRole,
  type SetRolePermissionDto,
  type SetUserPermissionDto,
  type UserPermissionsDto,
} from '@edustore/shared';
import {
  isSchoolPermission,
  isSchoolRole,
  ROLE_SCOPE,
  SchoolPermissionsService,
  USER_SCOPE,
} from '../../common/authz/school-permissions.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { OutboxService } from '../../common/outbox/outbox.service';
import { newEvent } from '../../common/events/domain-event';
import { SCHOOL_EVENTS, type PermissionSetV1 } from '../schoolium.contract';
import { SchoolError } from '../schoolium.errors';
import type { SchoolActor } from '../actor';

/**
 * Разрешения школы `S-62` (AR-213): администратор правит матрицу прав тумблером,
 * и правка ДЕЙСТВУЕТ — её читает и гейт роутов (`PermissionGuard`), и `GET /me`.
 *
 * Пакеты `ROLE_PERMISSIONS` остаются каноном версии: они пересеваются в каталог
 * на каждом старте (`syncAuthzCatalog` прунит всё, чего в каноне нет). Поэтому
 * школьная правка живёт отдельной таблицей ОТКЛОНЕНИЙ и накладывается поверх
 * пакета — запись прямо в `RolePackagePermission` стиралась бы рестартом.
 *
 * Два уровня, и второй сильнее первого:
 *   1. `role` — общие разрешения роли: действуют на всех её носителей в школе;
 *   2. `user` — индивидуальные: конкретному человеку выдано или снято сверх
 *      объединения его ролей.
 *
 * Замок один (`PERMISSION_LOCKED`): `school.admin` не снимается ни у роли
 * `admin`, ни адресно у любого её носителя — иначе кабинет закрывается изнутри
 * и открыть его больше некому. Замок стоит на роли, а не на «последнем
 * администраторе»: считать оставшихся значило бы разрешать снятие, пока их
 * двое, и запрещать на втором щелчке — правило, которое человек не выведет из
 * интерфейса и упрётся в него ровно тогда, когда уже поздно.
 */
@Injectable()
export class PermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly resolver: SchoolPermissionsService,
  ) {}

  // ─────────────── чтение ───────────────

  /** Матрица «роль × право» школы: действующие права и то, чем они отличаются от пакета. */
  async matrix(): Promise<PermissionMatrixDto> {
    const ws = TenantContext.require();
    const map = await this.resolver.overrides(ws, ROLE_SCOPE);
    const grants = {} as Record<SchoolRole, SchoolPermission[]>;
    const overrides = {} as Record<SchoolRole, PermissionOverrides>;
    for (const role of SCHOOL_ROLES) {
      const ov = map.get(role) ?? {};
      overrides[role] = ov;
      grants[role] = this.resolver.roleGrant(role, ov);
    }
    return { grants, overrides };
  }

  // ─────────────── общие разрешения роли ───────────────

  /**
   * Один тумблер — одна запись. Совпало с пакетом версии — строка отклонения
   * УДАЛЯЕТСЯ, а не пишется дублем: «как в каноне» и «явно возвращено в канон» —
   * одно состояние, и второй его записи в базе быть не должно.
   */
  async setRolePermission(dto: SetRolePermissionDto, actor: SchoolActor): Promise<PermissionMatrixDto> {
    const ws = TenantContext.require();
    const role = this.parseRole(dto?.role);
    const permission = this.parsePermission(dto?.permission);
    const allowed = dto?.allowed === true;
    if (isLockedRoleGrant(role, permission) && !allowed) throw new SchoolError('PERMISSION_LOCKED');

    const canonical = ROLE_PERMISSIONS[role].includes(permission);
    await this.prisma.$transaction(async (tx) => {
      if (canonical === allowed) {
        await tx.schoolPermissionOverride.deleteMany({
          where: { workspaceId: ws, scope: ROLE_SCOPE, subject: role, permission },
        });
      } else {
        await tx.schoolPermissionOverride.upsert({
          where: { workspaceId_scope_subject_permission: { workspaceId: ws, scope: ROLE_SCOPE, subject: role, permission } },
          update: { allowed, updatedBy: actor.userId },
          create: { workspaceId: ws, scope: ROLE_SCOPE, subject: role, permission, allowed, updatedBy: actor.userId },
        });
      }
      await this.outbox.enqueue(
        tx,
        newEvent<PermissionSetV1>({
          type: SCHOOL_EVENTS.permissionSet,
          workspaceId: ws,
          actor: actor.userId,
          payload: { scope: 'role', subject: role, permission, allowed, reverted: canonical === allowed },
        }),
      );
    });
    return this.matrix();
  }

  // ─────────────── индивидуальные разрешения человека ───────────────

  /**
   * Люди школы для выбора в «индивидуальных». Подстрока ищется по ФИО и
   * юзернейму; деактивированные показываются с пометкой, а не прячутся —
   * их права администратор смотрит именно тогда, когда разбирается, что
   * человек успел.
   */
  async users(query: string | null): Promise<PermissionUserDto[]> {
    const ws = TenantContext.require();
    const rows = await TenantContext.runAsSystem(() =>
      this.prisma.membership.findMany({
        where: { workspaceId: ws },
        select: { florusUserId: true, roles: true, deactivatedAt: true },
      }),
    );
    const ids = rows.map((r) => r.florusUserId);
    const users = await TenantContext.runAsSystem(() =>
      this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, displayName: true, firstName: true, lastName: true, middleName: true, username: true, avatarUrl: true },
      }),
    );
    const byId = new Map(users.map((u) => [u.id, u]));
    const q = (query ?? '').trim().toLowerCase();
    const out: PermissionUserDto[] = [];
    for (const r of rows) {
      const u = byId.get(r.florusUserId);
      const roles = (r.roles ?? []).filter(isSchoolRole);
      if (roles.length === 0) continue; // членство без ролей версии — не субъект разрешений
      const name = u ? [u.lastName, u.firstName, u.middleName].filter(Boolean).join(' ') || u.displayName : r.florusUserId;
      if (q && !name.toLowerCase().includes(q) && !(u?.username ?? '').toLowerCase().includes(q)) continue;
      out.push({
        userId: r.florusUserId,
        name,
        username: u?.username ?? null,
        avatarUrl: u?.avatarUrl ?? null,
        roles,
        deactivated: Boolean(r.deactivatedAt),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }

  async userPermissions(userId: string): Promise<UserPermissionsDto> {
    const ws = TenantContext.require();
    const user = await this.requireUser(ws, userId);
    const [base, personal] = await Promise.all([
      this.resolver.baseForRoles(ws, user.roles),
      this.resolver.overrides(ws, USER_SCOPE, [userId]),
    ]);
    const overrides = personal.get(userId) ?? {};
    return { user, base, effective: applyOverrides(base, overrides), overrides };
  }

  /**
   * `allowed: null` снимает личное отклонение — человек возвращается к пакету
   * своих ролей. Совпадение с пакетом тоже снимает строку: «как у роли» хранить
   * отдельной записью незачем, а лишняя запись пережила бы правку самой роли и
   * молча заморозила бы человеку старое право.
   */
  async setUserPermission(userId: string, dto: SetUserPermissionDto, actor: SchoolActor): Promise<UserPermissionsDto> {
    const ws = TenantContext.require();
    const permission = this.parsePermission(dto?.permission);
    const allowed = dto?.allowed === null || dto?.allowed === undefined ? null : dto.allowed === true;
    const current = await this.userPermissions(userId);
    const inBase = current.base.includes(permission);
    // Замок кабинета: снять `school.admin` у администратора школы нельзя и
    // адресно — иначе роль остаётся с правом, а носитель без кабинета.
    if (permission === LOCKED_ADMIN_PERMISSION && allowed === false && current.user.roles.includes('admin')) {
      throw new SchoolError('PERMISSION_LOCKED');
    }

    await this.prisma.$transaction(async (tx) => {
      if (allowed === null || allowed === inBase) {
        await tx.schoolPermissionOverride.deleteMany({
          where: { workspaceId: ws, scope: USER_SCOPE, subject: userId, permission },
        });
      } else {
        await tx.schoolPermissionOverride.upsert({
          where: { workspaceId_scope_subject_permission: { workspaceId: ws, scope: USER_SCOPE, subject: userId, permission } },
          update: { allowed, updatedBy: actor.userId },
          create: { workspaceId: ws, scope: USER_SCOPE, subject: userId, permission, allowed, updatedBy: actor.userId },
        });
      }
      await this.outbox.enqueue(
        tx,
        newEvent<PermissionSetV1>({
          type: SCHOOL_EVENTS.permissionSet,
          workspaceId: ws,
          actor: actor.userId,
          payload: { scope: 'user', subject: userId, userId, permission, allowed, reverted: allowed === null || allowed === inBase },
        }),
      );
    });
    return this.userPermissions(userId);
  }

  // ─────────────── разбор входа ───────────────

  private parseRole(v: unknown): SchoolRole {
    if (typeof v !== 'string' || !isSchoolRole(v)) throw new SchoolError('ACCESS_REVOKED');
    return v;
  }

  private parsePermission(v: unknown): SchoolPermission {
    if (typeof v !== 'string' || !isSchoolPermission(v)) throw new SchoolError('ACCESS_REVOKED');
    return v;
  }

  /** Человек школы или отказ: чужой `userId` в адресе — не 404, а отзыв доступа (AR-99). */
  private async requireUser(ws: string, userId: string): Promise<PermissionUserDto> {
    const [membership, user] = await TenantContext.runAsSystem(() =>
      Promise.all([
        this.prisma.membership.findFirst({
          where: { workspaceId: ws, florusUserId: userId },
          select: { roles: true, deactivatedAt: true },
        }),
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { displayName: true, firstName: true, lastName: true, middleName: true, username: true, avatarUrl: true },
        }),
      ]),
    );
    const roles = (membership?.roles ?? []).filter(isSchoolRole);
    if (!membership || roles.length === 0) throw new SchoolError('ACCESS_REVOKED');
    return {
      userId,
      name: user ? [user.lastName, user.firstName, user.middleName].filter(Boolean).join(' ') || user.displayName : userId,
      username: user?.username ?? null,
      avatarUrl: user?.avatarUrl ?? null,
      roles,
      deactivated: Boolean(membership.deactivatedAt),
    };
  }
}
