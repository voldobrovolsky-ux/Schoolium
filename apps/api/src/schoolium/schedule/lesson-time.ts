import type { PrismaService } from '../../common/prisma/prisma.service';
import { SchoolError } from '../schoolium.errors';
import { schoolNowMinutes, schoolTodayIso } from '../calendar/school-day';

/**
 * Время начала датированного урока — ОДНО правило для гейта журнала (AR-172,
 * «урок ещё не прошёл») и для гейта отмены (AR-207, «урок уже начался»): дата
 * в календаре школы и минута начала позиции скелета в поясе школы. Без скелета
 * минута берётся из сетки подтверждённого шаблона (тот же `slotTimes`, что
 * рисует времена на экране) — иначе педагог школы без скелета не смог бы
 * отменить сегодняшний вечерний урок утром.
 */

export const isoDayOf = (d: Date): string => d.toISOString().slice(0, 10);
/** Номер дня недели 0..6 (ПН = 0) — так его считают скелет и шаблон. */
export const dayNoOf = (d: Date): number => (d.getUTCDay() + 6) % 7;
export const fmtHM = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
/** «14.09» — дата в тексте отказа `LESSON_ALREADY_HELD` (§9). */
export const fmtDM = (d: Date): string => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** «Фамилия И.» — так заместителя называют дневник и строка `S-40.cell.substituted` (AR-207). */
export function shortName(u: { lastName?: string | null; firstName?: string | null; displayName?: string | null }): string {
  const last = (u.lastName ?? '').trim();
  const first = (u.firstName ?? '').trim();
  if (last && first) return `${last} ${first[0].toUpperCase()}.`;
  return (u.displayName ?? last ?? '—').trim() || '—';
}

/**
 * Минута начала урока в дне по позиции скелета (`kind='lesson'`, `lessonNo = slotNo`),
 * иначе — по сетке подтверждённого шаблона; `null` — школа без скелета и без
 * подтверждённого шаблона (у материализованного урока такого не бывает).
 */
export async function lessonStartMinutes(
  prisma: PrismaService,
  workspaceId: string,
  date: Date,
  slotNo: number,
): Promise<number | null> {
  const pos = await prisma.skeletonPosition.findFirst({
    where: { workspaceId, kind: 'lesson', dayNo: dayNoOf(date), lessonNo: slotNo },
    select: { startMin: true },
  });
  if (pos) return pos.startMin;
  const tpl = await prisma.scheduleTemplate.findFirst({
    where: { workspaceId, status: { in: ['confirmed', 'stale'] } },
    orderBy: { confirmedAt: 'desc' },
    select: { dayStartMin: true, lessonMin: true, breakMin: true, bigBreakAfter: true, bigBreakMin: true },
  });
  if (!tpl) return null;
  let start = tpl.dayStartMin;
  for (let i = 1; i < slotNo; i += 1) start += tpl.lessonMin + (i === tpl.bigBreakAfter ? tpl.bigBreakMin : tpl.breakMin);
  return start;
}

/**
 * Гейт отмены (AR-207): урок ещё не начался. Прошедшая дата — начался;
 * сегодняшняя — начался с минуты начала позиции в поясе школы. Обратный к
 * `LESSON_NOT_HELD` журнала, и считается теми же функциями «сегодня/сейчас».
 * Текст отказа несёт дату и время урока (§9): «Урок 14.09 в 09:00 уже начался».
 */
export async function assertLessonNotHeld(
  prisma: PrismaService,
  workspaceId: string,
  lesson: { date: Date; slotNo: number },
): Promise<void> {
  const day = isoDayOf(lesson.date);
  const today = schoolTodayIso();
  const startMin = await lessonStartMinutes(prisma, workspaceId, lesson.date, lesson.slotNo);
  const time = startMin === null ? '—' : fmtHM(startMin);
  if (day < today) throw new SchoolError('LESSON_ALREADY_HELD', { date: fmtDM(lesson.date), time });
  if (day > today) return;
  // Сегодня: время начала неизвестно — урок считается начавшимся (fail-closed,
  // как дневной гейт журнала без скелета принимает отметку с начала дня).
  if (startMin === null) throw new SchoolError('LESSON_ALREADY_HELD', { date: fmtDM(lesson.date), time });
  const st = await prisma.schoolState.findUnique({ where: { workspaceId }, select: { timezone: true } });
  if (schoolNowMinutes(st?.timezone ?? 'Europe/Moscow') >= startMin) {
    throw new SchoolError('LESSON_ALREADY_HELD', { date: fmtDM(lesson.date), time });
  }
}
