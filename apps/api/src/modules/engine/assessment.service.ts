import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { newEvent } from '../../common/events/domain-event';
import { ENGINE_EVENTS, type AssessmentCheckedV1, type BrieftestGeneratedV1 } from './engine.contract';

// Пул псевдонимов для печатных листов (код вместо ФИО, гейт §3). Раскрытие — только через
// BriefTestCode-карту; сам код ничего не выдаёт.
const NOUNS = [
  'яблоко', 'груша', 'сокол', 'тигр', 'клён', 'комета', 'маяк', 'вектор', 'атом', 'пингвин',
  'лотос', 'кварц', 'бриз', 'гранат', 'юпитер', 'компас', 'факел', 'оникс', 'зебра', 'эхо',
  'титан', 'ирис', 'нимб', 'ольха', 'пульс', 'рубин', 'спектр', 'утёс', 'фрегат', 'янтарь',
];

/**
 * Петля летучки (Движок §5): печать по КОДАМ → Tesseract (0 ИИ, локально) → assessment.checked(code)
 * → ИОМ. Сканы НЕ в docs/. Журнал НЕ слушает assessment.checked (только grade.posted, журнал-чанк).
 * Гейт §3: при печати id→code (карта BriefTestCode), резолв code→id — в ИОМ/журнале.
 */
@Injectable()
export class AssessmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /** Печать летучки: коды присутствующим (v1: все ученики класса), статус generated. */
  async print(lessonId: string, type = 'летучка') {
    const ws = TenantContext.require();
    const lesson = await this.prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) throw new NotFoundException('урок не найден');
    const students = await this.prisma.student.findMany({
      where: { classId: lesson.classId },
      orderBy: { number: 'asc' },
      select: { id: true },
    });
    if (!students.length) throw new ConflictException({ code: 'NO_STUDENTS', message: 'нет учеников в классе' });
    const assign = students.map((s, i) => ({ studentId: s.id, code: `${NOUNS[i % NOUNS.length]}${100 + i}` }));
    const codes = assign.map((a) => a.code);
    return this.prisma.$transaction(async (tx) => {
      const bt = await tx.briefTest.create({
        data: { workspaceId: ws, lessonId, type, status: 'generated', presentStudentCodes: codes },
      });
      await tx.briefTestCode.createMany({
        data: assign.map((a) => ({ workspaceId: ws, briefTestId: bt.id, studentCode: a.code, studentId: a.studentId })),
      });
      await this.outbox.enqueue(
        tx,
        newEvent<BrieftestGeneratedV1>({
          type: ENGINE_EVENTS.brieftestGenerated,
          workspaceId: ws,
          payload: { briefTestId: bt.id, lessonId, count: codes.length },
        }),
      );
      return { id: bt.id, status: 'generated' as const, count: codes.length, codes };
    });
  }

  /**
   * Проверка: Tesseract-стаб (0 ИИ; результаты по КОДАМ от вызывающего/OCR) → AssessmentResult+Items
   * → status=checked → assessment.checked(code) → ИОМ. score нормализован 0..1.
   */
  async check(briefTestId: string, results: { studentCode: string; score: number }[]) {
    const ws = TenantContext.require();
    const bt = await this.prisma.briefTest.findUnique({ where: { id: briefTestId } });
    if (!bt) throw new NotFoundException('летучка не найдена');
    if (bt.status === 'checked' || bt.status === 'done') throw new BadRequestException('летучка уже проверена');
    return this.prisma.$transaction(async (tx) => {
      const ar = await tx.assessmentResult.create({ data: { workspaceId: ws, briefTestId, source: 'tesseract' } });
      await tx.assessmentResultItem.createMany({
        data: results.map((r) => ({ workspaceId: ws, assessmentResultId: ar.id, studentCode: r.studentCode, score: r.score })),
      });
      await tx.briefTest.update({ where: { id: briefTestId }, data: { status: 'checked' } });
      await this.outbox.enqueue(
        tx,
        newEvent<AssessmentCheckedV1>({
          type: ENGINE_EVENTS.assessmentChecked,
          workspaceId: ws,
          payload: { briefTestId, lessonId: bt.lessonId, results },
        }),
      );
      return { id: briefTestId, status: 'checked' as const, items: results.length };
    });
  }

  get(briefTestId: string) {
    return this.prisma.briefTest.findUnique({
      where: { id: briefTestId },
      include: { results: { include: { items: true } } },
    });
  }
}
