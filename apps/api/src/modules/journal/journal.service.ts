import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  GradeValue,
  JournalColumn,
  JournalData,
  JournalRow,
} from '@edustore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { formatDay, rowAverage, ruWeekday } from '../../common/grade.util';
import { JournalService as EngineJournalService } from '../engine/journal.service';
import { SetGradeDto, UpdateGradeDto } from './dto/set-grade.dto';

/**
 * Домен «журнал» (поверхность кабинета учителя): сетка оценок класса×предмета, сводка.
 * AR-4: источник истины — JournalCell; ЗАПИСЬ делегируется движковому JournalService
 * (единственный писатель, событие journal.grade.posted.v1 / .removed.v1). Здесь — только
 * чтение и сборка сетки.
 */
@Injectable()
export class JournalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: EngineJournalService,
  ) {}

  /** Полная сетка журнала: колонки-уроки, строки-ученики, сводка. */
  async getJournal(classId: string, subjectId?: string): Promise<JournalData> {
    const klass = await this.prisma.class.findUnique({
      where: { id: classId },
    });
    if (!klass) {
      throw new NotFoundException(`Класс ${classId} не найден`);
    }

    // Если предмет не задан — берём первый предмет, по которому есть уроки.
    const effectiveSubjectId =
      subjectId ?? (await this.firstSubjectId(classId));

    const subject = effectiveSubjectId
      ? await this.prisma.subject.findUnique({ where: { id: effectiveSubjectId } })
      : null;

    const lessons = await this.prisma.lesson.findMany({
      where: {
        classId,
        ...(effectiveSubjectId ? { subjectId: effectiveSubjectId } : {}),
      },
      orderBy: { date: 'asc' },
    });

    const students = await this.prisma.student.findMany({
      where: { classId },
      orderBy: { number: 'asc' },
    });

    const lessonIds = lessons.map((l) => l.id);
    const cells = lessonIds.length
      ? await this.prisma.journalCell.findMany({
          where: { lessonId: { in: lessonIds } },
        })
      : [];

    // Быстрый доступ: studentId → lessonId → значение ячейки.
    const byStudent = new Map<string, Map<string, string>>();
    for (const c of cells) {
      let row = byStudent.get(c.studentId);
      if (!row) {
        row = new Map();
        byStudent.set(c.studentId, row);
      }
      row.set(c.lessonId, c.grade);
    }

    const columns: JournalColumn[] = lessons.map((l) => ({
      lessonId: l.id,
      day: formatDay(l.date),
      wd: ruWeekday(l.date),
    }));

    const rows: JournalRow[] = students.map((s) =>
      this.buildRow(s, lessons.map((l) => l.id), byStudent.get(s.id)),
    );

    // Сводка: средний по выставленным баллам, посещаемость, число учеников.
    const allCells = rows.flatMap((r) => r.grades);
    const summaryAvg = rowAverage(allCells);
    const marked = allCells.filter((c) => c !== '');
    const present = marked.filter((c) => c !== 'н').length;
    const attendance = marked.length
      ? Math.round((present / marked.length) * 100)
      : 0;

    return {
      classLabel: klass.label,
      subject: subject?.name ?? '',
      columns,
      rows,
      summary: { avg: summaryAvg, attendance, count: students.length },
    };
  }

  /** Выставление/правка/снятие оценки в ячейке — через единственного писателя (AR-4). */
  async setGrade(dto: SetGradeDto, teacherId: string): Promise<JournalRow> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: dto.lessonId },
      select: { classId: true, subjectId: true },
    });
    if (!lesson) {
      throw new NotFoundException(`Урок ${dto.lessonId} не найден`);
    }

    if (dto.value === '') {
      // Пустое значение — снятие оценки (journal.grade.removed.v1)
      await this.writer.removeGrade(dto.studentId, dto.lessonId, teacherId);
    } else {
      await this.writer.postGrade(
        {
          lessonId: dto.lessonId,
          studentId: dto.studentId,
          grade: dto.value,
          comment: dto.comment,
          source: dto.source === 'VOICE' ? 'VOICE' : 'MANUAL',
        },
        teacherId,
      );
    }

    return this.studentRow(dto.studentId, lesson.classId, lesson.subjectId);
  }

  /** Правка существующей ячейки по её id (легаси-роут PUT /journal/grade/:id). */
  async updateGrade(cellId: string, dto: UpdateGradeDto, teacherId: string): Promise<JournalRow> {
    const cell = await this.prisma.journalCell.findUnique({ where: { id: cellId } });
    if (!cell) {
      throw new NotFoundException(`Оценка ${cellId} не найдена`);
    }
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: cell.lessonId },
      select: { classId: true, subjectId: true },
    });
    if (!lesson) {
      throw new NotFoundException(`Урок ${cell.lessonId} не найден`);
    }

    if (dto.value === '') {
      await this.writer.removeGrade(cell.studentId, cell.lessonId, teacherId);
    } else {
      await this.writer.postGrade(
        {
          lessonId: cell.lessonId,
          studentId: cell.studentId,
          grade: dto.value,
          comment: dto.comment,
          source: dto.source === 'VOICE' ? 'VOICE' : 'MANUAL',
        },
        teacherId,
      );
    }

    return this.studentRow(cell.studentId, lesson.classId, lesson.subjectId);
  }

  /** Строит JournalRow ученика для заданного набора уроков (по порядку). */
  private buildRow(
    student: { id: string; number: number; displayName: string },
    lessonIds: string[],
    studentCells?: Map<string, string>,
  ): JournalRow {
    const grades: GradeValue[] = lessonIds.map(
      (lessonId) => (studentCells?.get(lessonId) ?? '') as GradeValue,
    );
    return {
      studentId: student.id,
      number: student.number,
      name: student.displayName,
      grades,
      avg: rowAverage(grades),
    };
  }

  /** Перестраивает строку одного ученика по уроку класса×предмета. */
  private async studentRow(
    studentId: string,
    classId: string,
    subjectId: string,
  ): Promise<JournalRow> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
    });
    if (!student) {
      throw new NotFoundException(`Ученик ${studentId} не найден`);
    }

    const lessons = await this.prisma.lesson.findMany({
      where: { classId, subjectId },
      orderBy: { date: 'asc' },
      select: { id: true },
    });
    const lessonIds = lessons.map((l) => l.id);

    const cells = lessonIds.length
      ? await this.prisma.journalCell.findMany({
          where: { studentId, lessonId: { in: lessonIds } },
        })
      : [];
    const byLesson = new Map(cells.map((c) => [c.lessonId, c.grade]));

    return this.buildRow(student, lessonIds, byLesson);
  }

  /** Первый предмет, по которому у класса есть уроки (для журнала без subjectId). */
  private async firstSubjectId(classId: string): Promise<string | undefined> {
    const lesson = await this.prisma.lesson.findFirst({
      where: { classId },
      orderBy: { date: 'asc' },
      select: { subjectId: true },
    });
    return lesson?.subjectId;
  }
}
