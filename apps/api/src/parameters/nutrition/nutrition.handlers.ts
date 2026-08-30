import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../common/events/event-bus';
import { OutboxService } from '../../common/outbox/outbox.service';
import { Inbox } from '../../common/outbox/inbox.service';
import { continuation, type DomainEvent } from '../../common/events/domain-event';
import { CONTINGENT_EVENTS, type StudentEnrolledV1 } from '../contingent/contract';

/** Питательный: ученик зачислен → создать заявку на питание (+ продолжить каскад). */
@Injectable()
export class NutritionHandlers implements OnModuleInit {
  private readonly log = new Logger('param:nutrition');

  constructor(
    private readonly bus: EventBus,
    private readonly inbox: Inbox,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit() {
    this.bus.subscribe(CONTINGENT_EVENTS.studentEnrolled, 'nutrition', (e) => this.onEnrolled(e));
  }

  private async onEnrolled(e: DomainEvent) {
    const p = e.payload as StudentEnrolledV1;
    await this.inbox.handle(e.id, 'nutrition', async (tx) => {
      await tx.mealOrder.create({
        data: { workspaceId: e.workspaceId, studentId: p.studentId },
      });
      await this.outbox.enqueue(
        tx,
        continuation(e, 'nutrition.order.created.v1', { studentId: p.studentId }, 'nutrition'),
      );
      this.log.log(`+ заявка на питание для ${p.displayName}`);
    });
  }
}
