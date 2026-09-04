/**
 * G-86 (AR-200) — **обед по классам.**
 *
 * На живой школе (реальный Nest-контекст и Postgres, харнесс `readySchool`)
 * доказывается:
 *   · `PUT /schedule/lunch` — roundtrip: обед класса читается обратно в
 *     `GET /skeleton` (`classLunch`) и в предпросмотре; `null` — как у школы;
 *   · обед вне диапазона 1 ≤ N ≤ (урочных позиций − 1) — именованный
 *     `SKELETON_INVALID` с причиной словами («класс 1: обед после 4-го урока, а
 *     уроков в дне 4»); устаревшая версия — `CONCURRENT_EDIT` (AR-109);
 *   · генерация: класс с обедом после 3-го не получает урок в позиции 4, класс
 *     без своего обеда — получает; обед не окно; педагог не в двух местах;
 *     вместимость класса в `LOAD_EXCEEDS_GRID` — позиции минус одна в день;
 *   · смена обеда роняет подтверждённую сетку в `stale` (AR-85);
 *   · дневник ученика отдаёт позицию обеда его класса;
 *   · со скелетом позиция обеда — `lessonNo` скелета, диапазон судится по нему.
 *
 * Запуск: npm --workspace apps/api run lunch:check
 */
import type { SkeletonPositionDto } from '@edustore/shared';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { ScheduleService } from '../src/schoolium/schedule/schedule.service';
import { SubjectsService } from '../src/schoolium/subjects/subjects.service';
import { AccountsService } from '../src/schoolium/access/accounts.service';
import { DiaryService } from '../src/schoolium/diary/diary.service';
import { SchoolStateService } from '../src/schoolium/school-state.service';
import { bench, check, inSchool, makeStaff, readySchool, refuses, report } from './schoolium/harness';

/** Ответ отказа сервиса: код, текст и детали — как их видит клиент (AR-97). */
const refusal = async (fn: () => Promise<unknown>): Promise<{ code?: string; message?: string; details?: Record<string, unknown> }> => {
  try {
    await fn();
    return {};
  } catch (e) {
    return (e as { response?: { code?: string; message?: string; details?: Record<string, unknown> } }).response ?? {};
  }
};

/** Скелет одного дня: четыре одиночных урока (варьируемая сетка) и общий обед школы после них. */
const dayPositions = (dayNo: number): SkeletonPositionDto[] => [
  { dayNo, posNo: 1, kind: 'lesson', startMin: 540, endMin: 585, lessonNo: 1 },
  { dayNo, posNo: 2, kind: 'lesson', startMin: 595, endMin: 640, lessonNo: 2 },
  { dayNo, posNo: 3, kind: 'lesson', startMin: 650, endMin: 695, lessonNo: 3 },
  { dayNo, posNo: 4, kind: 'lesson', startMin: 705, endMin: 750, lessonNo: 4 },
  { dayNo, posNo: 5, kind: 'meal', title: 'Обед', startMin: 750, endMin: 790 },
];

async function main(): Promise<void> {
  const b = await bench();
  const schedule = b.get(ScheduleService);
  const subjects = b.get(SubjectsService);
  const accounts = b.get(AccountsService);
  const diary = b.get(DiaryService);
  const state = b.get(SchoolStateService);
  const prisma = b.get(PrismaService);
  const drain = () => TenantContext.runAsSystem(() => b.outbox.drain());

  console.log('G-86 · Обед по классам (AR-200)\n');

  // Школа с двумя классами: «1» получит обед после 3-го, «2» останется «как у
  // школы». Параметры дня харнесса — 4 урока в день, 5 дней, без скелета.
  const s = await readySchool(b, 'Школа обеда', { parallels: 2 });
  const rus = await makeStaff(b, s, ['teacher'], 'Петрова Ольга');
  const math2 = await makeStaff(b, s, ['teacher'], 'Сидоров Иван');

  await inSchool(s.workspaceId, async () => {
    const version = async () => (await state.register()).scheduleVersion;
    const templateStatus = async () =>
      (await prisma.scheduleTemplate.findFirst({ where: { workspaceId: s.workspaceId }, orderBy: { generatedAt: 'desc' } }))?.status;
    const [c1, c2] = s.classIds;
    const lunchOf = async (classId: string) =>
      (await schedule.skeleton()).classLunch.find((e) => e.classId === classId)?.lunchAfterLessonNo;
    const setLunch = async (classId: string, n: number | null) =>
      schedule.setLunch({ version: await version(), entries: [{ classId, lunchAfterLessonNo: n }] }, s.moderator);
    const bind = async (subjectId: string, teacherId: string) => {
      const tok = await subjects.createBindToken(subjectId);
      await subjects.scan(tok.token, { userId: teacherId, workspaceId: s.workspaceId, roles: ['teacher'], name: 'педагог' });
      await subjects.bindTeacher(subjectId, { token: tok.token, scope: 'class' }, s.moderator);
    };

    // ─── чтение до правок: у обоих классов обед как у школы ───
    const sk0 = await schedule.skeleton();
    check(sk0.classLunch.length === 2 && sk0.classLunch.every((e) => e.lunchAfterLessonNo === null),
      'скелет отдаёт обед по классам: у обоих классов — как у школы (null)');

    // ─── отказы: версия агрегата и диапазон ───
    await refuses(
      () => schedule.setLunch({ version: 0, entries: [{ classId: c1, lunchAfterLessonNo: 3 }] }, s.moderator),
      'CONCURRENT_EDIT',
      'устаревшая версия агрегата отклонена до содержательной проверки (AR-109)',
    );
    const tooLate = await refusal(() => setLunch(c1, 4));
    check(tooLate.code === 'SKELETON_INVALID' && (tooLate.message ?? '').includes('класс 1: обед после 4-го урока, а уроков в дне 4'),
      `обед после 4-го при 4 уроках в дне — ${tooLate.code}: «${tooLate.message}»`);
    await refuses(() => setLunch(c1, 0), 'SKELETON_INVALID', 'обед после 0-го урока — вне диапазона от 1');
    check((await lunchOf(c1)) === null, 'отклонённые значения не записались');

    // ─── roundtrip и stale ───
    check((await templateStatus()) === 'confirmed', 'до смены обеда сетка школы подтверждена');
    const saved = await setLunch(c1, 3);
    check(saved.classLunch.find((e) => e.classId === c1)?.lunchAfterLessonNo === 3, 'ответ PUT /schedule/lunch несёт обед по классам');
    check((await lunchOf(c1)) === 3 && (await lunchOf(c2)) === null, 'roundtrip: класс 1 — обед после 3-го, класс 2 — как у школы');
    check((await templateStatus()) === 'stale', 'смена обеда роняет подтверждённую сетку в stale (AR-85, AR-200)');

    // ─── нагрузка: класс 1 — 15 ч (3 позиции × 5 дней), класс 2 — 16 ч ───
    const subjRus = await subjects.create({ name: 'Русский язык', classId: c1 });
    await bind(subjRus.id, rus.userId);
    const subjM2 = await subjects.create({ name: 'Математика', classId: c2 });
    await bind(subjM2.id, math2.userId);
    await drain();
    const load = await schedule.load();
    const weekly = (subjectId: string, rusHours: number) =>
      subjectId === s.subjectId ? 8 : subjectId === subjRus.id ? rusHours : 16;
    const entries = (rusHours: number) =>
      load.entries.map((e) => ({ bindingId: e.bindingId, hoursPerYear: weekly(e.subjectId, rusHours) * 34 }));

    // вместимость класса с обедом — позиции минус одна в день: 8 + 8 = 16 > 3 × 5
    const over = await refusal(() => schedule.setLoad({ entries: entries(8), version: load.version }, s.moderator));
    check(over.code === 'LOAD_EXCEEDS_GRID' && over.details?.grid === 15 && String(over.details?.breakdown ?? '').includes('обед'),
      `16 часов в класс с обедом после 3-го → ${over.code}: вместимость ${over.details?.grid} (${over.details?.breakdown})`);
    await schedule.setLoad({ entries: entries(7), version: load.version }, s.moderator);
    check(true, '15 часов в класс с обедом (8 + 7) приняты — ровно 3 позиции × 5 дней');

    // ─── генерация без скелета ───
    process.env.GEN_SEED = '2026';
    const preview = await schedule.generate(s.moderator);
    delete process.env.GEN_SEED;
    check(preview.classLunch?.find((e) => e.classId === c1)?.lunchAfterLessonNo === 3, 'предпросмотр отдаёт обед по классам');
    const c1Slots = preview.slots.filter((x) => x.classId === c1);
    const c2Slots = preview.slots.filter((x) => x.classId === c2);
    check(c1Slots.length === 15 && !c1Slots.some((x) => x.slotNo === 4),
      `класс с обедом после 3-го: ${c1Slots.length} уроков, ни одного в позиции 4`);
    check(c2Slots.length === 16 && c2Slots.some((x) => x.slotNo === 4),
      `класс без своего обеда: ${c2Slots.length} уроков, позиция 4 занята`);
    check([0, 1, 2, 3, 4].every((d) => [1, 2, 3].every((n) => c1Slots.some((x) => x.dayNo === d && x.slotNo === n))),
      'обед — не окно: у класса 1 позиции 1–3 заняты во все пять дней');
    const keys = preview.slots.map((x) => `${x.dayNo}:${x.slotNo}:${x.teacherId}`);
    check(new Set(keys).size === keys.length, 'педагог не стоит в двух местах одного слота');

    // ─── подтверждение → дневник ученика класса 1 ───
    await schedule.confirm({ templateId: preview.templateId, version: await version() }, s.moderator);
    await drain();
    check((await templateStatus()) === 'confirmed', 'сетка с обедом по классам подтверждена');
    const guardian = await accounts.createGuardian({ lastName: 'Абалкина', firstName: 'Вера', middleName: null, studentIds: [s.studentIds[0]] });
    const week = await diary.week(guardian.card.userId!, null, null);
    check(week.lunchAfterLessonNo === 3, `дневник ученика класса 1 отдаёт обед класса: после урока ${week.lunchAfterLessonNo}`);
    const preview2 = await schedule.week();
    check(preview2?.classLunch?.find((e) => e.classId === c2)?.lunchAfterLessonNo === null, 'GET /schedule отдаёт classLunch: класс 2 — как у школы');

    // ─── возврат «как у школы» — тоже смена укладки ───
    await setLunch(c1, null);
    check((await lunchOf(c1)) === null, 'null записывается обратно: обед снова как у школы');
    check((await templateStatus()) === 'stale', 'возврат обеда «как у школы» тоже роняет сетку в stale');

    // ─── со скелетом: диапазон и позиция — по lessonNo скелета ───
    await schedule.setSkeleton({ gridKind: 'variable', positions: [0, 1, 2, 3, 4].flatMap(dayPositions), version: await version() }, s.moderator);
    const tooLateSkel = await refusal(() => setLunch(c1, 4));
    check(tooLateSkel.code === 'SKELETON_INVALID' && (tooLateSkel.message ?? '').includes('уроков в дне 4'),
      `со скелетом из 4 урочных позиций обед после 4-го — ${tooLateSkel.code}: «${tooLateSkel.message}»`);
    await setLunch(c1, 3);
    process.env.GEN_SEED = '2027';
    const p2 = await schedule.generate(s.moderator);
    delete process.env.GEN_SEED;
    const c1Skel = p2.slots.filter((x) => x.classId === c1);
    check(c1Skel.length === 15 && !c1Skel.some((x) => x.slotNo === 4),
      'по скелету: класс с обедом после 3-го не получает урок в позиции 4 (lessonNo скелета)');
    check(p2.slots.filter((x) => x.classId === c2).some((x) => x.slotNo === 4), 'по скелету: класс без своего обеда получает урок 4');
    const keys2 = p2.slots.map((x) => `${x.dayNo}:${x.slotNo}:${x.teacherId}`);
    check(new Set(keys2).size === keys2.length, 'по скелету: педагог не стоит в двух местах одного слота');
    await schedule.cancelGeneration();

    // Форма тела: кривой запрос — именованный отказ 400, а не 500 «внутренняя
    // ошибка» на первом же `for` по не-массиву (регрессия ревью 1.5.0).
    let shape = 'принято';
    await schedule
      .setLunch({ version: await version(), entries: 'весь-день' as unknown as [] }, s.moderator)
      .catch((e: Error) => { shape = e.message; });
    check(shape.includes('entries'), `entries не список — отказ формой, а не 500: «${shape}»`);
    let itemShape = 'принято';
    await schedule
      .setLunch({ version: await version(), entries: ['5А' as unknown as { classId: string; lunchAfterLessonNo: number | null }] }, s.moderator)
      .catch((e: Error) => { itemShape = e.message; });
    check(itemShape.includes('classId'), `запись обеда не объект — отказ формой: «${itemShape}»`);
  });

  await b.close();
  report('G-86 · ОБЕД ПО КЛАССАМ ДОКАЗАН');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
