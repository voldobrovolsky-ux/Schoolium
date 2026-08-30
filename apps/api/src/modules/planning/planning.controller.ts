import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import type { LessonDetail, LessonStation } from '@edustore/shared';
import { PlanningService, UpdateLessonInput } from './planning.service';
import { RequirePermission } from '../../common/authz/require-permission.decorator';

// Маршруты планирования живут под /api/teacher/* (как в контракте API_ROUTES).
@Controller('teacher')
export class PlanningController {
  constructor(private readonly planningService: PlanningService) {}

  /** GET /api/teacher/lessons/:classId?subjectId= — станции метро. */
  @Get('lessons/:classId')
  getLessons(
    @Param('classId') classId: string,
    @Query('subjectId') subjectId?: string,
  ): Promise<LessonStation[]> {
    return this.planningService.getLessons(classId, subjectId);
  }

  /** GET /api/teacher/lesson/:lessonId — детали урока. */
  @Get('lesson/:lessonId')
  getLesson(@Param('lessonId') lessonId: string): Promise<LessonDetail> {
    return this.planningService.getLessonDetail(lessonId);
  }

  /** PUT /api/teacher/lesson/:lessonId — обновить ДЗ/цели/страницы. */
  @RequirePermission('lesson.conduct')
  @Put('lesson/:lessonId')
  updateLesson(
    @Param('lessonId') lessonId: string,
    @Body() body: UpdateLessonInput,
  ): Promise<LessonDetail> {
    return this.planningService.updateLesson(lessonId, body);
  }
}
