import { Body, Controller, Post } from '@nestjs/common';
import {
  IsArray,
  IsOptional,
  IsString,
} from 'class-validator';
import type { TeacherNote } from '@prisma/client';
import type { TeacherNoteRequest } from '@edustore/shared';
import { CurrentTeacher } from '../../common/auth/teacher.decorator';
import { NotesService } from './notes.service';
import { RequirePermission } from '../../common/authz/require-permission.decorator';

/** Тело POST /teacher/notes. */
class TeacherNoteDto implements TeacherNoteRequest {
  @IsOptional()
  @IsString()
  audio?: string;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  lessonId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  studentIds?: string[];
}

// /api/teacher/notes
@Controller('teacher')
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  /** POST /api/teacher/notes — сохранить устную/текстовую заметку. */
  @RequirePermission('notes.teacher.edit')
  @Post('notes')
  create(
    @Body() dto: TeacherNoteDto,
    @CurrentTeacher() teacherId: string,
  ): Promise<TeacherNote> {
    return this.notesService.create(dto, teacherId);
  }
}
