import { ForbiddenException, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { TenantContext } from './tenant-context';
import { TENANT_COLUMN } from './tenant-models';

const log = new Logger('TenantGuard');

// Операции, фильтруемые добавлением тенанта в where. Для find/update/delete по id это
// работает за счёт extended-where-unique (Prisma 5: к уникальному селектору можно
// добавить обычный скалярный фильтр — проверено на 5.22).
const WHERE_OPS = new Set<Prisma.PrismaAction>([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

/**
 * Tenant-guard (§3.6) — Prisma `$use` middleware. Для каждой доменной модели
 * принудительно сужает запрос текущим тенантом из ALS:
 *  - WHERE_OPS: подмешивает `{ [col]: tenant }` в where (чтение/правка/удаление чужой
 *    строки → пустой результат / P2025);
 *  - create/createMany: проставляет тенант в data, если не задан явно (хендлеры каскада
 *    ставят workspaceId из конверта события сами — их значение не перетираем);
 *  - upsert: и where, и create.
 *
 * Обход: системный контекст (store.system) и не-HTTP код (store undefined). На request-пути
 * контекст всегда установлен глобальным интерсептором; аутентифицирован, но тенант не
 * разрешён → fail-closed (бросаем), чтобы доменный запрос без тенанта был невозможен.
 */
export function applyTenantGuard(client: PrismaClient): void {
  const middleware: Prisma.Middleware = async (params, next) => {
    const model = params.model;
    if (!model) return next(params); // $queryRaw и пр. — вне модели
    const col = TENANT_COLUMN[model];
    if (!col) return next(params); // модель вне изоляции (directory/инфраструктура)

    const store = TenantContext.store();
    if (!store || store.system) return next(params); // не-HTTP / системный контекст

    const tenant = store.tenantId;
    if (!tenant) {
      throw new ForbiddenException(`tenant context required for ${model}.${params.action}`);
    }

    const action = params.action;
    const args = (params.args ?? {}) as Record<string, unknown>;

    if (WHERE_OPS.has(action)) {
      args.where = { ...((args.where as object) ?? {}), [col]: tenant };
    } else if (action === 'create') {
      const data = (args.data ?? {}) as Record<string, unknown>;
      if (data[col] === undefined) data[col] = tenant;
      args.data = data;
    } else if (action === 'createMany') {
      const data = args.data;
      if (Array.isArray(data)) {
        for (const row of data as Record<string, unknown>[]) if (row[col] === undefined) row[col] = tenant;
      } else if (data && (data as Record<string, unknown>)[col] === undefined) {
        (data as Record<string, unknown>)[col] = tenant;
      }
    } else if (action === 'upsert') {
      args.where = { ...((args.where as object) ?? {}), [col]: tenant };
      const create = (args.create ?? {}) as Record<string, unknown>;
      if (create[col] === undefined) create[col] = tenant;
      args.create = create;
    }
    params.args = args;
    return next(params);
  };

  client.$use(middleware);
  log.log(`включён для ${Object.keys(TENANT_COLUMN).length} доменных моделей`);
}
