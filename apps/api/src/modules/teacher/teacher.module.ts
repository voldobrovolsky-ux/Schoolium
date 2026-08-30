import { Module } from '@nestjs/common';
import { TeacherController } from './teacher.controller';
import { NotificationsController } from './notifications.controller';
import { TeacherService } from './teacher.service';

/** Модуль «учитель»: классы/группы учителя, профиль, уведомления. */
@Module({
  controllers: [TeacherController, NotificationsController],
  providers: [TeacherService],
  exports: [TeacherService],
})
export class TeacherModule {}
