import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../common/events/event-bus';
import { Inbox } from '../../common/outbox/inbox.service';
import type { DomainEvent } from '../../common/events/domain-event';
import { CONTINGENT_EVENTS, type StudentEnrolledV1 } from '../contingent/contract';

/** УМК: ученик зачислен → закрепить УМК класса (демо — лог; идемпотентно). */
@Injectable()
export class UmkHandlers implements OnModuleInit {
  private readonly log = new Logger('param:umk');

  constructor(
    private readonly bus: EventBus,
    private readonly inbox: Inbox,
  ) {}

  onModuleInit() {
    this.bus.subscribe(CONTINGENT_EVENTS.studentEnrolled, 'umk', (e) => this.onEnrolled(e));
  }

  private async onEnrolled(e: DomainEvent) {
    const p = e.payload as StudentEnrolledV1;
    await this.inbox.handle(e.id, 'umk', async () => {
      this.log.log(`закреплён УМК класса ${p.classId} за учеником ${p.displayName}`);
    });
  }
}
