import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { JournalData, JournalRow } from '@edustore/shared';
import { CurrentTeacher } from '../../common/auth/teacher.decorator';
import { JournalService } from './journal.service';
import { SetGradeDto, UpdateGradeDto } from './dto/set-grade.dto';
import { RequirePermission } from '../../common/authz/require-permission.decorator';

// /api/journal/*
@Controller('journal')
export class JournalController {
  constructor(private readonly journalService: JournalService) {}

  /** GET /api/journal/:classId?subjectId= — сетка журнала. */
  @Get(':classId')
  getJournal(
    @Param('classId') classId: string,
    @Query('subjectId') subjectId?: string,
  ): Promise<JournalData> {
    return this.journalService.getJournal(classId, subjectId);
  }

  /** POST /api/journal/grade — выставить/снять оценку. */
  @RequirePermission('journal.grades.edit')
  @Post('grade')
  setGrade(
    @Body() dto: SetGradeDto,
    @CurrentTeacher() teacherId: string,
  ): Promise<JournalRow> {
    return this.journalService.setGrade(dto, teacherId);
  }

  /** PUT /api/journal/grade/:gradeId — изменить оценку. */
  @RequirePermission('journal.grades.edit')
  @Put('grade/:gradeId')
  updateGrade(
    @Param('gradeId') gradeId: string,
    @Body() dto: UpdateGradeDto,
    @CurrentTeacher() teacherId: string,
  ): Promise<JournalRow> {
    return this.journalService.updateGrade(gradeId, dto, teacherId);
  }
}
