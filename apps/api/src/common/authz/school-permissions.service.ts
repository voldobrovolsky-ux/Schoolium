import { Injectable } from '@nestjs/common';
import {
  ROLE_PERMISSIONS,
  SCHOOL_PERMISSIONS,
  SCHOOL_ROLES,
  applyOverrides,
  isLockedRoleGrant,
  LOCKED_ADMIN_PERMISSION,
  type PermissionOverrides,
  type SchoolPermission,
  type SchoolRole,
} from '@edustore/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant-context';

export const ROLE_SCOPE = 'role';
export const USER_SCOPE = 'user';

export const isSchoolRole = (v: string): v is SchoolRole => (SCHOOL_ROLES as readonly string[]).includes(v);
export const isSchoolPermission = (v: string): v is SchoolPermission =>
  (SCHOOL_PERMISSIONS as readonly string[]).includes(v);

/**
 * Читающая сторона школьных разрешений (AR-212) — ОДНА на всех, кто спрашивает
 * «что может этот человек»: гейт роутов (`PermissionGuard`), `GET /v1/me` и
 * кабинет администратора `S-62`. Пишущая сторона живёт в
 * `schoolium/cabinets/permissions.service.ts` и опирается на эту же.
 *
 * Правило наложения: канон версии (`ROLE_PERMISSIONS`) → общие отклонения роли
 * → индивидуальные отклонения человека. Канон пересевается в каталог на каждом
 * старте (`syncAuthzCatalog` прунит всё лишнее), поэтому школьная правка не
 * пишется в каталог, а лежит отдельной таблицей и накладывается здесь.
 *
 * Кэша нет намеренно: тумблер в `S-62` обязан действовать со следующего
 * запроса, а не «в течение минуты». Чтение — один индексированный запрос по
 * `(workspaceId, scope, subject)`, той же цены, что и чтение пакета из каталога.
 */
@Injectable()
export class SchoolPermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Отклонения школы: `subject → { право: разрешено }`. Права вне версии игнорируются. */
  async overrides(ws: string, scope: string, subjects?: string[]): Promise<Map<string, PermissionOverrides>> {
    const rows = await TenantContext.runAsSystem(() =>
      this.prisma.schoolPermissionOverride.findMany({
        where: { workspaceId: ws, scope, ...(subjects ? { subject: { in: subjects } } : {}) },
        select: { subject: true, permission: true, allowed: true },
      }),
    );
    const out = new Map<string, PermissionOverrides>();
    for (const r of rows) {
      if (!isSchoolPermission(r.permission)) continue; // право выпало из версии — строка мертва
      const cur = out.get(r.subject) ?? {};
      cur[r.permission] = r.allowed;
      out.set(r.subject, cur);
    }
    return out;
  }

  /**
   * Пакет роли с отклонениями школы и замком кабинета. Единственное место, где
   * считается «что может роль»: и матрица `S-62`, и гейт роутов зовут его.
   */
  roleGrant(role: SchoolRole, overrides: PermissionOverrides): SchoolPermission[] {
    const eff = applyOverrides(ROLE_PERMISSIONS[role], overrides);
    if (isLockedRoleGrant(role, LOCKED_ADMIN_PERMISSION) && !eff.includes(LOCKED_ADMIN_PERMISSION)) {
      return SCHOOL_PERMISSIONS.filter((c) => c === LOCKED_ADMIN_PERMISSION || eff.includes(c));
    }
    return eff;
  }

  /** Объединение действующих пакетов ролей человека — без его личных отклонений. */
  async baseForRoles(ws: string, roles: SchoolRole[]): Promise<SchoolPermission[]> {
    if (roles.length === 0) return [];
    const map = await this.overrides(ws, ROLE_SCOPE, roles);
    const union = new Set<SchoolPermission>();
    for (const role of roles) for (const code of this.roleGrant(role, map.get(role) ?? {})) union.add(code);
    return SCHOOL_PERMISSIONS.filter((c) => union.has(c));
  }

  /** Что человек может на самом деле: пакеты его ролей плюс личные отклонения. */
  async effectiveForUser(ws: string, userId: string, roles: readonly string[]): Promise<SchoolPermission[]> {
    const known = roles.filter(isSchoolRole);
    if (known.length === 0) return [];
    const [base, personal] = await Promise.all([
      this.baseForRoles(ws, known),
      this.overrides(ws, USER_SCOPE, [userId]),
    ]);
    return applyOverrides(base, personal.get(userId) ?? {});
  }

  /**
   * Полный доступ человека: девятнадцать прав версии — со школьными правками,
   * всё остальное из каталога — как есть.
   *
   * Второе слагаемое не декоративно: пакет администратора несёт коды
   * вытесняемого контура (`structure.devices.manage`, `settings.parser.manage`),
   * которых в словаре версии нет. Считать их «снятыми» только потому, что
   * матрица `S-62` про них не знает, — закрыть живые роуты правкой, которой
   * никто не делал.
   */
  async resolve(ws: string, userId: string, roles: readonly string[], catalog: readonly string[]): Promise<string[]> {
    const school = await this.effectiveForUser(ws, userId, roles);
    const foreign = catalog.filter((c) => !isSchoolPermission(c));
    return [...new Set([...school, ...foreign])];
  }
}
