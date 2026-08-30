import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/** Идентификатор учителя по умолчанию (засеянный demo-учитель). DEV ONLY. */
export const DEFAULT_TEACHER_ID = 'teacher-anna';

/**
 * Заглушка Flōrus SSO для разработки: вытаскивает florus_user_id из заголовка
 * `x-florus-user-id`. Если заголовка нет — подставляет засеянного учителя.
 * В проде заменяется на реальную проверку токена. Кладёт teacherId в request.
 */
@Injectable()
export class DevAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { teacherId?: string }>();
    const header = req.headers['x-florus-user-id'];
    const value = Array.isArray(header) ? header[0] : header;
    req.teacherId = value?.trim() || DEFAULT_TEACHER_ID;
    return true;
  }
}
