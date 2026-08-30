import { Module } from '@nestjs/common';
import { CommsHandlers } from './comms.handlers';

// Потребитель каскада. Зависит только от shared kernel (EventBus/Inbox/Outbox — глобальные).
@Module({ providers: [CommsHandlers] })
export class CommsModule {}
