import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthzService } from './authz.service';
import { REQUIRE_PERMISSION } from './require-permission.decorator';
import type { SessionUser } from '../auth/flor.service';

/**
 * Гейтинг роутов по каталогу прав (§5.1). Регистрируется как APP_GUARD ПОСЛЕ AuthGuard
 * (req.user уже установлен). Роуты без @RequirePermission проходят свободно; помеченные —
 * проверяются: пакет роли пользователя (resolveAccess из каталога) должен содержать код.
 *
 * Резолв читает RolePackage (глобальная reference-data, вне тенант-изоляции) — работает до
 * TenantInterceptor. Закрывает дыру «каталог вычисляется, но ничего не гейтит».
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authz: AuthzService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const code = this.reflector.getAllAndOverride<string | undefined>(REQUIRE_PERMISSION, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!code) return true; // негейченный роут
    const req = ctx.switchToHttp().getRequest<Request & { user?: SessionUser }>();
    if (!req.user) throw new ForbiddenException('требуется аутентификация');
    // Роли 1.1.1 приходят массивом (AR-60); legacy-сессия OIDC несёт одну строку.
    const access = req.user.roles?.length
      ? await this.authz.resolveForRoles(req.user.roles)
      : await this.authz.resolveAccess(req.user.role, req.user.subRole);
    if (!access.permissions.includes(code)) {
      throw new ForbiddenException(`нет права: ${code}`);
    }
    return true;
  }
}
