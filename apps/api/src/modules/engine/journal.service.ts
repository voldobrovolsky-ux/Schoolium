import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { newEvent } from '../../common/events/domain-event';
import { ENGINE_EVENTS, type GradePostedV1 } from './engine.contract';

export interface PostGradeInput {
  lessonId: string;
  studentId: string;
  grade: string; // '5'|'4'|'3'|'2'|'н'
  comment?: string;
  source?: 'MANUAL' | 'VOICE';
  workType?: string;
  period?: string;
  briefTestId?: string; // если оценка из проверенной летучки → закрыть её FSM (checked→done)
}

/**
 * Журнал (Техспека §3). Ячейка пишется ТОЛЬКО через grade.posted — явное человеко-авторское
 * действие учителя (реальный studentId). assessment.checked сюда НЕ пишет (Архстандарт §8):
 * проверенный балл — лишь ПРЕДЛОЖЕНИЕ, оценку постит человек.
 */
@Injectable()
export class JournalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async postGrade(input: PostGradeInput, teacherId: string) {
    const ws = TenantContext.require();
    const lesson = await this.prisma.lesson.findUnique({ where: { id: input.lessonId } });
    if (!lesson) throw new NotFoundException('урок не найден');
    return this.prisma.$transaction(async (tx) => {
      // upsert: одна ячейка на ученика×урок (AR-4) — повторный пост = правка оценки
      const cell = await tx.journalCell.upsert({
        where: { studentId_lessonId: { studentId: input.studentId, lessonId: input.lessonId } },
        create: {
          workspaceId: ws,
          classId: lesson.classId,
          disciplineId: lesson.subjectId,
          studentId: input.studentId,
          lessonId: input.lessonId,
          grade: input.grade,
          comment: input.comment ?? null,
          source: input.source ?? 'MANUAL',
          workType: input.workType ?? null,
          period: input.period ?? null,
          postedBy: teacherId,
        },
        update: {
          grade: input.grade,
          ...(input.comment !== undefined ? { comment: input.comment } : {}),
          source: input.source ?? 'MANUAL',
          ...(input.workType !== undefined ? { workType: input.workType } : {}),
          ...(input.period !== undefined ? { period: input.period } : {}),
          postedBy: teacherId,
        },
      });
      // оценка из летучки → закрыть FSM летучки (checked → done). updateMany не падает на 0 строк.
      if (input.briefTestId) {
        await tx.briefTest.updateMany({ where: { id: input.briefTestId }, data: { status: 'done' } });
      }
      await this.outbox.enqueue(
        tx,
        newEvent<GradePostedV1>({
          type: ENGINE_EVENTS.gradePosted,
          workspaceId: ws,
          actor: teacherId,
          payload: { lessonId: input.lessonId, studentId: input.studentId, grade: input.grade },
        }),
      );
      return { id: cell.id, grade: cell.grade, postedAt: cell.postedAt };
    });
  }

  /** Снятие оценки (коррекция учителя). Событие — для аудита (AR-30). */
  async removeGrade(studentId: string, lessonId: string, teacherId: string): Promise<void> {
    const ws = TenantContext.require();
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.journalCell.deleteMany({ where: { studentId, lessonId } });
      if (removed.count === 0) return; // нечего снимать — не шумим событием
      await this.outbox.enqueue(
        tx,
        newEvent({
          type: ENGINE_EVENTS.gradeRemoved,
          workspaceId: ws,
          actor: teacherId,
          payload: { lessonId, studentId },
        }),
      );
    });
  }

  async getJournal(classId?: string, disciplineId?: string, period?: string) {
    const cells = await this.prisma.journalCell.findMany({
      where: { ...(classId && { classId }), ...(disciplineId && { disciplineId }), ...(period && { period }) },
      orderBy: { postedAt: 'desc' },
    });
    // policy — из AssessmentPolicy (завуч, контракт §5): по специфичности дисциплина → класс → школа
    let policy = disciplineId ? await this.prisma.assessmentPolicy.findFirst({ where: { disciplineId } }) : null;
    policy ??= classId ? await this.prisma.assessmentPolicy.findFirst({ where: { classId } }) : null;
    policy ??= await this.prisma.assessmentPolicy.findFirst({ where: { scope: 'школа' } });
    return { cells, policy };
  }
}
