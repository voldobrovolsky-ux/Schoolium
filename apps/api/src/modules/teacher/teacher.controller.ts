import { Controller, Get } from '@nestjs/common';
import type { TeacherClass, TeacherProfile } from '@edustore/shared';
import { CurrentTeacher } from '../../common/auth/teacher.decorator';
import { TeacherService } from './teacher.service';

// Маршруты после глобального префикса → /api/teacher/*
@Controller('teacher')
export class TeacherController {
  constructor(private readonly teacherService: TeacherService) {}

  /** GET /api/teacher/classes — флажки текущего учителя. */
  @Get('classes')
  getClasses(@CurrentTeacher() teacherId: string): Promise<TeacherClass[]> {
    return this.teacherService.getClasses(teacherId);
  }

  /** GET /api/teacher/profile — профиль шапки. */
  @Get('profile')
  getProfile(@CurrentTeacher() teacherId: string): Promise<TeacherProfile> {
    return this.teacherService.getProfile(teacherId);
  }
}
