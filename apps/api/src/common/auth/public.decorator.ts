import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
/** Помечает маршрут публичным (без сессии): login/callback/backchannel-logout. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
