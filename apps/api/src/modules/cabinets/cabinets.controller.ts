import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { SessionUser } from '../../common/auth/flor.service';
import { RequirePermission } from '../../common/authz/require-permission.decorator';
import { CabinetsService, type CourseInput, type MethodicInput } from './cabinets.service';

interface AssignBody { teacherId: string; courseId: string }

// Кабинеты — /api/v1/edu/*. GET свободны (tenant-scoped); PUT/POST гейчены ролью (§5.1).
@Controller('v1/edu')
export class CabinetsController {
  constructor(private readonly cabinets: CabinetsService) {}

  private actor(req: Request & { user?: SessionUser }): string {
    return req.user?.florusUserId ?? 'system';
  }

  // ─── Методики (методист пишет; читают все) ───
  @Get('methodics')
  listMethodics(@Query('disciplineId') disciplineId?: string) {
    return this.cabinets.listMethodics(disciplineId);
  }
  @Get('methodics/:id')
  getMethodic(@Param('id') id: string) {
    return this.cabinets.getMethodic(id);
  }
  @RequirePermission('methodics.manage')
  @Post('methodics')
  createMethodic(@Body() body: MethodicInput, @Req() req: Request & { user?: SessionUser }) {
    return this.cabinets.createMethodic(body, this.actor(req));
  }
  @RequirePermission('methodics.manage')
  @Put('methodics/:id')
  updateMethodic(@Param('id') id: string, @Body() body: Partial<MethodicInput>) {
    return this.cabinets.updateMethodic(id, body);
  }

  // ─── Курсы + курирование (методист) ───
  @Get('courses')
  listCourses(@Query('scope') scope?: string, @Req() req?: Request & { user?: SessionUser }) {
    // scope=assigned → курсы, назначенные текущему учителю
    return this.cabinets.listCourses(scope === 'assigned' ? req?.user?.florusUserId : undefined);
  }
  @RequirePermission('courses.manage')
  @Post('courses')
  createCourse(@Body() body: CourseInput, @Req() req: Request & { user?: SessionUser }) {
    return this.cabinets.createCourse(body, this.actor(req));
  }
  @Get('curation/teachers')
  curationTeachers() {
    return this.cabinets.curationTeachers();
  }
  @RequirePermission('curation.assign')
  @Post('curation/assign-course')
  assignCourse(@Body() body: AssignBody, @Req() req: Request & { user?: SessionUser }) {
    return this.cabinets.assignCourse(body.teacherId, body.courseId, this.actor(req));
  }

  // ─── Надзор завуча (scope=school) ───
  @Get('ktp/school')
  ktpSchool() {
    return this.cabinets.ktpSchool();
  }
  @Get('journals/school')
  journalsSchool() {
    return this.cabinets.journalsSchool();
  }
  @Get('analytics/school')
  analyticsSchool() {
    return this.cabinets.analyticsSchool();
  }
}
