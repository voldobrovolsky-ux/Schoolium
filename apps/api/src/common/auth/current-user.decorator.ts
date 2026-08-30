import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { SessionUser } from './flor.service';

/** @CurrentUser() — сессия пользователя (Флёрус) или dev-пользователь. */
export const CurrentUser = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): SessionUser | undefined =>
    (ctx.switchToHttp().getRequest().user as SessionUser) ?? undefined,
);
