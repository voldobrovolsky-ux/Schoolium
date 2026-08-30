import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { newEvent } from '../../common/events/domain-event';
import { CONTINGENT_EVENTS, type StudentEnrolledV1 } from './contract';

/**
 * Контингентный параметр (демо-срез): зачисление ученика порождает факт-событие
 * `contingent.student.enrolled.v1` — корень каскада через УМК/Communitoria/Питание.
 */
@Injectable()
export class ContingentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async enrollStudent(input: {
    classId: string;
    firstName: string;
    lastName: string;
    actor?: string;
  }) {
    // создание ученика и публикация события — атомарно (transactional outbox)
    return this.prisma.$transaction(async (tx) => {
      const klass = await tx.class.findUniqueOrThrow({ where: { id: input.classId } });
      const count = await tx.student.count({ where: { classId: input.classId } });
      const displayName = `${input.lastName} ${input.firstName}`;
      const student = await tx.student.create({
        data: {
          workspaceId: klass.workspaceId, // тенант = школа (из класса) — корректно и вне request-контекста
          classId: input.classId,
          number: count + 1,
          firstName: input.firstName,
          lastName: input.lastName,
          displayName,
        },
      });
      const event = newEvent<StudentEnrolledV1>({
        type: CONTINGENT_EVENTS.studentEnrolled,
        workspaceId: klass.workspaceId,
        actor: input.actor ?? 'system',
        payload: {
          studentId: student.id,
          classId: student.classId,
          displayName,
          number: student.number,
        },
      });
      await this.outbox.enqueue(tx, event);
      return student;
    });
  }
}
