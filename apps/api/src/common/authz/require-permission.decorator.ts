import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION = 'require_permission';

/**
 * Пометить роут требуемым правом (§5.1). PermissionGuard проверит, что пакет роли
 * пользователя (из каталога) содержит этот код; иначе 403. Делает каталог прав РЕАЛЬНЫМ
 * (не только информативным в /me).
 */
export const RequirePermission = (code: string) => SetMetadata(REQUIRE_PERMISSION, code);
