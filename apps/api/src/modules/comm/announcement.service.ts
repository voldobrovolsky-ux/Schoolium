import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { newEvent } from '../../common/events/domain-event';
import {
  ANNOUNCEMENT_AUDIENCES,
  COMM_EVENTS,
  type AnnouncementAudience,
  type AnnouncementPostedV1,
  type AckRecordedV1,
} from './comm.contract';

const uniq = (xs: string[]) => Array.from(new Set(xs));

interface ChannelForAudience {
  id: string;
  classId: string | null;
  participants: { userId: string | null; studentId: string | null; role: string }[];
}

/**
 * Объявления (официальный режим) = Message с mode=announcement + audience + ackDeadline. Реестр
 * подтверждений (required-set) резолвится из audience по scope канала. FSM: sent→delivered→read→
 * acknowledged; →overdue вычисляется по ackDeadline при чтении. Уход адресата из школы (нет Membership)
 * → строка вычищается из required-set (не вечный overdue). Секретность: объявление персистится как
 * обычное сообщение (аудируемо).
 */
@Injectable()
export class AnnouncementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async postAnnouncement(
    channelId: string,
    authorId: string,
    input: { body: string; audience: string; ackDeadline?: string },
  ) {
    const ws = TenantContext.require();
    if (!(ANNOUNCEMENT_AUDIENCES as readonly string[]).includes(input.audience)) {
      throw new BadRequestException(`недопустимый audience: ${input.audience} (parents|staff|all)`);
    }
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId }, include: { participants: true } });
    if (!channel) throw new NotFoundException('канал не найден');
    // Внешний (external) сюда не попадёт: endpoint гейчен comm.announcement.post, а это право есть
    // только у доменной роли завуча (staff·zavuch). «external» — роль УЧАСТНИКА канала, не доменная
    // роль токена, поэтому объявление в канал с минором может публиковать лишь доверенный сотрудник.

    const announcement = await this.prisma.message.create({
      data: {
        workspaceId: ws,
        channelId,
        authorId,
        // mode ЯВНЫЙ: официальный режим выбран отправителем самим фактом обращения к endpoint
        // объявлений (не модель угадала). Общий POST messages требует mode в теле; здесь endpoint = выбор.
        mode: 'announcement',
        kind: 'text',
        body: input.body,
        audience: input.audience,
        ackDeadline: input.ackDeadline ? new Date(input.ackDeadline) : null,
      },
    });

    const required = await this.resolveAudience(channel, input.audience as AnnouncementAudience);
    if (required.length) {
      await this.prisma.ack.createMany({
        data: required.map((userId) => ({ workspaceId: ws, announcementId: announcement.id, userId, state: 'sent' })),
        skipDuplicates: true,
      });
    }
    await this.prisma.$transaction((tx) =>
      this.outbox.enqueue(
        tx,
        newEvent<AnnouncementPostedV1>({
          type: COMM_EVENTS.announcementPosted,
          workspaceId: ws,
          actor: authorId,
          payload: {
            announcementId: announcement.id,
            channelId,
            audience: input.audience as AnnouncementAudience,
            requiredCount: required.length,
            ackDeadline: announcement.ackDeadline?.toISOString() ?? null,
          },
        }),
      ),
    );
    return { announcement, requiredCount: required.length };
  }

  /** audience → required-set userId (в scope канала). Все запросы tenant-scoped guard'ом. */
  private async resolveAudience(channel: ChannelForAudience, audience: AnnouncementAudience): Promise<string[]> {
    const adults = channel.participants.flatMap((p) => (p.userId ? [{ userId: p.userId, role: p.role }] : []));
    if (audience === 'all') return uniq(adults.map((a) => a.userId));
    if (audience === 'staff') return uniq(adults.filter((a) => a.role === 'staff' || a.role === 'teacher').map((a) => a.userId));
    // parents: родители миноров канала (по classId → ученики, иначе по минор-участникам) через parenthood
    let studentIds: string[];
    if (channel.classId) {
      studentIds = (await this.prisma.student.findMany({ where: { classId: channel.classId }, select: { id: true } })).map((s) => s.id);
    } else {
      studentIds = uniq(channel.participants.flatMap((p) => (p.studentId ? [p.studentId] : [])));
    }
    if (!studentIds.length) return [];
    const edges = await this.prisma.parenthood.findMany({ where: { studentId: { in: studentIds } }, select: { parentUserId: true } });
    return uniq(edges.map((e) => e.parentUserId));
  }

  /** Подтверждение адресатом. Только для тех, кто в required-set (иначе 403). */
  async recordAck(announcementId: string, userId: string) {
    const ws = TenantContext.require();
    const ack = await this.prisma.ack.findUnique({ where: { announcementId_userId: { announcementId, userId } } });
    if (!ack) {
      throw new ForbiddenException({ code: 'NOT_IN_REQUIRED_SET', message: 'вы не в списке адресатов этого объявления' });
    }
    if (ack.state === 'acknowledged') return ack; // идемпотентно: повтор не плодит событие ack.recorded
    const updated = await this.prisma.ack.update({
      where: { announcementId_userId: { announcementId, userId } },
      data: { state: 'acknowledged' },
    });
    await this.prisma.$transaction((tx) =>
      this.outbox.enqueue(
        tx,
        newEvent<AckRecordedV1>({
          type: COMM_EVENTS.ackRecorded,
          workspaceId: ws,
          actor: userId,
          payload: { announcementId, userId, state: 'acknowledged' },
        }),
      ),
    );
    return updated;
  }

  /**
   * Реестр подтверждений. Reconcile: адресаты без Membership в ЭТОЙ школе (ушли) → вычищаются из
   * required-set. overdue вычисляется: не acknowledged и просрочен ackDeadline. Membership не под
   * tenant-guard (directory) → фильтруем workspaceId явно.
   */
  async listAcks(announcementId: string) {
    const ws = TenantContext.require();
    const ann = await this.prisma.message.findUnique({ where: { id: announcementId }, select: { ackDeadline: true } });
    if (!ann) throw new NotFoundException('объявление не найдено');
    const acks = await this.prisma.ack.findMany({ where: { announcementId }, orderBy: { userId: 'asc' } });

    const memberships = await this.prisma.membership.findMany({
      where: { workspaceId: ws, florusUserId: { in: acks.map((a) => a.userId) } },
      select: { florusUserId: true },
    });
    const members = new Set(memberships.map((m) => m.florusUserId));
    const stale = acks.filter((a) => !members.has(a.userId));
    if (stale.length) {
      await this.prisma.ack.deleteMany({ where: { id: { in: stale.map((a) => a.id) } } });
    }

    const now = new Date();
    const live = acks.filter((a) => members.has(a.userId));
    const rows = live.map((a) => ({
      userId: a.userId,
      state: ann.ackDeadline && a.state !== 'acknowledged' && now > ann.ackDeadline ? 'overdue' : a.state,
      updatedAt: a.updatedAt,
    }));
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.state] = (counts[r.state] ?? 0) + 1;
    return { announcementId, required: rows.length, counts, acks: rows };
  }
}
