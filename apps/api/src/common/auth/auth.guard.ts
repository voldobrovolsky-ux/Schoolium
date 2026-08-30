import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC } from './public.decorator';
import { FlorService, type SessionUser } from './flor.service';
import { DEFAULT_TEACHER_ID } from './dev-auth.guard';
import { SCHOOL_COOKIE, SchoolSessionService } from './school-session.service';

/**
 * Единый guard: сессия Флёруса (cookie flor_sid) → request.user.
 * Публичные маршруты (login/callback/backchannel) пропускаются.
 * DEV-bypass (AUTH_MODE != production): x-florus-user-id или засеянный учитель —
 * чтобы локальная разработка/тесты работали до настройки Флёруса на сервере.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly flor: FlorService,
    private readonly school: SchoolSessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<
      Request & { user?: SessionUser; teacherId?: string; sessionId?: string; contour?: 'schoolium' | 'legacy' }
    >();

    // Контур доступа 1.1.1 (AR-94): httpOnly-cookie sch_sid, сессия 90 дней.
    // Проверяется первой — это действующий контур; flor_sid ниже принадлежит
    // вытесненному OIDC-контуру (AR-46, AR-49) и уходит вместе с ним.
    const schoolToken = req.cookies?.[SCHOOL_COOKIE] as string | undefined;
    if (schoolToken) {
      const session = await this.school.read(schoolToken);
      if (session) {
        req.user = session;
        req.sessionId = session.sessionId;
        req.teacherId = session.florusUserId;
        // Контур сессии называется ЯВНО. Без этого ручки вытесняемого контура
        // отвечают сессии 1.1.1 (они защищены этим же guard, и `req.user` для
        // них уже заполнен) — и сотрудник школы, открывший корень сайта,
        // попадает в чужой кабинет. Найдено обходом рабочего дня.
        req.contour = 'schoolium';
        return true;
      }
    }

    const sid = req.cookies?.flor_sid as string | undefined;
    if (sid) {
      const session = await this.flor.getSession(sid);
      if (session) {
        req.user = session;
        req.teacherId = session.florusUserId; // совместимость с @CurrentTeacher
        req.contour = 'legacy';
        return true;
      }
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    // DEV-bypass по x-florus-* — ТОЛЬКО для локальной разработки/CI/e2e. Fail-CLOSED: включается
    // лишь при ЯВНОМ AUTH_MODE ∈ {dev,test,ci}. Любое другое значение (production, pilot-qr, опечатка,
    // пусто, отсутствует) → байпас выключен, доступ только по реальной сессии. Опечатка в env не
    // открывает аутентификацию молча.
    const authMode = process.env.AUTH_MODE?.trim();
    if (authMode === 'dev' || authMode === 'test' || authMode === 'ci') {
      const header = req.headers['x-florus-user-id'];
      const uid = (Array.isArray(header) ? header[0] : header)?.trim() || DEFAULT_TEACHER_ID;
      // DEV: x-florus-role / x-florus-subrole переопределяют доменную роль — чтобы тестировать
      // RBAC-гейтинг под разными ролями (завуч approve, учитель conduct) без живого Флёра.
      const hdr = (k: string) => {
        const v = req.headers[k];
        return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
      };
      req.teacherId = uid;
      req.user = {
        florusUserId: uid,
        workspaceId: null,
        florusWorkspaceId: null,
        florusOrgId: null,
        role: hdr('x-florus-role') ?? 'teacher',
        subRole: hdr('x-florus-subrole') ?? null,
        name: 'Анна Соколова',
      };
      return true;
    }

    return false; // production + нет сессии + не public → 403
  }
}
