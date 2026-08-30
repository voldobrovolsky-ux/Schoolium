import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { syncAuthzCatalog } from './catalog';

export interface ResolvedAccess {
  cabinet: string; // какой кабинет открыть (CabinetKey)
  permissions: string[]; // коды доступных действий
}

/**
 * Резолвер доступа (§5.1): кабинет и права берутся ИЗ КАТАЛОГА (БД), не из кода.
 * Единственный код-шим — маппинг (florusRole, subRole) → ключ пакета; всё остальное —
 * данные. На старте идемпотентно засевает каталог (boot-sync), чтобы он был в любой среде.
 */
@Injectable()
export class AuthzService implements OnModuleInit {
  private readonly log = new Logger('Authz');

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await syncAuthzCatalog(this.prisma);
    this.log.log('каталог прав синхронизирован (boot-sync)');
  }

  /** Тонкий шим: роль/суб-роль → ключ пакета. staff → суб-роль (дефолт methodist). */
  packageKey(role: string, subRole?: string | null): string {
    return role === 'staff' ? subRole ?? 'methodist' : role;
  }

  /**
   * Доступ по МАССИВУ ролей (AR-60, AR-61): объединение пакетов. Совмещающий
   * роли человек получает объединение прав, а разделение обязанностей проверяется
   * по идентичности, а не вычитанием прав (AR-61) — иначе модератор, ведущий
   * уроки, терял бы часть полномочий от факта совмещения.
   */
  async resolveForRoles(roles: string[]): Promise<ResolvedAccess> {
    if (!roles.length) return { cabinet: 'none', permissions: [] };
    const pkgs = await this.prisma.rolePackage.findMany({
      where: { key: { in: roles } },
      include: { permissions: { include: { permission: true } } },
    });
    const permissions = [...new Set(pkgs.flatMap((p) => p.permissions.map((rp) => rp.permission.code)))];
    // кабинет — по первой найденной роли в порядке массива (стартовый экран роли
    // определяется правами, а не кабинетом: см. startScreenFor в @edustore/shared)
    const first = roles.find((r) => pkgs.some((p) => p.key === r));
    return { cabinet: pkgs.find((p) => p.key === first)?.cabinet ?? 'none', permissions };
  }

  async resolveAccess(role: string, subRole?: string | null): Promise<ResolvedAccess> {
    const key = this.packageKey(role, subRole);
    const pkg = await this.prisma.rolePackage.findUnique({
      where: { key },
      include: { permissions: { include: { permission: true } } },
    });
    // нет пакета в каталоге → пустой доступ; кабинет = ключ (безопасный fallback)
    if (!pkg) return { cabinet: key, permissions: [] };
    return { cabinet: pkg.cabinet, permissions: pkg.permissions.map((rp) => rp.permission.code) };
  }
}
