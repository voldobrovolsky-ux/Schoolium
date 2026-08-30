import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  DiaryChildDto,
  DiaryDayDto,
  DiaryWeekDto,
  MarkValue,
  SubjectAverageDto,
} from '@edustore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { schoolTodayIso } from '../calendar/school-day';
import { SchoolError } from '../schoolium.errors';

const DAY = 24 * 3600 * 1000;
const iso = (d: Date): string => d.toISOString().slice(0, 10);

/** Понедельник недели, в которую попадает день. */
const mondayOf = (isoDay: string): string => {
  const d = new Date(`${isoDay}T00:00:00.000Z`);
  const shift = (d.getUTCDay() + 6) % 7;
  return iso(new Date(d.getTime() - shift * DAY));
};

/**
 * Дневник и успеваемость (AR-158, AR-159) — читающие проекции ученика и
 * родителя. Ни одной мутации; источники — те же таблицы, что у журнала
 * (`JournalColumn`/`Mark`/`LessonTopic`, AR-110), дневник ничего своего не
 * хранит.
 *
 * Доступ — по идентичности, а не по каталогу (AR-151): ученик видит себя
 * (`SchoolStudent.userId`), взрослый — детей по `GuardianLink` своей карточки;
 * штатная роль с детьми получает тот же дневник без роли `parent`.
 */
@Injectable()
export class DiaryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Дети, доступные учётке: сам ученик и/или дети по связям родителя. */
  async childrenOf(userId: string): Promise<DiaryChildDto[]> {
    const ws = TenantContext.require();
    const [self, links] = await Promise.all([
      this.prisma.schoolStudent.findMany({
        where: { userId, deactivatedAt: null },
        include: { class: true },
      }),
      this.prisma.guardianLink.findMany({
        where: { guardian: { userId }, student: { deactivatedAt: null } },
        include: { student: { include: { class: true } } },
      }),
    ]);
    const seen = new Set<string>();
    const out: DiaryChildDto[] = [];
    for (const s of [...self, ...links.map((l) => l.student)]) {
      if (seen.has(s.id) || s.workspaceId !== ws) continue;
      seen.add(s.id);
      out.push({
        studentId: s.id,
        name: [s.lastName, s.firstName].filter(Boolean).join(' '),
        classLabel: s.class.label,
      });
    }
    return out;
  }

  /** Ребёнок принадлежит учётке — иначе 403 без раскрытия существования. */
  private async resolveStudent(userId: string, studentId: string | null) {
    const children = await this.childrenOf(userId);
    const target = studentId ? children.find((c) => c.studentId === studentId) : children[0];
    if (!target) throw new SchoolError('ACCESS_REVOKED');
    const s = await this.prisma.schoolStudent.findUnique({ where: { id: target.studentId }, include: { class: true } });
    if (!s) throw new NotFoundException('ученик не найден');
    return s;
  }

  /** Неделя дневника: дни → уроки ребёнка → предмет, тема, отметка. */
  async week(userId: string, studentId: string | null, monday: string | null): Promise<DiaryWeekDto> {
    const s = await this.resolveStudent(userId, studentId);
    const row = await this.prisma.journalRow.findUnique({ where: { studentId: s.id } });
    const groupNo = row?.groupNo ?? null;

    // недели журнала — для навигации-календаря, как в `S-50`
    const cols = await this.prisma.journalColumn.findMany({
      where: { classId: s.classId, detachedAt: null },
      select: { date: true },
    });
    const weekSet = new Set(cols.map((c) => mondayOf(iso(c.date))));
    const weeks = [...weekSet].sort().map((m) => ({ monday: m, hasLessons: true }));

    const mon = monday ?? mondayOf(schoolTodayIso());
    const from = new Date(`${mon}T00:00:00.000Z`);
    const to = new Date(from.getTime() + 7 * DAY);

    const columns = await this.prisma.journalColumn.findMany({
      where: { classId: s.classId, detachedAt: null, date: { gte: from, lt: to } },
      include: { lessonTopic: true, marks: { where: { studentId: s.id } } },
      orderBy: [{ date: 'asc' }, { slotNo: 'asc' }],
    });
    const subjectIds = [...new Set(columns.map((c) => c.subjectId))];
    const subjects = await this.prisma.schoolSubject.findMany({ where: { id: { in: subjectIds } } });
    const subjectName = new Map(subjects.map((x) => [x.id, x.name]));

    const days = new Map<string, DiaryDayDto>();
    for (const c of columns) {
      // урок группы, в которой ребёнок не состоит, в его дневник не попадает
      if (c.groupNo !== 0 && groupNo !== null && c.groupNo !== groupNo) continue;
      const day = iso(c.date);
      const bucket = days.get(day) ?? { date: day, lessons: [] };
      bucket.lessons.push({
        lessonId: c.lessonId,
        slotNo: c.slotNo,
        subjectName: subjectName.get(c.subjectId) ?? '—',
        topic: c.lessonTopic?.topic ?? null,
        mark: (c.marks[0]?.value as MarkValue | undefined) ?? null,
      });
      days.set(day, bucket);
    }

    // Временная сетка подтверждённого расписания — времена уроков и перемен
    // считаются на клиенте из неё (slotTimes, AR-36), а не хранятся на уроке.
    const tpl = await this.prisma.scheduleTemplate.findFirst({
      where: { workspaceId: s.workspaceId, status: 'confirmed' },
      select: { dayStartMin: true, lessonMin: true, breakMin: true, bigBreakAfter: true, bigBreakMin: true },
    });
    return {
      studentId: s.id,
      studentName: [s.lastName, s.firstName].filter(Boolean).join(' '),
      classLabel: s.class.label,
      monday: mon,
      grid: tpl ?? null,
      days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
      weeks,
    };
  }

  /**
   * Успеваемость (AR-159): средние по каждому предмету за текущую четверть.
   * Правило среднего одно на систему (AR-79, AR-115): числовые 2–5, «н»/«б»
   * не участвуют, числовых нет — null («—», не ноль).
   */
  async averages(userId: string, studentId: string | null): Promise<SubjectAverageDto[]> {
    const s = await this.resolveStudent(userId, studentId);
    const today = schoolTodayIso();
    const term = await this.prisma.term.findFirst({
      where: { dateFrom: { lte: new Date(`${today}T00:00:00.000Z`) }, dateTo: { gte: new Date(`${today}T00:00:00.000Z`) } },
    });

    const marks = await this.prisma.mark.findMany({
      where: {
        studentId: s.id,
        column: term
          ? { classId: s.classId, detachedAt: null, date: { gte: term.dateFrom, lte: term.dateTo } }
          : { classId: s.classId, detachedAt: null },
      },
      include: { column: { select: { subjectId: true } } },
    });

    const subjects = await this.prisma.schoolSubject.findMany({ where: { classId: s.classId } });
    const bySubject = new Map<string, number[]>();
    for (const m of marks) {
      const v = Number(m.value);
      if (!Number.isFinite(v)) continue; // «н» и «б» не участвуют (AR-79)
      const arr = bySubject.get(m.column.subjectId) ?? [];
      arr.push(v);
      bySubject.set(m.column.subjectId, arr);
    }
    return subjects
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      .map((sub) => {
        const vals = bySubject.get(sub.id) ?? [];
        return {
          subjectId: sub.id,
          subjectName: sub.name,
          average: vals.length ? Math.round((vals.reduce((a, v) => a + v, 0) / vals.length) * 100) / 100 : null,
          marks: vals.length,
        };
      });
  }
}
