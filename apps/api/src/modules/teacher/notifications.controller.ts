import { Controller, Get } from '@nestjs/common';
import type { NotificationDto } from '@edustore/shared';
import { CurrentTeacher } from '../../common/auth/teacher.decorator';
import { TeacherService } from './teacher.service';

// /api/notifications
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly teacherService: TeacherService) {}

  /** GET /api/notifications — уведомления текущего учителя. */
  @Get()
  list(@CurrentTeacher() teacherId: string): Promise<NotificationDto[]> {
    return this.teacherService.getNotifications(teacherId);
  }
}
