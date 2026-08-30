/**
 * G-76 — **спаренная укладка по скелету доказана** (AR-171, УТЦ v1.4 фаза III).
 *
 * Правило владельца №7: при спаренной сетке два часа предмета в день лежат
 * ОДНОЙ парой — на обеих половинах одного `pairNo`, смежно, без перемены
 * внутри; одиночные часы остаются одиночными. Слоты недели при скелете —
 * урочные позиции самого скелета (`slotNo` = его `lessonNo`), а не арифметика
 * `slotsPerDay`.
 *
 * Проверяется перечислением на чистой функции `generate()` — ни БД, ни сети:
 *   1. чётные часы ложатся парами: обе половины одного `pairNo`, смежные
 *      `lessonNo`, один предмет;
 *   2. нечётный остаток — одиночный час, пар не рвёт;
 *   3. групповой предмет остаётся атомарным и В ПАРЕ: обе группы в обоих
 *      слотах пары;
 *   4. `variable`-сетка укладывает по-старому (одиночными), но на `lessonNo`
 *      скелета;
 *   5. день без урочных позиций скелета не получает ни одного урока;
 *   6. `LOAD_EXCEEDS_GRID` считает вместимость по скелету, а не по
 *      `slotsPerDay`;
 *   7. школу со скелетом `DAY_TOO_LONG` не судит: длину дня держит сам скелет
 *      (`SKELETON_INVALID` при сохранении).
 *
 * Запуск: npm --workspace apps/api run paired:check
 */
import { generate, type GenInput, type GenSkeleton, type GenSlot } from '../src/schoolium/schedule/generator';

let pass = 0;
let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) { pass += 1; console.log(`✓  ${msg}`); }
  else { fail += 1; console.error(`✗  ${msg}`); }
};

/** Скелет: ПН-ПТ по три пары (уроки 1-2, 3-4, 5-6; обед между 4 и 5 — вне урочных позиций). */
const pairedSkeleton = (days = 5): GenSkeleton => ({
  gridKind: 'paired',
  days: Array.from({ length: days }, (_, dayNo) => ({
    dayNo,
    lessons: [
      { lessonNo: 1, pairNo: 1 }, { lessonNo: 2, pairNo: 1 },
      { lessonNo: 3, pairNo: 2 }, { lessonNo: 4, pairNo: 2 },
      { lessonNo: 5, pairNo: 3 }, { lessonNo: 6, pairNo: 3 },
    ],
  })),
});

const baseInput = (over: Partial<GenInput>): GenInput => ({
  classes: [{ id: 'c5', label: '5', parallel: 5, groupCount: 0 }],
  pairs: [],
  params: { days: 5, slotsPerDay: 6, lessonMin: 40, breakMin: 10, bigBreakAfter: 2, bigBreakMin: 20 },
  seed: 7,
  classesWithUnassignedGroups: [],
  uncovered: [],
  skeleton: pairedSkeleton(),
  ...over,
});

const pairOf = (skeleton: GenSkeleton, dayNo: number, lessonNo: number): number | null =>
  skeleton.days.find((d) => d.dayNo === dayNo)?.lessons.find((l) => l.lessonNo === lessonNo)?.pairNo ?? null;

/** Уроки предмета в дне, отсортированные по номеру слота. */
const daySlots = (slots: GenSlot[], subjectId: string, dayNo: number): GenSlot[] =>
  slots.filter((s) => s.subjectId === subjectId && s.dayNo === dayNo).sort((a, b) => a.slotNo - b.slotNo);

console.log('\nG-76 · спаренная укладка по скелету (AR-171)\n');

// ---------- 1-2. чётные часы — парами, нечётный остаток — одиночный ----------
{
  const input = baseInput({
    pairs: [
      { subjectId: 'math', subjectName: 'Математика', classId: 'c5', teacherId: 't1', teacherName: 'Иванова', scope: 'class', groupNos: [], hours: 4, priority: false },
      { subjectId: 'rus', subjectName: 'Русский', classId: 'c5', teacherId: 't2', teacherName: 'Петрова', scope: 'class', groupNos: [], hours: 3, priority: false },
    ],
  });
  const res = generate(input);
  ok(res.ok, 'сетка с парами собралась');
  if (res.ok) {
    ok(res.slots.length === 7, `часов уложено ровно 7 (4+3) — уложено ${res.slots.length}`);
    const sk = input.skeleton!;
    // каждый чётный час лежит в выровненной паре: жадно матчим смежные слоты
    // одного pairNo; всё, что не сматчилось, — одиночные часы
    const unmatched = new Map<string, number>();
    for (const sid of ['math', 'rus']) {
      let n = 0;
      for (let d = 0; d < 5; d += 1) {
        const day = daySlots(res.slots, sid, d);
        for (let i = 0; i < day.length; ) {
          const a = day[i];
          const b = day[i + 1];
          const pa = pairOf(sk, d, a.slotNo);
          if (b && b.slotNo === a.slotNo + 1 && pa !== null && pa === pairOf(sk, d, b.slotNo)) i += 2;
          else { n += 1; i += 1; }
        }
      }
      unmatched.set(sid, n);
    }
    ok(unmatched.get('math') === 0, `4 часа математики — две пары, вне пар 0 часов (${unmatched.get('math')})`);
    ok(unmatched.get('rus') === 1, `3 часа русского — пара + один одиночный (вне пар ${unmatched.get('rus')})`);
  }
}

// ---------- 3. групповой предмет атомарен и в паре ----------
{
  const input = baseInput({
    classes: [{ id: 'c7', label: '7', parallel: 7, groupCount: 2 }],
    pairs: [
      { subjectId: 'eng', subjectName: 'Английский', classId: 'c7', teacherId: 't1', teacherName: 'Иванова', scope: 'group', groupNos: [1], hours: 2, priority: false },
      { subjectId: 'eng', subjectName: 'Английский', classId: 'c7', teacherId: 't2', teacherName: 'Петрова', scope: 'group', groupNos: [2], hours: 2, priority: false },
    ],
  });
  const res = generate(input);
  ok(res.ok, 'групповая пара собралась');
  if (res.ok) {
    ok(res.slots.length === 4, `слотов 4: обе группы в обоих слотах пары (${res.slots.length})`);
    const nos = [...new Set(res.slots.map((s) => `${s.dayNo}:${s.slotNo}`))].sort();
    ok(nos.length === 2, 'пара занимает ровно два слота одного дня');
    const perSlot = nos.map((k) => res.slots.filter((s) => `${s.dayNo}:${s.slotNo}` === k).length);
    ok(perSlot.every((n) => n === 2), 'в каждом слоте пары — обе группы разом (AR-75 не ослаблен)');
  }
}

// ---------- 4. variable-сетка: одиночная укладка на lessonNo скелета ----------
{
  const skeleton: GenSkeleton = { ...pairedSkeleton(), gridKind: 'variable' };
  const input = baseInput({
    skeleton,
    pairs: [
      { subjectId: 'math', subjectName: 'Математика', classId: 'c5', teacherId: 't1', teacherName: 'Иванова', scope: 'class', groupNos: [], hours: 4, priority: false },
    ],
  });
  const res = generate(input);
  ok(res.ok, 'variable-сетка собралась');
  if (res.ok) {
    ok(res.slots.every((s) => [1, 2, 3, 4, 5, 6].includes(s.slotNo)), 'слоты — номера уроков скелета');
    const perDay = new Map<number, number>();
    for (const s of res.slots) perDay.set(s.dayNo, (perDay.get(s.dayNo) ?? 0) + 1);
    ok([...perDay.values()].every((n) => n <= 6), 'дневной потолок держится по скелету');
  }
}

// ---------- 5. день без урочных позиций пуст ----------
{
  const skeleton: GenSkeleton = { gridKind: 'paired', days: pairedSkeleton(2).days }; // только ПН-ВТ
  const input = baseInput({
    skeleton,
    pairs: [
      { subjectId: 'math', subjectName: 'Математика', classId: 'c5', teacherId: 't1', teacherName: 'Иванова', scope: 'class', groupNos: [], hours: 6, priority: false },
    ],
  });
  const res = generate(input);
  ok(res.ok, 'сетка на двух скелетных днях собралась');
  if (res.ok) ok(res.slots.every((s) => s.dayNo <= 1), 'дни без позиций скелета (СР-ПТ) не получили ни одного урока');
}

// ---------- 6. вместимость недели считается по скелету ----------
{
  const skeleton: GenSkeleton = { gridKind: 'paired', days: pairedSkeleton(1).days }; // один день, 6 позиций
  const input = baseInput({
    skeleton,
    pairs: [
      { subjectId: 'math', subjectName: 'Математика', classId: 'c5', teacherId: 't1', teacherName: 'Иванова', scope: 'class', groupNos: [], hours: 8, priority: false },
    ],
  });
  const res = generate(input);
  ok(!res.ok && res.code === 'LOAD_EXCEEDS_GRID', `8 часов в 6 позиций — LOAD_EXCEEDS_GRID (${res.ok ? 'ok' : res.code})`);
}

// ---------- 7. DAY_TOO_LONG школу со скелетом не судит ----------
{
  const long = baseInput({
    // арифметика параметров дала бы день длиннее потолка — но день держит скелет
    params: { days: 5, slotsPerDay: 6, lessonMin: 45, breakMin: 30, bigBreakAfter: 2, bigBreakMin: 30 },
    pairs: [
      { subjectId: 'math', subjectName: 'Математика', classId: 'c5', teacherId: 't1', teacherName: 'Иванова', scope: 'class', groupNos: [], hours: 2, priority: false },
    ],
  });
  const res = generate(long);
  ok(res.ok, 'школа со скелетом не получает DAY_TOO_LONG от чужой арифметики');
}

console.log(`\n${fail === 0 ? '✓' : '✗'} G-76 · СПАРЕННАЯ УКЛАДКА ${fail === 0 ? 'ДОКАЗАНА' : 'НАРУШЕНА'} — pass=${pass} fail=${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
