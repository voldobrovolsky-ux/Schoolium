import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ReportPeriod,
  ReportsService,
  TeacherReport,
} from './reports.service';

// /api/reports/*
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /**
   * GET /api/reports/teacher/:id?period=week|month|quarter&classId=&subjectId=
   * Агрегированная заглушка отчёта учителя.
   */
  @Get('teacher/:id')
  teacher(
    @Param('id') id: string,
    @Query('period') period: ReportPeriod = 'week',
    @Query('classId') classId?: string,
    @Query('subjectId') subjectId?: string,
  ): Promise<TeacherReport> {
    return this.reportsService.teacherReport(id, period, classId, subjectId);
  }
}
