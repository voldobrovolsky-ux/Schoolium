import {
  ArgumentsHost,
  CallHandler,
  Catch,
  Controller,
  ExceptionFilter,
  ExecutionContext,
  Get,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Module,
  NestInterceptor,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { Public } from '../../common/auth/public.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { TenantContext } from '../../common/tenant/tenant-context';
import { DEBUG_FLAGS, maskPII } from './mask';

/**
 * Наблюдаемость 1.1.1 (AR-97). Два инварианта поверх любых флагов:
 *   1. маскирование ПДн НЕ отключается ни одним из них (AR-30);
 *   2. каждый ответ об ошибке несёт `requestId` = correlationId конверта (AR-21),
 *      по которому путь запроса читается одной трассой в аудите.
 */

/** `GET /healthz` — версия, статус миграций, время. Без аутентификации, без данных. */
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('healthz')
  async health() {
    let migrations = 'unknown';
    try {
      const rows = await TenantContext.runAsSystem(() =>
        this.prisma.$queryRawUnsafe<{ n: bigint }[]>(
          'select count(*)::bigint as n from _prisma_migrations where finished_at is not null',
        ),
      );
      migrations = String(rows[0]?.n ?? 0);
    } catch {
      migrations = 'unavailable';
    }
    return {
      version: process.env.npm_package_version ?? '1.1.1',
      migrationsApplied: migrations,
      time: new Date().toISOString(),
      debug: { logLevel: DEBUG_FLAGS.logLevel, sql: DEBUG_FLAGS.sql, events: DEBUG_FLAGS.events, http: DEBUG_FLAGS.http },
    };
  }
}

/** `DEBUG_HTTP=1`: тела запросов и ответов — уже замаскированные (AR-30). */
@Injectable()
export class DebugHttpInterceptor implements NestInterceptor {
  private readonly log = new Logger('HTTP');

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request & { requestId?: string }>();
    req.requestId = req.requestId ?? randomUUID();
    if (!DEBUG_FLAGS.http) return next.handle();
    const started = Date.now();
    this.log.debug(`→ ${req.method} ${req.url} ${JSON.stringify(maskPII(req.body))} [${req.requestId}]`);
    return next.handle().pipe(
      tap((body) =>
        this.log.debug(`← ${req.method} ${req.url} ${Date.now() - started}мс ${JSON.stringify(maskPII(body))} [${req.requestId}]`),
      ),
    );
  }
}

/**
 * Каждый ответ об ошибке несёт `requestId` (AR-21, AR-97): жалоба «не работает»
 * превращается в одну трассу, а не в переписку. Тело отказов Schoolium уже несёт
 * `code` и человекочитаемый текст — фильтр их не переписывает, только дополняет.
 */
@Catch()
export class RequestIdFilter implements ExceptionFilter {
  private readonly log = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { requestId?: string }>();
    const res = ctx.getResponse<Response>();
    const requestId = req.requestId ?? randomUUID();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : { message: 'внутренняя ошибка' };
    const body: Record<string, unknown> =
      typeof raw === 'string' ? { message: raw } : { ...(raw as Record<string, unknown>) };
    body.requestId = requestId;

    if (status >= 500) this.log.error(`${req.method} ${req.url} → ${status} [${requestId}]`);
    res.status(status).json(body);
  }
}

@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: DebugHttpInterceptor },
    { provide: APP_FILTER, useClass: RequestIdFilter },
  ],
})
export class ObservabilityModule {}
