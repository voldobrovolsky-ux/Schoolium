/**
 * G-75 (AR-171, AR-172) — **скелет дня и минутный гейт журнала.**
 *
 *   · скелет принимает только сходящиеся времена: пересечения, урок без номера,
 *     «перемена внутри пары» при спаренной сетке — именованный отказ
 *     `SKELETON_INVALID` с причиной словами;
 *   · сохранённый скелет читается обратно тем же составом (roundtrip);
 *   · отметка ДО времени начала урока (по поясу школы) отклоняется
 *     `LESSON_NOT_HELD`, ПОСЛЕ — принимается и стирается;
 *   · битое значение отметки — `MARK_VALUE_INVALID`, а не «урок не прошёл»;
 *   · школа без скелета живёт на прежнем дневном гейте [фолбэк AR-172].
 *
 * Время фиксируется `SCHOOL_TODAY`/`SCHOOL_NOW` — тем же правилом, что зерно
 * генератора: поведение проверки не зависит от того, когда её запустили.
 *
 * Запуск: npm --workspace apps/api run skeleton:check
 */
import { skeletonLessonTimes, type SkeletonPositionDto } from '@edustore/shared';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { ScheduleService } from '../src/schoolium/schedule/schedule.service';
import { JournalService } from '../src/schoolium/journal/journal.service';
import { SchoolStateService } from '../src/schoolium/school-state.service';
import { bench, check, inSchool, readySchool, refuses, report } from './schoolium/harness';

/** Скелет одного дня: пары (1+2, 3+4) без перемены внутри, обед и полдник в общей нумерации. */
const dayPositions = (dayNo: number): SkeletonPositionDto[] => [
  { dayNo, posNo: 1, kind: 'lesson', startMin: 540, endMin: 580, lessonNo: 1, pairNo: 1 },
  { dayNo, posNo: 2, kind: 'lesson', startMin: 580, endMin: 620, lessonNo: 2, pairNo: 1 },
  { dayNo, posNo: 3, kind: 'lesson', startMin: 630, endMin: 670, lessonNo: 3, pairNo: 2 },
  { dayNo, posNo: 4, kind: 'lesson', startMin: 670, endMin: 710, lessonNo: 4, pairNo: 2 },
  { dayNo, posNo: 5, kind: 'meal', title: 'Обед/прогулка', startMin: 720, endMin: 770 },
  { dayNo, posNo: 6, kind: 'event', title: 'Полдник', startMin: 960, endMin: 975 },
];

async function main(): Promise<void> {
  const b = await bench();
  const schedule = b.get(ScheduleService);
  const journal = b.get(JournalService);
  const state = b.get(SchoolStateService);
  const prisma = b.get(PrismaService);

  console.log('G-75 · Скелет дня и минутный гейт (AR-171, AR-172)\n');

  const s = await readySchool(b, 'Школа скелета');
  await inSchool(s.workspaceId, async () => {
    const version = async () => (await state.register()).scheduleVersion;

    // ─── отказы валидации: причина словами, не «ошибка» ───
    const broken = dayPositions(0);
    broken[1] = { ...broken[1], startMin: 590 }; // разрыв внутри пары 1
    await refuses(
      () => schedule.setSkeleton({ gridKind: 'paired', positions: broken, version: 0 }, s.moderator),
      'CONCURRENT_EDIT',
      'устаревшая версия агрегата отклонена до содержательной проверки (AR-109)',
    );
    await refuses(
      async () => schedule.setSkeleton({ gridKind: 'paired', positions: broken, version: await version() }, s.moderator),
      'SKELETON_INVALID',
      'перемена внутри пары при спаренной сетке — отказ называет день и пару (AR-171)',
    );
    const overlap = dayPositions(0);
    overlap[2] = { ...overlap[2], startMin: 600 }; // налезает на вторую позицию
    await refuses(
      async () => schedule.setSkeleton({ gridKind: 'paired', positions: overlap, version: await version() }, s.moderator),
      'SKELETON_INVALID',
      'пересечение позиций по времени отклонено',
    );
    const noNo = dayPositions(0).map((p) => (p.posNo === 1 ? { ...p, lessonNo: null } : p));
    await refuses(
      async () => schedule.setSkeleton({ gridKind: 'paired', positions: noNo, version: await version() }, s.moderator),
      'SKELETON_INVALID',
      'урок без номера урока отклонён',
    );

    // ─── принятие и roundtrip ───
    const all = [0, 1, 2, 3, 4, 5].flatMap(dayPositions);
    await schedule.setSkeleton({ gridKind: 'paired', positions: all, version: await version() }, s.moderator);
    const got = await schedule.skeleton();
    check(got.gridKind === 'paired', 'маркер сетки сохранён: спаренная (дефолт владельца, AR-171)');
    check(got.positions.length === all.length, `скелет читается обратно: ${got.positions.length} позиций`);
    const t = skeletonLessonTimes(got.positions, 0, 3);
    check(t !== null && t.start === '10:30' && t.end === '11:10',
      `время урока 3 по скелету: ${t?.start}—${t?.end} (после перемены 10 минут)`);
    const meal = got.positions.find((p) => p.kind === 'meal');
    check(meal?.title === 'Обед/прогулка', 'обед стоит в общей нумерации дня со своим временем');

    // ─── минутный гейт: до начала урока отказ, после — отметка и стирание ───
    const col = await prisma.journalColumn.findFirst({
      where: { workspaceId: s.workspaceId, detachedAt: null },
      orderBy: { date: 'asc' },
    });
    check(col !== null, 'в журнале есть колонка для сценария гейта');
    if (!col) report('G-75 · СКЕЛЕТ ДНЯ И МИНУТНЫЙ ГЕЙТ');
    const iso = col.date.toISOString().slice(0, 10);
    process.env.SCHOOL_TODAY = iso; // колонка становится «сегодняшней»
    const startMin = 540 + [0, 40, 90, 130][col.slotNo - 1];
    const actor = { userId: s.teacher.userId, roles: ['teacher' as const], name: 'Иванова Мария' };

    process.env.SCHOOL_NOW = '07:30';
    await refuses(
      () => journal.postMark(col.lessonId, s.studentIds[0], '5', actor),
      'LESSON_NOT_HELD',
      `в 07:30 урок №${col.slotNo} (начало ${Math.floor(startMin / 60)}:${String(startMin % 60).padStart(2, '0')}) ещё не наступил — отметка отклонена (AR-172)`,
    );
    process.env.SCHOOL_NOW = '13:00';
    await journal.postMark(col.lessonId, s.studentIds[0], '5', actor);
    check(true, 'в 13:00 тот же урок принимает отметку — гейт по минуте, не по дню');
    await refuses(
      () => journal.postMark(col.lessonId, s.studentIds[0], '7' as never, actor),
      'MARK_VALUE_INVALID',
      'значение «7» — именованный отказ шкалы, а не «урок ещё не прошёл» (развод кода, AR-172)',
    );
    await journal.removeMark(col.lessonId, s.studentIds[0], actor);
    check(true, 'стирание отметки после гейта проходит (правило владельца: менять и стирать можно всё)');

    // ─── фолбэк: школа без скелета живёт на дневном гейте ───
    await schedule.setSkeleton({ gridKind: 'paired', positions: [], version: await version() }, s.moderator);
    process.env.SCHOOL_NOW = '00:01';
    await journal.postMark(col.lessonId, s.studentIds[0], '4', actor);
    check(true, 'без скелета отметка в 00:01 сегодняшнего дня принимается — прежний дневной гейт [фолбэк]');
    await journal.removeMark(col.lessonId, s.studentIds[0], actor);
    delete process.env.SCHOOL_TODAY;
    delete process.env.SCHOOL_NOW;
  });

  await b.close();
  report('G-75 · СКЕЛЕТ ДНЯ И МИНУТНЫЙ ГЕЙТ ДОКАЗАНЫ');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
