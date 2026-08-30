import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION = 'require_permission';

/**
 * Пометить роут требуемым правом (§5.1). PermissionGuard проверит, что пакет роли
 * пользователя (из каталога) содержит этот код; иначе 403. Делает каталог прав РЕАЛЬНЫМ
 * (не только информативным в /me).
 *
 * Массив кодов — «любое из»: роут нагрузки открыт и строителю расписания, и
 * завучу с его единственным правом норм часов (AR-174).
 */
export const RequirePermission = (code: string | string[]) => SetMetadata(REQUIRE_PERMISSION, code);
