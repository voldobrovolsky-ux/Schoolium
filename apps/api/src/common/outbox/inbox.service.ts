import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Идемпотентный inbox: дедупликация на стороне потребителя (at-least-once → effectively-once). */
@Injectable()
export class Inbox {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Если (eventId, consumer) уже обработано — пропуск (возврат false).
   * Иначе выполнить work и зафиксировать факт обработки В ТОЙ ЖЕ транзакции
   * (побочный эффект и отметка идемпотентности атомарны).
   */
  async handle(
    eventId: string,
    consumer: string,
    work: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const seen = await tx.processedEvent.findUnique({
        where: { eventId_consumer: { eventId, consumer } },
      });
      if (seen) return false;
      await work(tx);
      await tx.processedEvent.create({ data: { eventId, consumer } });
      return true;
    });
  }
}
