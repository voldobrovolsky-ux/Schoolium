import { SetMetadata } from '@nestjs/common';

export const REQUIRE_ENTITLEMENT = 'require_entitlement';

/**
 * Пометить маршрут/контроллер требуемым SKU (§5.2). EntitlementInterceptor проверит
 * активный entitlement тенанта перед загрузкой модуля; нет — 403.
 */
export const RequireEntitlement = (skuKey: string) => SetMetadata(REQUIRE_ENTITLEMENT, skuKey);
