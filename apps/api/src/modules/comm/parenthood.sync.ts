import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Синхронизация рёбер родительства из ДИРЕКТОРИИ ФЛЁРУСА. Источник истины — Флёрус; EduStore держит
 * синхронизированное ЗЕРКАЛО (эта служба — единственный писатель `Parenthood`; домен только читает).
 *
 * TODO(comm): реальный коннектор к Флёр-directory (pull по расписанию / вебхук). Сейчас —
 * идемпотентный upsert зеркала (provisioning/seed зовёт `syncEdge`); EduStore рёбра НЕ авторит.
 */
@Injectable()
export class ParenthoodSync {
  private readonly log = new Logger('ParenthoodSync');

  constructor(private readonly prisma: PrismaService) {}

  /** Идемпотентно отразить ребро (родитель↔ребёнок) из Флёруса в локальное зеркало. */
  async syncEdge(input: { workspaceId: string; parentUserId: string; studentId: string }) {
    const edge = await this.prisma.parenthood.upsert({
      where: { parentUserId_studentId: { parentUserId: input.parentUserId, studentId: input.studentId } },
      update: {},
      create: {
        workspaceId: input.workspaceId,
        parentUserId: input.parentUserId,
        studentId: input.studentId,
        source: 'florus',
      },
    });
    this.log.debug(`ребро parenthood ${input.parentUserId} → ${input.studentId} (зеркало Флёруса)`);
    return edge;
  }
}
