import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../common/auth/public.decorator';
import type { SessionUser } from '../../common/auth/flor.service';
import { DeviceService } from './device.service';
import { AuthorizeDto, BindDto } from './dto';

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

// Device Authorization Flow для главной страницы: /api/oidc/device/authorize|poll|bind
@Controller('oidc/device')
export class DeviceController {
  constructor(private readonly device: DeviceService) {}

  // Старт потока. Публичный: киоск ещё не авторизован.
  @Public()
  @Post('authorize')
  authorize(@Body() dto: AuthorizeDto) {
    return this.device.authorize(dto.purpose);
  }

  // Опрос статуса. При успешном входе (login) — ставим httpOnly-сессию киоску.
  @Public()
  @Get('poll')
  async poll(@Query('flowId') flowId: string, @Res({ passthrough: true }) res: Response) {
    const r = await this.device.poll(flowId ?? '');
    if (r.status === 'authenticated') {
      res.cookie('flor_sid', r.sid, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: SESSION_TTL_MS,
        path: '/',
      });
      return { status: 'authenticated' };
    }
    return r;
  }

  // Подтверждение привязки с телефона (требует сессии — НЕ публичный).
  @Post('bind')
  bind(@Body() dto: BindDto, @Req() req: Request & { user?: SessionUser }) {
    return this.device.bind(dto.code, req.user);
  }
}
