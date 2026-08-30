import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, Subscription } from 'rxjs';
import { from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext, type TenantStore } from './tenant-context';
import type { SessionUser } from '../auth/flor.service';

/**
 * Глобальный интерсептор (§3.6): кладёт tenant-контекст запроса в ALS, чтобы tenant-guard
 * фильтровал каждый запрос доменных моделей внутри обработчика.
 *
 * Активный тенант: из сессии (req.user.workspaceId = школа). В DEV/без контекста выводится из
 * directory по florus_user_id. Публичные/неаутентифицированные маршруты (login/callback/
 * backchannel) идут без user → системный контекст (там работает OIDC-провижининг).
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: SessionUser }>();
    return from(this.resolveStore(req)).pipe(
      switchMap(
        (store) =>
          new Observable((subscriber) => {
            let sub: Subscription | undefined;
            // подписка на обработчик происходит ВНУТРИ ALS-контекста → его await'ы
            // (и Prisma-вызовы) наследуют тенант.
            TenantContext.run(store, () => {
              sub = next.handle().subscribe(subscriber);
            });
            return () => sub?.unsubscribe();
          }),
      ),
    );
  }

  private async resolveStore(req: Request & { user?: SessionUser }): Promise<TenantStore> {
    const user = req.user;
    if (!user) return { tenantId: null, system: true }; // публичный маршрут → система
    if (user.workspaceId) return { tenantId: user.workspaceId, system: false }; // активная школа
    // сессия без активной школы или DEV-bypass: вывести тенант (= школу) из directory
    const tenantId = await this.resolveTenantForUser(user.florusUserId);
    if (tenantId) return { tenantId, system: false };
    // AR-34 fail-closed: аутентифицирован, но не привязан ни к одной школе → доменные модели
    // недоступны (guard бросит 403). Кейсы «до выбора школы» (/me, provision) работают только
    // через явный TenantContext.runAsSystem в своих сервисах, не через этот дефолт.
    return { tenantId: null, system: false };
  }

  // Membership вне изоляции; Teacher — fallback для DEV-учителя (guarded, потому system).
  private resolveTenantForUser(florusUserId: string): Promise<string | null> {
    return TenantContext.runAsSystem(async () => {
      const m = await this.prisma.membership.findFirst({
        where: { florusUserId },
        select: { workspaceId: true },
      });
      if (m) return m.workspaceId;
      const t = await this.prisma.teacher.findUnique({
        where: { id: florusUserId },
        select: { workspaceId: true },
      });
      return t?.workspaceId ?? null;
    });
  }
}
