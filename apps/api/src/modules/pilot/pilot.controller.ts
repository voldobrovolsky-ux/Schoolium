import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Req, Res, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../common/auth/public.decorator';
import type { SessionUser } from '../../common/auth/flor.service';
import { PilotService } from './pilot.service';
import { AUTH_MODE_PILOT, PILOT_ROLES, type PilotRole } from './pilot.contract';

interface StaffBody { role: string; displayName?: string }
interface ClassBody { parallel: number; letter: string }
interface SubjectBody { name: string; color?: string }
interface AssignBody { userId: string; classId: string; subjectId: string; subGroupId?: string }
interface LoginBody { token: string; phone?: string }

// ВРЕМЕННЫЙ пилотный auth — /api/pilot/*. Owner-экран под ключом PILOT_OWNER_KEY; QR-вход выдаёт
// сессию Флёр-формы. Весь модуль активен только при AUTH_MODE=pilot-qr (иначе 403). НЕ смешан с
// dev-bypass x-florus-* (тот — для CI/e2e). Минимальный набор ровно под пилот, не полноценная админка.
@Controller('pilot')
export class PilotController {
  constructor(private readonly pilot: PilotService) {}

  private assertPilotMode() {
    // 503 (а не 403) — чтобы фронт отличал «режим выключен» от «неверный ключ owner» (тоже 403)
    if (process.env.AUTH_MODE !== AUTH_MODE_PILOT) {
      throw new ServiceUnavailableException('пилотный auth выключен (AUTH_MODE ≠ pilot-qr)');
    }
  }

  // owner — не доменная роль токена (§7.4), поэтому гейт по секрету пилота (fail-closed, временный трейдофф)
  private assertOwner(req: Request) {
    const key = process.env.PILOT_OWNER_KEY;
    const raw = req.headers['x-pilot-owner-key'];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    if (!key || provided !== key) throw new ForbiddenException('owner-доступ пилота: неверный ключ');
  }

  private actor(req: Request & { user?: SessionUser }): string {
    return req.user?.florusUserId ?? 'system';
  }

  // ─── Owner-экран (3 действия) ───
  @Public()
  @Post('owner/staff')
  createStaff(@Body() body: StaffBody, @Req() req: Request) {
    this.assertPilotMode();
    this.assertOwner(req);
    if (!(PILOT_ROLES as readonly string[]).includes(body.role)) throw new BadRequestException('роль: teacher | zavuch');
    return this.pilot.createInvite({ role: body.role as PilotRole, displayName: body.displayName });
  }

  @Public()
  @Get('owner/staff')
  listStaff(@Req() req: Request) {
    this.assertPilotMode();
    this.assertOwner(req);
    return this.pilot.listStaff();
  }

  /** Отозвать приглашение (только не вошедшего) — owner. */
  @Public()
  @Delete('owner/staff/:inviteId')
  revokeStaff(@Param('inviteId') inviteId: string, @Req() req: Request) {
    this.assertPilotMode();
    this.assertOwner(req);
    return this.pilot.revokeInvite(inviteId);
  }

  @Public()
  @Post('owner/classes')
  createClass(@Body() body: ClassBody, @Req() req: Request) {
    this.assertPilotMode();
    this.assertOwner(req);
    return this.pilot.createClass(body);
  }

  @Public()
  @Get('owner/classes')
  listClasses(@Req() req: Request) {
    this.assertPilotMode();
    this.assertOwner(req);
    return this.pilot.listClasses();
  }

  @Public()
  @Post('owner/subjects')
  createSubject(@Body() body: SubjectBody, @Req() req: Request) {
    this.assertPilotMode();
    this.assertOwner(req);
    return this.pilot.createSubject(body);
  }

  @Public()
  @Get('owner/subjects')
  listSubjects(@Req() req: Request) {
    this.assertPilotMode();
    this.assertOwner(req);
    return this.pilot.listSubjects();
  }

  @Public()
  @Post('owner/assign')
  assign(@Body() body: AssignBody, @Req() req: Request) {
    this.assertPilotMode();
    this.assertOwner(req);
    return this.pilot.assign(body);
  }

  // ─── QR-вход: резолв по инвайт-токену (не по телефону), выдаём Флёр-форму сессии ───
  @Public()
  @Post('login')
  async login(@Body() body: LoginBody, @Res({ passthrough: true }) res: Response) {
    this.assertPilotMode();
    if (!body?.token) throw new BadRequestException('нет токена приглашения');
    const { sid, userId } = await this.pilot.resolveInvite({ token: body.token, phone: body.phone });
    // тот же cookie, что OIDC-путь (flor_sid) → нижестоящий AuthGuard не знает разницы
    res.cookie('flor_sid', sid, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000, path: '/' });
    return { ok: true, userId };
  }

  // ─── Состояние кабинета (аутентифицирован пилотной сессией) ───
  @Get('cabinet-state')
  cabinetState(@Req() req: Request & { user?: SessionUser }) {
    if (!req.user) throw new UnauthorizedException();
    return this.pilot.cabinetState(this.actor(req));
  }
}
