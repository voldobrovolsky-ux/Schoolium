/**
 * G-46 (AR-103, AR-107) — **дневная сетка и бюджет перебора перечислением.**
 *
 * Доказывается ровно то, что было названо решением:
 *   · «уроков в день» — ОБЯЗАТЕЛЬНЫЙ вход: без него `LOAD_EXCEEDS_GRID` и
 *     `TEACHER_OVERBOOKED` не считаются вовсе, потому что оба про «слоты недели»
 *     = дни × слоты;
 *   · превышение дневного потолка параллели → `DAY_EXCEEDS_SANPIN` ДО перебора;
 *   · длина дня выше 420 минут → `DAY_TOO_LONG`, и текст не ссылается на СанПиН:
 *     потолок продуктовый, а не нормативный;
 *   · штатный день 7×45 с переменами 10 и большой 30 проходит;
 *   · каждый из четырёх временных параметров экрана 4 назван потребителем —
 *     мёртвого ввода на экране нет;
 *   · исчерпание бюджета (20 с либо 200 000 попыток) отвечает честным
 *     `NO_SOLUTION` тем же маршрутом восстановления.
 *
 * Проверка чистая: ни БД, ни сети — генератор доказуем перечислением.
 *
 * Запуск: npm --workspace apps/api run daygrid:check
 */
import { DAY_MINUTES_CAP, DAY_SLOTS_CAP, GENERATOR_BUDGET, classDayCap, schoolDayCap } from '@edustore/shared';
import { arithmeticRefusal, dayLength, generate, type GenInput } from '../src/schoolium/schedule/generator';
import { check, report } from './schoolium/harness';

const cls = (id: string, parallel: number, groupCount = 0) => ({ id, label: `${parallel}`, parallel, groupCount });

const base = (over: Partial<GenInput> = {}): GenInput => ({
  classes: [cls('c5', 5)],
  pairs: [
    { subjectId: 's1', subjectName: 'математика', classId: 'c5', teacherId: 't1', teacherName: 'Мария И.', scope: 'class', groupNos: [], hours: 5, priority: false },
    { subjectId: 's2', subjectName: 'русский', classId: 'c5', teacherId: 't2', teacherName: 'Ольга П.', scope: 'class', groupNos: [], hours: 5, priority: false },
  ],
  params: { days: 5, slotsPerDay: 6, lessonMin: 45, breakMin: 10, bigBreakAfter: 2, bigBreakMin: 30 },
  seed: 1,
  classesWithUnassignedGroups: [],
  uncovered: [],
  ...over,
});

console.log('G-46 · дневная сетка и бюджет перебора (AR-103, AR-107)\n');

// ─── 1. дневной потолок задан по параллелям ───
check(DAY_SLOTS_CAP[1] === 4 && DAY_SLOTS_CAP[5] === 6 && DAY_SLOTS_CAP[11] === 7,
  `дневной потолок по параллелям: 1 кл — ${DAY_SLOTS_CAP[1]}, 5 кл — ${DAY_SLOTS_CAP[5]}, 11 кл — ${DAY_SLOTS_CAP[11]} (СанПиН 1.2.3685-21 табл. 6.6)`);

const over = arithmeticRefusal(base({ params: { days: 5, slotsPerDay: 9, lessonMin: 45, breakMin: 10, bigBreakAfter: 2, bigBreakMin: 30 } }));
check(over?.code === 'DAY_EXCEEDS_SANPIN',
  `9 уроков в 5 классе → ${over?.code} (потолок ${over?.details.cap}) — отказ ДО перебора`);

// ─── 2. длина дня: четыре временных параметра потребляются ───
const sane = { days: 5, slotsPerDay: 7, lessonMin: 45, breakMin: 10, bigBreakAfter: 2, bigBreakMin: 30 };
check(dayLength(sane) === 7 * 45 + 5 * 10 + 30,
  `штатный день: ${dayLength(sane)} мин = 7×45 + перемены 5×10 + большая 30`);
const longDay = arithmeticRefusal(base({ classes: [cls('c11', 11)], params: { ...sane, breakMin: 90 } }));
check(longDay?.code === 'DAY_TOO_LONG',
  `перемена 90 мин → ${longDay?.code} (${longDay?.details.minutes} мин при потолке ${longDay?.details.cap})`);
check(String(longDay?.details.breakdown ?? '').includes('перемены'),
  `текст DAY_TOO_LONG разбирает сумму: «${longDay?.details.breakdown}»`);
check(DAY_MINUTES_CAP === 420, 'потолок длины дня — 420 минут, продуктовый дефолт владельца, а не норма');

for (const p of ['lessonMin', 'breakMin', 'bigBreakAfter', 'bigBreakMin'] as const) {
  const a = dayLength(sane);
  const b = dayLength({ ...sane, [p]: sane[p] + 5 });
  check(a !== b, `параметр ${p} влияет на длину дня (${a} → ${b}) — мёртвого ввода нет`);
}
check(arithmeticRefusal(base({ classes: [cls('c11', 11)], params: sane })) === null,
  'штатный день 7×45, перемены 10, большая 30 в 11 классе проходит без отказа');

// ─── 3. «уроков в день» — второй множитель слотов недели ───
const gridRefusal = arithmeticRefusal(
  base({
    pairs: [
      { subjectId: 's1', subjectName: 'математика', classId: 'c5', teacherId: 't1', teacherName: 'Мария И.', scope: 'class', groupNos: [], hours: 14, priority: false },
      { subjectId: 's2', subjectName: 'русский', classId: 'c5', teacherId: 't2', teacherName: 'Ольга П.', scope: 'class', groupNos: [], hours: 14, priority: false },
    ],
    params: { days: 5, slotsPerDay: 5, lessonMin: 45, breakMin: 10, bigBreakAfter: 2, bigBreakMin: 30 },
  }),
);
check(gridRefusal?.code === 'LOAD_EXCEEDS_GRID',
  `28 часов при 5×5 = 25 слотах → ${gridRefusal?.code} (${gridRefusal?.details.total} ч при ${gridRefusal?.details.grid} слотах)`);

const sameLoadBiggerGrid = arithmeticRefusal(
  base({
    pairs: [
      { subjectId: 's1', subjectName: 'математика', classId: 'c5', teacherId: 't1', teacherName: 'Мария И.', scope: 'class', groupNos: [], hours: 14, priority: false },
      { subjectId: 's2', subjectName: 'русский', classId: 'c5', teacherId: 't2', teacherName: 'Ольга П.', scope: 'class', groupNos: [], hours: 14, priority: false },
    ],
    params: { days: 6, slotsPerDay: 6, lessonMin: 45, breakMin: 10, bigBreakAfter: 2, bigBreakMin: 30 },
  }),
);
check(sameLoadBiggerGrid?.code !== 'LOAD_EXCEEDS_GRID',
  'та же нагрузка при большем числе уроков в день проходит: отказ считается ОТ слотов, а не от догадки');

const overbooked = arithmeticRefusal(
  base({
    classes: [cls('c5', 5), cls('c6', 6)],
    pairs: [
      { subjectId: 's1', subjectName: 'математика', classId: 'c5', teacherId: 't1', teacherName: 'Мария И.', scope: 'class', groupNos: [], hours: 20, priority: false },
      { subjectId: 's2', subjectName: 'математика', classId: 'c6', teacherId: 't1', teacherName: 'Мария И.', scope: 'class', groupNos: [], hours: 20, priority: false },
    ],
    params: { days: 5, slotsPerDay: 6, lessonMin: 45, breakMin: 10, bigBreakAfter: 2, bigBreakMin: 30 },
  }),
);
check(overbooked?.code === 'TEACHER_OVERBOOKED',
  `один педагог на 40 часов при 30 слотах → ${overbooked?.code} (${overbooked?.details.hours} ч при ${overbooked?.details.grid}) — арифметикой, без перебора`);

// ─── 3а. поклассный потолок: школа с первым и восьмым классом собирается (AR-114) ───
const mixedSchool = base({
  classes: [cls('c1', 1), cls('c8', 8)],
  pairs: [
    { subjectId: 'a', subjectName: 'математика', classId: 'c1', teacherId: 't1', teacherName: 'Мария И.', scope: 'class', groupNos: [], hours: 18, priority: false },
    { subjectId: 'b', subjectName: 'математика', classId: 'c8', teacherId: 't2', teacherName: 'Ольга П.', scope: 'class', groupNos: [], hours: 33, priority: false },
  ],
  params: { days: 5, slotsPerDay: 7, lessonMin: 45, breakMin: 10, bigBreakAfter: 2, bigBreakMin: 30 },
});
check(schoolDayCap([1, 2, 5, 8]) === 7,
  `потолок школы — потолок самой старшей параллели: ${schoolDayCap([1, 2, 5, 8])} (AR-114)`);
check(classDayCap(1, 7) === 4 && classDayCap(8, 7) === 7,
  `день класса — min(число, потолок параллели): 1 класс — ${classDayCap(1, 7)}, 8 класс — ${classDayCap(8, 7)}`);
check(arithmeticRefusal(mixedSchool) === null,
  '7 уроков в день в школе с первым и восьмым классом проходят: первоклассник получит 4, восьмиклассник 7');
const senior = generate(mixedSchool);
if (senior.ok) {
  const perDay = new Map<string, number>();
  for (const sl of senior.slots) {
    const k = `${sl.classId}:${sl.dayNo}`;
    perDay.set(k, Math.max(perDay.get(k) ?? 0, sl.slotNo));
  }
  const c1Max = Math.max(...[...perDay].filter(([k]) => k.startsWith('c1:')).map(([, v]) => v));
  const c8Max = Math.max(...[...perDay].filter(([k]) => k.startsWith('c8:')).map(([, v]) => v));
  check(c1Max <= 4, `в собранной сетке день первого класса не длиннее ${c1Max} уроков (потолок 4)`);
  check(c8Max <= 7 && c8Max > 4, `день восьмого класса — ${c8Max} уроков: он не ограничен потолком первоклассника`);
} else {
  check(false, `сетка смешанной школы не собрана: ${senior.code}`);
}
const tooManyForSchool = arithmeticRefusal(base({
  classes: [cls('c1', 1), cls('c8', 8)],
  params: { days: 5, slotsPerDay: 8, lessonMin: 45, breakMin: 10, bigBreakAfter: 2, bigBreakMin: 30 },
  pairs: [],
}));
check(tooManyForSchool?.code === 'DAY_EXCEEDS_SANPIN',
  `8 уроков в день выше потолка старшей параллели (${tooManyForSchool?.details.cap}) → ${tooManyForSchool?.code}`);

// ─── 4. бюджет перебора назван числом и исчерпывается честным NO_SOLUTION ───
check(GENERATOR_BUDGET.seconds === 20 && GENERATOR_BUDGET.attempts === 200_000,
  `бюджет перебора назван числом: ${GENERATOR_BUDGET.seconds} с либо ${GENERATOR_BUDGET.attempts} попыток (AR-107)`);

// Заведомо несобираемая сетка: суммы выполнимы, но два педагога делят все слоты
const impossible = base({
  classes: [cls('a', 5), cls('b', 5)],
  pairs: [
    { subjectId: 'x', subjectName: 'математика', classId: 'a', teacherId: 't', teacherName: 'Один', scope: 'class', groupNos: [], hours: 15, priority: false },
    { subjectId: 'y', subjectName: 'русский', classId: 'b', teacherId: 't', teacherName: 'Один', scope: 'class', groupNos: [], hours: 15, priority: false },
  ],
  params: { days: 5, slotsPerDay: 6, lessonMin: 45, breakMin: 10, bigBreakAfter: 2, bigBreakMin: 30 },
});
const exhausted = generate({ ...impossible, budget: { seconds: 2, attempts: 5000 } });
check(!exhausted.ok && exhausted.code === 'NO_SOLUTION',
  `исчерпание бюджета отвечает ${(exhausted as { code?: string }).code} — отдельного кода нет намеренно`);
check(!exhausted.ok && exhausted.attempts > 0 && exhausted.durationMs >= 0,
  `зерно и длительность измеряются: попыток ${(exhausted as { attempts: number }).attempts}, ${(exhausted as { durationMs: number }).durationMs} мс — жалоба воспроизводится через GEN_SEED`);

// ─── 5. детерминизм при фиксированном зерне ───
const solvable = base({
  classes: [cls('c5', 5), cls('c6', 6)],
  pairs: [
    { subjectId: 'm5', subjectName: 'математика', classId: 'c5', teacherId: 't1', teacherName: 'Мария', scope: 'class', groupNos: [], hours: 5, priority: true },
    { subjectId: 'r5', subjectName: 'русский', classId: 'c5', teacherId: 't2', teacherName: 'Ольга', scope: 'class', groupNos: [], hours: 5, priority: false },
    { subjectId: 'm6', subjectName: 'математика', classId: 'c6', teacherId: 't3', teacherName: 'Иван', scope: 'class', groupNos: [], hours: 5, priority: true },
    { subjectId: 'r6', subjectName: 'русский', classId: 'c6', teacherId: 't4', teacherName: 'Пётр', scope: 'class', groupNos: [], hours: 5, priority: false },
  ],
});
const g1 = generate({ ...solvable, seed: 42 });
const g2 = generate({ ...solvable, seed: 42 });
check(g1.ok && g2.ok && JSON.stringify(g1.slots) === JSON.stringify(g2.slots),
  'генерация детерминирована при фиксированном зерне — одно зерно, одна сетка');
const g3 = generate({ ...solvable, seed: 43 });
check(g3.ok, 'другое зерно тоже даёт сетку — «регенерировать» меняет зерно, а не правила');

report('G-46 · ДНЕВНАЯ СЕТКА И БЮДЖЕТ ПЕРЕБОРА ДОКАЗАНЫ');
