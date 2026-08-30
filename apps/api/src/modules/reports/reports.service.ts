import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export type ReportPeriod = 'week' | 'month' | 'quarter';

/** Агрегированный отчёт (заглушка). */
export interface TeacherReport {
  period: ReportPeriod;
  performance: number; // % качества (4-5)
  attendance: number; // % посещаемости
  programProgress: number; // % прохождения программы
  activity: number; // условный индекс активности
}

/**
 * Домен «отчёты» (скелет): агрегированная заглушка.
 * Считаем простую агрегацию по оценкам, чтобы цифры были осмысленными.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async teacherReport(
    teacherId: string,
    period: ReportPeriod,
    classId?: string,
    subjectId?: string,
  ): Promise<TeacherReport> {
    // Классы/предметы учителя — для возможной фильтрации агрегации.
    const assignments = await this.prisma.teachingAssignment.findMany({
      where: { teacherId },
      select: { classId: true, subjectId: true },
    });

    const classIds = classId
      ? [classId]
      : [...new Set(assignments.map((a) => a.classId))];

    // AR-4: единый журнал — отчёты считаются по JournalCell
    const grades = classIds.length
      ? await this.prisma.journalCell.findMany({
          where: {
            classId: { in: classIds },
            ...(subjectId ? { disciplineId: subjectId } : {}),
          },
          select: { grade: true },
        })
      : [];

    const graded = grades.filter((g) => g.grade !== 'н');
    const present = graded.length;
    const good = graded.filter((g) => g.grade === '4' || g.grade === '5').length;

    const performance = graded.length
      ? Math.round((good / graded.length) * 100)
      : 0;
    const attendance = grades.length
      ? Math.round((present / grades.length) * 100)
      : 0;

    return {
      period,
      performance,
      attendance,
      programProgress: 64, // заглушка прохождения программы
      activity: graded.length, // заглушка активности — число выставленных оценок
    };
  }
}
