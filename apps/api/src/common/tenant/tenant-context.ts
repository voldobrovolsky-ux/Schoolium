import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantStore {
  tenantId: string | null; // активный тенант запроса (= Organization key)
  system: boolean; // true → обход guard (фон/OIDC-провижининг/кросс-тенант агрегация)
}

const als = new AsyncLocalStorage<TenantStore>();

/**
 * Tenant-контекст запроса (§3.6). Лежит в AsyncLocalStorage, читается tenant-guard'ом
 * (Prisma middleware) на каждом обращении к доменной модели.
 *
 * Инвариант: request-путь ВСЕГДА устанавливает контекст (глобальный TenantInterceptor),
 * поэтому в запросе стор не бывает undefined. Отсутствие стора = доверенный не-HTTP код
 * (фоновый воркер / seed / стартап) → guard пропускает. Системный контекст (system=true) —
 * явный обход для провижининга и агрегаций PlatformAdmin.
 */
export const TenantContext = {
  run<T>(store: TenantStore, fn: () => T): T {
    return als.run(store, fn);
  },
  /** Явный системный контекст: обход изоляции (фон/провижининг/админ-агрегация). */
  runAsSystem<T>(fn: () => T): T {
    return als.run({ tenantId: null, system: true }, fn);
  },
  store(): TenantStore | undefined {
    return als.getStore();
  },
  current(): string | null {
    return als.getStore()?.tenantId ?? null;
  },
  /** Активный тенант или исключение — для проставления ключа в create-данные доменной модели. */
  require(): string {
    const t = als.getStore()?.tenantId;
    if (!t) throw new Error('tenant context required (нет активного тенанта)');
    return t;
  },
};
