import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthzService } from './authz.service';
import { REQUIRE_PERMISSION } from './require-permission.decorator';
import { SchoolPermissionsService } from './school-permissions.service';
import type { SessionUser } from '../auth/flor.service';

/**
 * Гейтинг роутов по каталогу прав (§5.1). Регистрируется как APP_GUARD ПОСЛЕ AuthGuard
 * (req.user уже установлен). Роуты без @RequirePermission проходят свободно; помеченные —
 * проверяются: доступ пользователя должен содержать код.
 *
 * Доступ считается в два слоя. Каталог (`RolePackage`) даёт канон версии — глобальная
 * reference-data вне тенант-изоляции, читается до TenantInterceptor. Поверх него, у сессии
 * Schoolium с известной школой, ложатся школьные разрешения `S-62` (AR-213): администратор
 * снял право тумблером — роут закрывается, а не только исчезает кнопка. Оба слоя читаются
 * явным `workspaceId` из сессии, поэтому порядок с TenantInterceptor по-прежнему не важен.
 *
 * Итог кладётся на `req.permissions`: сервисы за гейтом (`actorHas`) обязаны судить по тем
 * же правам, что и сам гейт — иначе снятое право продолжало бы работать внутри роута.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authz: AuthzService,
    private readonly school: SchoolPermissionsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const code = this.reflector.getAllAndOverride<string | string[] | undefined>(REQUIRE_PERMISSION, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!code) return true; // негейченный роут
    const req = ctx.switchToHttp().getRequest<Request & { user?: SessionUser; permissions?: string[] }>();
    if (!req.user) throw new ForbiddenException('требуется аутентификация');
    // Роли 1.1.1 приходят массивом (AR-60); legacy-сессия OIDC несёт одну строку.
    const access = req.user.roles?.length
      ? await this.authz.resolveForRoles(req.user.roles)
      : await this.authz.resolveAccess(req.user.role, req.user.subRole);
    // Сессия Schoolium с известной школой проходит через школьные разрешения
    // (AR-213): тумблер `S-62` обязан закрывать роут, а не только прятать кнопку.
    const permissions =
      req.user.roles?.length && req.user.workspaceId
        ? await this.school.resolve(req.user.workspaceId, req.user.florusUserId, req.user.roles, access.permissions)
        : access.permissions;
    /* Резолв кладётся на запрос: сервисы за гейтом (`actorHas`) обязаны читать
       ТЕ ЖЕ права, иначе снятое тумблером право продолжало бы действовать
       внутри разрешённого роута. */
    req.permissions = permissions;
    // Массив — «любое из» (AR-174): роут открыт носителю хотя бы одного кода.
    const codes = Array.isArray(code) ? code : [code];
    if (!codes.some((c) => permissions.includes(c))) {
      throw new ForbiddenException(`нет права: ${codes.join(' | ')}`);
    }
    return true;
  }
}
