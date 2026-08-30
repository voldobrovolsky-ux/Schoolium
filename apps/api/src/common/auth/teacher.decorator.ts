import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { DEFAULT_TEACHER_ID } from './dev-auth.guard';

/**
 * @CurrentTeacher() — извлекает teacherId, проставленный DevAuthGuard.
 * Фоллбэк на засеянного учителя оставлен для надёжности (DEV).
 */
export const CurrentTeacher = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request & { teacherId?: string }>();
    return req.teacherId || DEFAULT_TEACHER_ID;
  },
);
