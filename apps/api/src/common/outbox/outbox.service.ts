import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DomainEvent } from '../events/domain-event';

/** Transactional outbox: запись события атомарно с доменной записью. */
@Injectable()
export class OutboxService {
  /**
   * Положить событие в outbox В ТОЙ ЖЕ транзакции, что и доменное изменение.
   * Гарантирует: либо и данные, и событие, либо ничего (никаких фантомных/потерянных).
   */
  async enqueue(tx: Prisma.TransactionClient, event: DomainEvent): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        id: event.id,
        type: event.type,
        workspaceId: event.workspaceId,
        correlationId: event.correlationId,
        causationId: event.causationId ?? undefined,
        depth: event.depth,
        actor: event.actor ?? undefined,
        payload: event.payload as Prisma.InputJsonValue,
      },
    });
  }
}
