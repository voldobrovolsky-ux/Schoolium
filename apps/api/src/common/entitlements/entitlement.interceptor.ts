import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { EntitlementsService } from './entitlements.service';
import { REQUIRE_ENTITLEMENT } from './require-entitlement.decorator';

/**
 * Гейт загрузки модуля (§5.2). Регистрируется ПОСЛЕ TenantInterceptor — выполняется внутри
 * tenant-контекста, поэтому isActive видит entitlement'ы текущего тенанта. Маршруты без
 * @RequireEntitlement проходят свободно.
 */
@Injectable()
export class EntitlementInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const sku = this.reflector.getAllAndOverride<string | undefined>(REQUIRE_ENTITLEMENT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (sku && !(await this.entitlements.isActive(sku))) {
      throw new ForbiddenException(`нет активного entitlement на модуль: ${sku}`);
    }
    return next.handle();
  }
}
