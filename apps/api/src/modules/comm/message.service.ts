import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { newEvent } from '../../common/events/domain-event';
import {
  COMM_ERRORS,
  COMM_EVENTS,
  MESSAGE_KINDS,
  MESSAGE_MODES,
  type MessageKind,
  type MessageMode,
  type MessageSentV1,
} from './comm.contract';

/**
 * Сообщения канала. КЛЮЧЕВОЙ ИНВАРИАНТ: mode ЯВНЫЙ — задаётся отправителем, модель режим НЕ решает
 * и НЕ дефолтит. Без явного mode создание падает (MODE_REQUIRED), а не молча становится chat.
 * СЕКРЕТНОСТЬ: всё персистится, PATCH помечает edited=true (историю не стираем), нет TTL/исчезновений.
 */
@Injectable()
export class MessageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async postMessage(
    channelId: string,
    authorId: string,
    input: { mode?: string; kind?: string; body?: string; replyToId?: string; attachmentIds?: string[] },
  ) {
    const ws = TenantContext.require();
    // ИНВАРИАНТ: mode обязателен и явен — не угадываем и не дефолтим (human-in-the-loop на входе)
    if (!input.mode) {
      throw new BadRequestException({ code: COMM_ERRORS.modeRequired, message: 'mode обязателен (chat|announcement) — режим не угадывается' });
    }
    if (!(MESSAGE_MODES as readonly string[]).includes(input.mode)) {
      throw new BadRequestException(`недопустимый mode: ${input.mode} (ожидается chat|announcement)`);
    }
    const kind = input.kind ?? 'text';
    if (!(MESSAGE_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException(`недопустимый kind: ${kind}`);
    }
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId }, include: { participants: true } });
    if (!channel) throw new NotFoundException('канал не найден');
    // Постить может ТОЛЬКО участник (или модератор) канала. Закрывает обход инварианта миноров на
    // уровне сообщений: внешнего (external) нельзя ни добавить в канал с минором, ни, значит, дать ему
    // писать в него — non-participant не проходит сюда.
    const allowed = channel.participants.some((p) => p.userId === authorId) || channel.moderators.includes(authorId);
    if (!allowed) {
      throw new ForbiddenException({ code: 'NOT_CHANNEL_PARTICIPANT', message: 'писать в канал может только его участник/модератор' });
    }

    const message = await this.prisma.message.create({
      data: {
        workspaceId: ws,
        channelId,
        authorId,
        mode: input.mode,
        kind,
        body: input.body ?? null,
        replyToId: input.replyToId ?? null,
        attachmentIds: input.attachmentIds ?? [],
      },
    });
    await this.prisma.$transaction((tx) =>
      this.outbox.enqueue(
        tx,
        newEvent<MessageSentV1>({
          type: COMM_EVENTS.messageSent,
          workspaceId: ws,
          actor: authorId,
          payload: { messageId: message.id, channelId, authorId, mode: message.mode as MessageMode, kind: message.kind as MessageKind },
        }),
      ),
    );
    return message;
  }

  /** Правка тела: edited=true, историю НЕ стираем (секретность/аудируемость). */
  async editMessage(messageId: string, body: string) {
    const msg = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('сообщение не найдено');
    return this.prisma.message.update({ where: { id: messageId }, data: { body, edited: true } });
  }

  /**
   * Лента канала — keyset-пагинация (createdAt desc, id desc). cursor = id последнего сообщения
   * предыдущей страницы. Самодостаточно по REST (без реалтайма).
   */
  async listMessages(channelId: string, opts: { cursor?: string; limit?: number } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
    let boundary: { createdAt: Date; id: string } | null = null;
    if (opts.cursor) {
      const c = await this.prisma.message.findUnique({ where: { id: opts.cursor }, select: { createdAt: true, id: true, channelId: true } });
      if (!c) throw new BadRequestException('курсор недействителен (сообщение не найдено)'); // не «тихо» страница 1
      if (c.channelId !== channelId) throw new BadRequestException('курсор из другого канала');
      boundary = { createdAt: c.createdAt, id: c.id };
    }
    const where = boundary
      ? {
          channelId,
          OR: [
            { createdAt: { lt: boundary.createdAt } },
            { createdAt: boundary.createdAt, id: { lt: boundary.id } },
          ],
        }
      : { channelId };
    const rows = await this.prisma.message.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  addReaction(messageId: string, userId: string, emoji: string) {
    return this.prisma.messageReaction.upsert({
      where: { messageId_userId_emoji: { messageId, userId, emoji } },
      update: {},
      create: { workspaceId: TenantContext.require(), messageId, userId, emoji },
    });
  }

  /**
   * ADVISORY-подсказка режима: возвращает aiSuggestedMode как МЕТАДАННЫЕ — НИКОГДА не финальный mode
   * и НИКОГДА не применяется автоматически (mode задаёт отправитель на POST). 0 ИИ — детерминированная
   * эвристика по маркерам; сообщение НЕ создаётся. TODO(comm): реальный классификатор (тоже advisory).
   */
  suggestMode(body: string): { aiSuggestedMode: MessageMode; advisory: true } {
    const b = (body ?? '').trim().toLowerCase();
    const announcementish = /^(объявлени|вниман|уважаемые|напоминани)/.test(b) || /\bдо\s+\d/.test(b);
    return { aiSuggestedMode: announcementish ? 'announcement' : 'chat', advisory: true };
  }
}
