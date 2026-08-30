import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { COMM_ERRORS, type ParticipantRole, type Principal } from './comm.contract';

/**
 * Каналы Communitoria + ИНВАРИАНТ схемы: канал с участником-минором (minorPresent) НЕ принимает
 * участника role=external. Enforced на уровне СОЗДАНИЯ/ДОБАВЛЕНИЯ участника (единственный писатель —
 * этот сервис), ДО записи строки — не проверка в UI и не позже. Двусторонне: и external-в-минор-канал,
 * и минор-в-external-канал отклоняются. Сообщения/звонки — следующие чанки.
 */
@Injectable()
export class ChannelService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Создать канал. creatorUserId (если задан) автоматически становится первым модератором
   * (resource-level authz: добавление участников гейтится членством в moderators). Валидация kind —
   * на контроллере; сервис доверяет вызывающему (чанк-1 e2e зовёт напрямую).
   */
  createChannel(
    input: { kind: string; title?: string; scope?: string; classId?: string; moderators?: string[] },
    creatorUserId?: string,
  ) {
    const moderators = Array.from(new Set([...(creatorUserId ? [creatorUserId] : []), ...(input.moderators ?? [])]));
    return this.prisma.channel.create({
      data: {
        workspaceId: TenantContext.require(),
        kind: input.kind,
        title: input.title ?? null,
        scope: input.scope ?? null,
        classId: input.classId ?? null,
        moderators,
      },
    });
  }

  /** Resource-level authz: пользователь — модератор этого канала? */
  async isModerator(channelId: string, userId: string): Promise<boolean> {
    const ch = await this.prisma.channel.findUnique({ where: { id: channelId }, select: { moderators: true } });
    return ch !== null && ch.moderators.includes(userId);
  }

  /** Лента каналов; folder ≈ фильтр по kind (class|subject|shmo|school|parents|students|external|dm). */
  listChannels(filter: { kind?: string } = {}) {
    return this.prisma.channel.findMany({
      where: { ...(filter.kind ? { kind: filter.kind } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Добавить участника. Инвариант проверяется ДО записи: канал не может одновременно содержать
   * минора и external. Добавление минора выставляет minorPresent=true.
   */
  async addParticipant(channelId: string, p: Principal & { role: ParticipantRole }) {
    const ws = TenantContext.require();
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      include: { participants: true },
    });
    if (!channel) throw new NotFoundException('канал не найден');

    const addingMinor = !!p.studentId;
    const addingExternal = p.role === 'external';
    const hasMinor = channel.minorPresent || channel.participants.some((x) => x.isMinor);
    const hasExternal = channel.participants.some((x) => x.role === 'external');

    if ((addingExternal && hasMinor) || (addingMinor && hasExternal)) {
      throw new ForbiddenException({
        code: COMM_ERRORS.minorChannelNoExternal,
        message: 'канал с участником-минором не принимает участника external (инвариант безопасности)',
      });
    }

    const created = await this.prisma.channelParticipant.create({
      data: {
        workspaceId: ws,
        channelId,
        userId: p.userId ?? null,
        studentId: p.studentId ?? null,
        role: p.role,
        isMinor: addingMinor,
      },
    });
    if (addingMinor && !channel.minorPresent) {
      await this.prisma.channel.update({ where: { id: channelId }, data: { minorPresent: true } });
    }
    return created;
  }

  getChannel(channelId: string) {
    return this.prisma.channel.findUnique({ where: { id: channelId }, include: { participants: true } });
  }
}
