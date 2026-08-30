import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EventBus } from './event-bus';
import { InProcessEventBus } from './in-process-event-bus';
import { OutboxService } from '../outbox/outbox.service';
import { OutboxDispatcher } from '../outbox/outbox.dispatcher';
import { OutboxWorker } from '../outbox/outbox.worker';
import { Inbox } from '../outbox/inbox.service';

/**
 * Shared kernel событийной инфраструктуры: шина (in-process | NATS),
 * transactional outbox, идемпотентный inbox, диспетчер + фоновый воркер durability.
 * Глобальный — доступен всем параметрам. Прод-транспорт меняется одной строкой (useClass).
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    { provide: EventBus, useClass: InProcessEventBus },
    OutboxService,
    OutboxDispatcher,
    OutboxWorker, // §4.6: периодический дренаж — краш после commit не теряет события
    Inbox,
  ],
  exports: [EventBus, OutboxService, OutboxDispatcher, Inbox],
})
export class EventsModule {}
