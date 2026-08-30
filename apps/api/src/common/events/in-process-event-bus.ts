import { Injectable, Logger } from '@nestjs/common';
import {
  EventBus,
  type EventHandler,
  type Subscription,
  subjectMatches,
} from './event-bus';
import { type DomainEvent, MAX_CASCADE_DEPTH } from './domain-event';
import { PrismaService } from '../prisma/prisma.service';

/**
 * In-process транспорт шины (dev/тест). В проде заменяется на NATS JetStream
 * (durable consumers, dedup по Nats-Msg-Id = event.id, max_deliver + DLQ) —
 * без изменения параметров: интерфейс EventBus тот же.
 *
 * AR-24: дедуп ЦЕНТРАЛИЗОВАН на доставке — каждая пара (событие × подписчик) обрабатывается
 * не более одного раза (ProcessedEvent, ключ `bus:<consumer>`). Правило «каждый подписчик
 * через inbox» невозможно забыть: оно навешивается здесь, а не по месту. Внутренние
 * Inbox.handle параметров (свои consumer-ключи) остаются второй линией — их отметка
 * атомарна с эффектом; шинная отметка ставится после успеха хендлера.
 */
@Injectable()
export class InProcessEventBus extends EventBus {
  private readonly subs: Subscription[] = [];
  private readonly log = new Logger('EventBus');

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  subscribe(pattern: string, consumer: string, handler: EventHandler): void {
    this.subs.push({ pattern, consumer, handler });
    this.log.log(`подписка ${consumer} ← ${pattern}`);
  }

  async publish(event: DomainEvent): Promise<void> {
    // depth-guard: обрываем потенциальную петлю каскада
    if (event.depth > MAX_CASCADE_DEPTH) {
      this.log.error(
        `DROP ${event.type} depth=${event.depth} > MAX (защита от петли) corr=${event.correlationId}`,
      );
      return;
    }
    const matched = this.subs.filter((s) => subjectMatches(s.pattern, event.type));
    this.log.log(`▶ ${event.type} depth=${event.depth} → ${matched.length} подписчик(ов)`);
    for (const s of matched) {
      const consumerKey = `bus:${s.consumer}`;
      try {
        // AR-24: пропуск уже доставленной пары (событие, подписчик) — at-least-once → effectively-once
        const seen = await this.prisma.processedEvent.findUnique({
          where: { eventId_consumer: { eventId: event.id, consumer: consumerKey } },
        });
        if (seen) {
          this.log.log(`↻ skip ${event.type} → ${s.consumer} (уже доставлено)`);
          continue;
        }
        await s.handler(event);
        // отметка после успеха; гонка двух доставок гасится unique-ключом (P2002 = уже отмечено)
        await this.prisma.processedEvent
          .create({ data: { eventId: event.id, consumer: consumerKey } })
          .catch((e: { code?: string }) => {
            if (e.code !== 'P2002') throw e;
          });
      } catch (err) {
        // изоляция: падение одного потребителя не валит остальных.
        // в проде: nak → ретрай с backoff → DLQ. Здесь — лог.
        this.log.error(`✗ consumer "${s.consumer}" на ${event.type}: ${(err as Error).message}`);
      }
    }
  }
}
