import { Body, Controller, Post } from '@nestjs/common';
import { ContingentService } from './contingent.service';
import { OutboxDispatcher } from '../../common/outbox/outbox.dispatcher';
import { RequirePermission } from '../../common/authz/require-permission.decorator';

interface EnrollBody {
  classId: string;
  firstName: string;
  lastName: string;
}

@Controller('contingent')
export class ContingentController {
  constructor(
    private readonly contingent: ContingentService,
    private readonly dispatcher: OutboxDispatcher,
  ) {}

  /**
   * Зачислить ученика. Для наглядности сразу дренируем каскад
   * (в проде outbox дренируется фоновым диспетчером/CDC, асинхронно).
   */
  @RequirePermission('contingent.students.manage')
  @Post('students')
  async enroll(@Body() body: EnrollBody) {
    const student = await this.contingent.enrollStudent(body);
    await this.dispatcher.drain();
    return { studentId: student.id, displayName: student.displayName };
  }
}
