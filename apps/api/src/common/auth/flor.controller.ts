import { Controller, Get, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from './public.decorator';
import { FlorService, type SessionUser } from './flor.service';
import { AuthzService, type ResolvedAccess } from '../authz/authz.service';

const SUBROLES = new Set(['zavuch', 'methodist', 'psychologist']);
// next — только относительный путь нашего origin (без открытого редиректа)
const safeNext = (raw: unknown): string | undefined =>
  typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\') ? raw : undefined;
const safeSubRole = (raw: unknown): string | undefined =>
  typeof raw === 'string' && SUBROLES.has(raw) ? raw : undefined;

// Эндпоинты RP (ADR-0005): /api/auth/flor/login|callback|me|logout|backchannel-logout
@Controller('auth/flor')
export class FlorController {
  constructor(
    private readonly flor: FlorService,
    private readonly authz: AuthzService,
  ) {}

  @Public()
  @Get('login')
  async login(@Req() req: Request, @Res() res: Response): Promise<void> {
    // continue-URL агентского инвайта может нести ?next=/&subrole=zavuch (онбординг по QR)
    const next = safeNext(req.query.next);
    const subRole = safeSubRole(req.query.subrole);
    const { url, tx } = await this.flor.buildAuthUrl({ next, subRole });
    // PKCE/state/nonce + подсказки онбординга — в короткоживущем httpOnly cookie (stateless tx)
    res.cookie('flor_tx', JSON.stringify(tx), { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600_000, path: '/api/auth/flor' });
    res.redirect(url);
  }

  @Public()
  @Get('callback')
  async callback(@Req() req: Request, @Res() res: Response): Promise<void> {
    const txRaw = (req.cookies?.flor_tx as string) ?? '';
    if (!txRaw) {
      res.status(400).send('no auth transaction');
      return;
    }
    const { sid, next } = await this.flor.handleCallback(req, JSON.parse(txRaw));
    res.clearCookie('flor_tx', { path: '/api/auth/flor' });
    res.cookie('flor_sid', sid, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000, path: '/' });
    // куда вернуть: next (тот же origin) поверх WEB_ORIGIN; иначе корень → роутинг по роли
    const base = process.env.WEB_ORIGIN ?? '';
    const dest = next ? (base ? new URL(next, base).toString() : next) : base || '/';
    res.redirect(dest);
  }

  /**
   * Профиль ВЫТЕСНЯЕМОГО контура. Отвечает только его сессии.
   *
   * Guard заполняет `req.user` и для сессии 1.1.1 — она проверяется первой, —
   * поэтому без явной проверки контура эта ручка отвечала 200 сотруднику
   * Schoolium. Фронт на корне спрашивает именно её и по ответу отдавал старый
   * кабинет: учитель, открывший сайт, оказывался в «Кабинете методиста» с
   * разделами КТП/КПП. Найдено обходом рабочего дня, ворота этого не ловили —
   * они проверяют экраны, а не то, чей экран показан.
   */
  @Get('me')
  async me(
    @Req() req: Request & { user?: SessionUser; contour?: 'schoolium' | 'legacy' },
  ): Promise<SessionUser & ResolvedAccess> {
    if (!req.user || req.contour === 'schoolium') throw new UnauthorizedException();
    // кабинет и права — из каталога (§5.1), не из кода фронта
    const access = await this.authz.resolveAccess(req.user.role, req.user.subRole);
    return { ...req.user, ...access };
  }

  @Public()
  @Get('logout')
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    const url = await this.flor.buildLogoutUrl(req.cookies?.flor_sid as string | undefined);
    res.clearCookie('flor_sid', { path: '/' });
    res.redirect(url);
  }

  @Public()
  @Post('backchannel-logout')
  async backchannel(@Req() req: Request, @Res() res: Response): Promise<void> {
    const token = ((req.body as Record<string, unknown>)?.logout_token as string) ?? '';
    if (!token) {
      res.status(400).send('missing token');
      return;
    }
    try {
      await this.flor.handleBackchannel(token);
      res.status(200).send();
    } catch {
      res.status(400).send('invalid');
    }
  }
}
