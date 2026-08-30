import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../common/events/event-bus';
import { OutboxService } from '../../common/outbox/outbox.service';
import { Inbox } from '../../common/outbox/inbox.service';
import { continuation, type DomainEvent } from '../../common/events/domain-event';
import { CONTINGENT_EVENTS, type StudentEnrolledV1 } from '../contingent/contract';

/** Communitoria: ученик зачислен → добавить в канал класса (+ продолжить каскад). */
@Injectable()
export class CommsHandlers implements OnModuleInit {
  private readonly log = new Logger('param:comms');

  constructor(
    private readonly bus: EventBus,
    private readonly inbox: Inbox,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit() {
    this.bus.subscribe(CONTINGENT_EVENTS.studentEnrolled, 'comms', (e) => this.onEnrolled(e));
  }

  private async onEnrolled(e: DomainEvent) {
    const p = e.payload as StudentEnrolledV1;
    await this.inbox.handle(e.id, 'comms', async (tx) => {
      await tx.channelMembership.create({
        data: { workspaceId: e.workspaceId, classId: p.classId, studentId: p.studentId },
      });
      // следующее звено каскада (depth+1)
      await this.outbox.enqueue(
        tx,
        continuation(e, 'communitoria.member.added.v1', { classId: p.classId, studentId: p.studentId }, 'comms'),
      );
      this.log.log(`+ ${p.displayName} → канал класса ${p.classId}`);
    });
  }
}
