import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { CancelLessonDto, SetSubstituteDto } from '@edustore/shared';
import { RequirePermission } from '../../common/authz/require-permission.decorator';
import type { SessionUser } from '../../common/auth/flor.service';
import { actorOf } from '../actor';
import { SubstitutionService } from './substitution.service';

type Req0 = Request & { user?: SessionUser };

/**
 * Датированные уроки и замена (AR-207) — §11 строки 54–56. Отдельный контроллер
 * на префиксе `v1`: `GET /v1/schedule/lessons` соседствует с `ScheduleController`
 * (`v1/schedule`, у которого нет параметрических маршрутов — конфликта путей нет),
 * маршруты `lessons/:id/*` — с журналом (`topic`, `marks`). Каждая мутация несёт
 * `@RequirePermission` из каталога (G-10); принадлежность урока проверяет сервис.
 */
@Controller('v1')
export class LessonsController {
  constructor(private readonly svc: SubstitutionService) {}

  /**
   * Датированный оверлей недели `S-40` (`DatedLessonDto[]`): отмены и замены
   * поверх шаблонной недели. `teacherId=me` — уроки действующего.
   */
  @RequirePermission('schedule.read')
  @Get('schedule/lessons')
  list(
    @Req() req: Req0,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('classId') classId?: string,
    @Query('teacherId') teacherId?: string,
  ) {
    const actor = actorOf(req);
    return this.svc.listLessons(String(from ?? ''), String(to ?? ''), {
      classId: classId || undefined,
      teacherId: teacherId === 'me' ? actor.userId : teacherId || undefined,
    }, actor);
  }

  /** §11 строка 54 · `M-31.btn.submit`: педагог отменяет СВОЙ урок; замену подбирает сервер. */
  @RequirePermission('lesson.cancel.self')
  @Post('lessons/:id/cancel')
  cancel(@Req() req: Req0, @Param('id') id: string, @Body() body: CancelLessonDto) {
    return this.svc.cancel(id, actorOf(req), body);
  }

  /** §11 строка 55 · `S-40.btn.withdrawCancel`: отзыв — своё педагогом, любое строителем. */
  @RequirePermission(['lesson.cancel.self', 'schedule.build'])
  @Delete('lessons/:id/cancel')
  withdraw(@Req() req: Req0, @Param('id') id: string) {
    return this.svc.withdraw(id, actorOf(req));
  }

  /** §11 строка 56 · `S-40.select.substitute`: ручное назначение или переназначение заместителя. */
  @RequirePermission('schedule.build')
  @Post('lessons/:id/substitute')
  substitute(@Req() req: Req0, @Param('id') id: string, @Body() body: SetSubstituteDto) {
    return this.svc.setSubstitute(id, actorOf(req), body);
  }
}
