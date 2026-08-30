import { Injectable, NotFoundException } from '@nestjs/common';
import type { Lesson } from '@prisma/client';
import type {
  LessonDetail,
  LessonMetrics,
  LessonStation,
} from '@edustore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { toLessonMaterial } from '../../common/materials.util';

/** DTO обновления урока (ДЗ/цели/страницы). */
export interface UpdateLessonInput {
  homework?: string;
  goals?: string[];
  pageStart?: number;
  pageEnd?: number;
}

/** Домен «планирование»: уроки-станции и детали урока. */
@Injectable()
export class PlanningService {
  constructor(private readonly prisma: PrismaService) {}

  /** Ветка метро: уроки класса (опц. конкретного предмета) по дате. */
  async getLessons(classId: string, subjectId?: string): Promise<LessonStation[]> {
    const lessons = await this.prisma.lesson.findMany({
      where: { classId, ...(subjectId ? { subjectId } : {}) },
      orderBy: { date: 'asc' },
    });
    return lessons.map(toStation);
  }

  /** Детали урока: цели, материалы и метрики, вычисленные по оценкам. */
  async getLessonDetail(lessonId: string): Promise<LessonDetail> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        materials: { orderBy: { generatedAt: 'asc' } },
      },
    });
    if (!lesson) {
      throw new NotFoundException(`Урок ${lessonId} не найден`);
    }

    const metrics = await this.computeMetrics(lesson);

    return {
      ...toStation(lesson),
      goals: lesson.goals,
      metrics,
      pageStart: lesson.pageStart ?? undefined,
      pageEnd: lesson.pageEnd ?? undefined,
      homework: lesson.homework ?? undefined,
      materials: lesson.materials.map(toLessonMaterial),
    };
  }

  /** Обновление ДЗ/целей/страниц; возвращает свежие детали. */
  async updateLesson(
    lessonId: string,
    input: UpdateLessonInput,
  ): Promise<LessonDetail> {
    const exists = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException(`Урок ${lessonId} не найден`);
    }

    await this.prisma.lesson.update({
      where: { id: lessonId },
      data: {
        ...(input.homework !== undefined ? { homework: input.homework } : {}),
        ...(input.goals !== undefined ? { goals: input.goals } : {}),
        ...(input.pageStart !== undefined ? { pageStart: input.pageStart } : {}),
        ...(input.pageEnd !== undefined ? { pageEnd: input.pageEnd } : {}),
      },
    });

    return this.getLessonDetail(lessonId);
  }

  /**
   * Метрики урока:
   * - total = число учеников класса;
   * - submitted = число выставленных оценок (балл, не «н»);
   * - attendance = % не-отсутствующих среди записей оценок;
   * - performance = % оценок 4/5 среди выставленных баллов;
   * - progress = % проведённых уроков в этой главе (приближение).
   */
  private async computeMetrics(lesson: Lesson): Promise<LessonMetrics> {
    const total = await this.prisma.student.count({
      where: { classId: lesson.classId },
    });

    // AR-4: единый журнал — метрики считаются по JournalCell ('5'..'2' | 'н')
    const records = await this.prisma.journalCell.findMany({
      where: { lessonId: lesson.id },
      select: { grade: true },
    });
    const graded = records.filter((g) => g.grade !== 'н');
    const submitted = graded.length;
    const present = graded.length; // 'н' = отсутствие; остальные ячейки — присутствовал

    const attendance = records.length
      ? Math.round((present / records.length) * 100)
      : 0;
    const performance = submitted
      ? Math.round(
          (graded.filter((g) => g.grade === '4' || g.grade === '5').length /
            submitted) *
            100,
        )
      : 0;
    const progress = await this.unitProgress(lesson);

    return { progress, attendance, performance, submitted, total };
  }

  /** Доля проведённых уроков главы относительно сегодняшней даты (приближение). */
  private async unitProgress(lesson: Lesson): Promise<number> {
    if (!lesson.unit) return 0;
    const unitLessons = await this.prisma.lesson.findMany({
      where: { classId: lesson.classId, subjectId: lesson.subjectId, unit: lesson.unit },
      select: { date: true },
    });
    if (!unitLessons.length) return 0;
    const now = new Date();
    const done = unitLessons.filter((l) => l.date <= now).length;
    return Math.round((done / unitLessons.length) * 100);
  }
}

/** Prisma Lesson → контрактная станция метро. */
function toStation(lesson: Lesson): LessonStation {
  return {
    id: lesson.id,
    type: lesson.type,
    title: lesson.topic,
    short: lesson.shortTitle,
    unit: lesson.unit ?? undefined,
    lessonNumber: lesson.lessonNumber,
    date: lesson.date.toISOString(),
  };
}
