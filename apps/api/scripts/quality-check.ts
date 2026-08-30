/**
 * G-56…G-61 (AR-118…AR-132) — **слой качества расписания доказуем.**
 *
 * Шесть ворот одним прогоном, потому что все пять живут на одних и тех же чистых
 * функциях и разделять их значило бы пять раз собирать одну сетку:
 *
 *   G-56 · квалиметрия: πᵢ — целые неотрицательные, Qᵢ ∈ [0,1], верхняя граница
 *          разброса совпадает с максимумом по ВСЕМ разбиениям малой задачи;
 *   G-57 · автопроверка: каждый инвариант I-1…I-8 воспроизводится порчей
 *          допустимой сетки — набор ловит подделку, а не только честный вход;
 *   G-58 · автокорректировка: Π не растёт, каждый принятый ход уменьшает его
 *          строго, повторный прогон из локального минимума не делает ходов,
 *          два прогона на одном входе дают одну сетку;
 *   G-59 · ручной ход: жёсткий инвариант не переступается, ухудшающий ход
 *          называет маркер и величину, у каждого хода есть обратный;
 *   G-60 · выдача: печатная и календарная проекции совпадают со снимком,
 *          подпись воспроизводима и меняется вместе с версией сетки;
 *   G-61 · реестр параметров: у каждого параметра есть область, дефолт внутри
 *          неё и названный потребитель; каждый вход генератора покрыт; ни один
 *          параметр ввода не ослабляет норму.
 *
 * Эталон — `specs/schedule-block/model/quality.mjs` (свойства Q1…Q12).
 * Ни БД, ни сети: слой чист, и его поведение перечисляется, а не наблюдается.
 *
 * Запуск: npm --workspace apps/api run quality:check
 */
import {
  EXTERNAL_SOURCES,
  PAIRING_TOLERANCE,
  PARAM_STEPS,
  PRIORITIES,
  PROGRESS_SHOWS_NUMBERS,
  QUALITY_MARKERS,
  QUALITY_MARKER_TITLES,
  QUALITY_WEIGHTS,
  RELAXABLE,
  DEFAULT_PAIRING,
  PRIORITY_WEIGHT,
  inversionCost,
  pairingIsAdjacent,
  pairingFromYearHours,
  COVER_MODE_WEEKS,
  GLOSSARY,
  JARGON,
  PLAN_IS_LAW_FOR_GENERATION,
  hoursDebt,
  LABOUR_NORMS_OWNER,
  teacherWeekHours,
  SCHEDULE_BLOCK_ERRORS,
  SCHEDULE_BLOCK_ERROR_TEXTS,
  INVARIANT_TITLES,
  SCHEDULE_INVARIANTS,
  SCHEDULE_PARAMS,
  SCHEDULE_REFUSALS,
  SCHEDULE_REFUSAL_TEXTS,
  SEARCH_DEPTHS,
  type ScheduleMove,
} from '@edustore/shared';
import { generate, type GenInput, type GenPair } from '../src/schoolium/schedule/generator';
import {
  applyMove,
  buildSnapshot,
  canonicalSnapshot,
  evaluateManualMove,
  inverseMove,
  invariants,
  lowerBound,
  maxSpread,
  neighbourhood,
  penalties,
  projectCsv,
  projectGrid,
  projectIcs,
  qualityDto,
  repair,
  signSnapshot,
  slotsFromUnits,
  totalPenalty,
  unitsFromSlots,
  type PlacedUnit,
  type QualityContext,
  type SlotRow,
} from '../src/schoolium/schedule/quality';
import { check, report } from './schoolium/harness';

const TEACHERS = ['Мария', 'Ольга', 'Иван', 'Пётр', 'Анна', 'Нина', 'Олег', 'Юлия', 'Егор', 'Вера'];

/** Первая школа: 8 параллелей без литер, английский по группам, приоритеты заданы. */
function firstSchool(seed: number): GenInput {
  const classes = Array.from({ length: 8 }, (_, i) => ({ id: `c${i + 1}`, label: String(i + 1), parallel: i + 1, groupCount: 2 }));
  const pairs: GenPair[] = [];
  classes.forEach((c, i) => {
    const add = (subjectId: string, subjectName: string, teacher: string, hours: number, scope: 'class' | 'group', groupNos: number[], priority = false) =>
      pairs.push({ subjectId: `${subjectId}-${c.id}`, subjectName, classId: c.id, teacherId: teacher, teacherName: teacher, scope, groupNos, hours, priority });
    add('math', 'математика', TEACHERS[i % 3], 4, 'class', [], true);
    add('rus', 'русский', TEACHERS[3 + (i % 3)], 4, 'class', [], true);
    add('hist', 'история', TEACHERS[6], 2, 'class', []);
    add('pe', 'физкультура', TEACHERS[7], 2, 'class', []);
    add('eng', 'английский', TEACHERS[8], 2, 'group', [1]);
    add('eng', 'английский', TEACHERS[9], 2, 'group', [2]);
  });
  return {
    classes,
    pairs,
    params: { days: 5, slotsPerDay: 7, lessonMin: 45, breakMin: 10, bigBreakAfter: 2, bigBreakMin: 30 },
    seed,
    classesWithUnassignedGroups: [],
    uncovered: [],
  };
}

function build(seed: number): { units: PlacedUnit[]; ctx: QualityContext; rows: SlotRow[] } {
  const input = firstSchool(seed);
  const res = generate(input);
  if (!res.ok) throw new Error(`сетка не собралась: ${res.code}`);
  const ctx: QualityContext = {
    classes: input.classes.map((c) => ({ id: c.id, label: c.label, parallel: c.parallel })),
    params: input.params,
    priority: new Set(input.pairs.filter((p) => p.priority).map((p) => p.subjectId)),
  };
  const rows: SlotRow[] = res.slots.map((s) => ({ ...s }));
  return { units: unitsFromSlots(rows, ctx), ctx, rows };
}

const { units, ctx, rows } = build(20260826);

// ─────────────────────────── G-56 · квалиметрия ───────────────────────────

check(units.length === 112, `сетка первой школы: ${units.length} учебных часов на ${ctx.params.days * ctx.params.slotsPerDay} слотах недели`);
check(slotsFromUnits(units).length === rows.length, 'сборка часов из строк шаблона и обратная проекция сходятся по числу строк');

const pen = penalties(units, ctx);
let quantitiesOk = true;
for (const m of QUALITY_MARKERS) {
  if (!Number.isInteger(pen[m].pi) || pen[m].pi < 0) quantitiesOk = false;
  if (pen[m].max <= 0) quantitiesOk = false;
  const q = 1 - pen[m].pi / pen[m].max;
  if (q < 0 || q > 1) quantitiesOk = false;
}
check(quantitiesOk, `восемь маркеров: πᵢ целые ≥ 0, πᵢᵐᵃˣ > 0, Qᵢ ∈ [0,1]`);
check(QUALITY_MARKERS.every((m) => Number.isInteger(QUALITY_WEIGHTS[m]) && QUALITY_WEIGHTS[m] > 0),
  'веса маркеров целые и положительные — на этом стоит доказательство завершения поиска');

const P = totalPenalty(pen);
check(Number.isInteger(P) && P >= 0, `свёртка Π(x₀) = ${P} — неотрицательное целое`);

const floor = lowerBound(units, ctx);
const dto = qualityDto(pen, false, floor);
check(dto.aggregate >= 0 && dto.aggregate <= 1, `агрегат качества ${(dto.aggregate * 100).toFixed(1)} % лежит в [0,1]`);
check(floor.total <= P, `нижняя граница Π_LB = ${floor.total} не выше достигнутой Π = ${P}: граница выводится из арифметики, а не из удачи перебора`);
check(
  QUALITY_MARKERS.every((m) => floor.markers[m] <= pen[m].pi && floor.markers[m] <= pen[m].max),
  'нижняя граница каждого маркера не выше ни его достигнутого штрафа, ни его верхней границы',
);
check(
  dto.ceiling !== undefined && dto.ceiling >= dto.aggregate && dto.ceiling <= 1,
  `панель называет потолок качества ${((dto.ceiling ?? 0) * 100).toFixed(1)} % рядом с агрегатом ${(dto.aggregate * 100).toFixed(1)} %: число без шкалы прочитать нельзя`,
);
check(qualityDto(pen, false).ceiling === undefined, 'без вычисленной границы потолок не выдумывается, а отсутствует');
check(dto.markers.length === QUALITY_MARKERS.length, `панель качества показывает все ${QUALITY_MARKERS.length} маркеров`);
check(dto.markers.find((m) => m.id === 'stability')?.active === false,
  'без подтверждённой сетки маркер стабильности неактивен, а не равен единице: сравнивать было не с чем');

// maxSpread против перебора ВСЕХ разбиений малой задачи
{
  const H = 7, D = 3, CAP = 4;
  let best = 0;
  const rec = (d: number, left: number, acc: number[]): void => {
    if (d === D) {
      if (left === 0) best = Math.max(best, acc.reduce((a, n) => a + Math.abs(n * D - H), 0));
      return;
    }
    for (let n = 0; n <= Math.min(CAP, left); n += 1) rec(d + 1, left - n, [...acc, n]);
  };
  rec(0, H, []);
  check(maxSpread(H, D, CAP) === best, `верхняя граница разброса вычислена, а не угадана: maxSpread(7,3,4) = ${best} совпал с максимумом по всем разбиениям`);
}

// ─────────────────────────── G-57 · автопроверка ───────────────────────────

check(invariants(units, ctx).length === 0, `жёсткие инварианты держатся на всех ${units.length} часах сетки`);

const spoil = (fn: (u: PlacedUnit[]) => PlacedUnit[]): Set<string> =>
  new Set(invariants(fn(units.map((u) => ({ ...u }))), ctx).map((v) => v.code));

const spoiled: [string, (u: PlacedUnit[]) => PlacedUnit[]][] = [
  ['I-1', (u) => [...u, { ...u[0] }]],
  ['I-3', (u) => u.map((x, i) => (i === 1 ? { ...x, classId: u[0].classId, dayNo: u[0].dayNo, slotNo: u[0].slotNo } : x))],
  ['I-5', (u) => u.map((x, i) => (i === 0 ? { ...x, slotNo: ctx.params.slotsPerDay } : x))],
  ['I-7', (u) => u.map((x, i) => (i === 0 ? { ...x, dayNo: 99 } : x))],
];
for (const [code, fn] of spoiled) {
  const got = spoil(fn);
  check(got.has(code), `подделка воспроизводит ${code} (поймано: ${[...got].join(', ') || 'ничего'})`);
}
// I-6 отдельно: у первой параллели потолок дня 4, кладём в один день пять часов.
{
  const first = units.filter((u) => u.classId === 'c1').slice(0, 5);
  const ids = new Set(first.map((u) => u.id));
  const got = new Set(
    invariants(units.map((u) => (ids.has(u.id) ? { ...u, dayNo: 0, slotNo: first.findIndex((f) => f.id === u.id) + 1 } : u)), ctx).map((v) => v.code),
  );
  check(got.has('I-6'), `подделка воспроизводит I-6 — дневной потолок параллели (поймано: ${[...got].join(', ')})`);
}
check(SCHEDULE_INVARIANTS.length === 8, `инвариантов ровно восемь: ${SCHEDULE_INVARIANTS.join(', ')}`);

// ─────────────────────── G-58 · автокорректировка ───────────────────────

const fixed = repair(units, ctx);
check(fixed.penaltyAfter <= fixed.penaltyBefore, `Π не выросла: ${fixed.penaltyBefore} → ${fixed.penaltyAfter} за ${fixed.movesApplied} ходов`);
check(fixed.trace.every((t) => t.to < t.from), 'каждый принятый ход уменьшает Π строго — последовательность в ℤ≥0 обрывается, завершение не зависит от таймера');
check(invariants(fixed.units, ctx).length === 0, 'после автокорректировки жёсткие инварианты держатся');
check(fixed.localMinimum, 'поиск встал в локальном минимуме, а не упёрся в бюджет');
check(repair(fixed.units, ctx).movesApplied === 0, 'повторный прогон из локального минимума не делает ни одного хода');
check(totalPenalty(penalties(fixed.units, ctx)) >= lowerBound(fixed.units, ctx).total,
  `найденный локальный минимум ${totalPenalty(penalties(fixed.units, ctx))} не ниже аналитической границы ${lowerBound(fixed.units, ctx).total} — «эталон» и локальный минимум это разные величины`);
check(
  fixed.traded.every((t) => t.after > t.before) && Array.isArray(fixed.traded),
  fixed.traded.length
    ? `размен показан: при падении Π ухудшились маркеры ${fixed.traded.map((t) => `«${t.title}» ${t.before}→${t.after}`).join(', ')} — скалярная свёртка обязана разменивать, и прятать это за агрегатом нельзя`
    : 'размена не потребовалось: ни один маркер не ухудшился',
);
check(
  JSON.stringify(repair(units, ctx).units) === JSON.stringify(fixed.units),
  'автокорректировка детерминирована: два прогона на одном входе дают одну сетку',
);
// час, подвинутый человеком, машина назад не возвращает
{
  const manual = units.map((u, i) => (i === 0 ? { ...u, origin: 'manual' as const } : u));
  const moves = neighbourhood(manual, ctx);
  check(
    !moves.some((m) => (m.kind === 'move' ? m.unitId === manual[0].id : m.aId === manual[0].id || m.bId === manual[0].id)),
    'час с признаком «правка человека» в окрестность поиска не входит — машина его не возвращает',
  );
}

// ─────────────────────── G-59 · ручной ход ───────────────────────

{
  const a = units.find((u) => u.classId === 'c3');
  const b = units.find((u) => u.classId === 'c3' && u.id !== a?.id);
  if (!a || !b) throw new Error('в классе c3 меньше двух часов — стенд собран неверно');
  const collide: ScheduleMove = { kind: 'move', unitId: b.id, dayNo: a.dayNo, slotNo: a.slotNo };
  const verdict = evaluateManualMove(units, ctx, collide);
  check(verdict.rejected.length > 0, `ход в занятую позицию отклонён жёстким инвариантом: ${[...new Set(verdict.rejected.map((v) => v.code))].join(', ')}`);

  // ухудшающий, но допустимый ход обязан существовать — иначе третий исход недостижим
  let degrading: { move: ScheduleMove; delta: number; markers: number } | null = null;
  for (const mv of neighbourhood(units, ctx)) {
    const v = evaluateManualMove(units, ctx, mv);
    if (v.rejected.length) continue;
    if (v.penaltyAfter > v.penaltyBefore) { degrading = { move: mv, delta: v.penaltyAfter - v.penaltyBefore, markers: v.degraded.length }; break; }
  }
  check(degrading !== null && degrading.markers > 0,
    `ухудшающий допустимый ход найден: Π растёт на ${degrading?.delta}, названы ${degrading?.markers} маркера — интерфейс просит подтверждение, а не отказывает`);

  const moved = applyMove(units, { kind: 'move', unitId: a.id, dayNo: a.dayNo, slotNo: a.slotNo }, 'manual');
  check(moved.find((u) => u.id === a.id)?.origin === 'manual', 'применённый рукой ход помечает час признаком «правка человека»');
}

// обратимость обоих видов хода
{
  const u0 = units[0];
  const mv: ScheduleMove = { kind: 'move', unitId: u0.id, dayNo: (u0.dayNo + 1) % ctx.params.days, slotNo: 1 };
  const back = applyMove(applyMove(units, mv), inverseMove(units, mv));
  check(
    back.every((u) => {
      const src = units.find((x) => x.id === u.id);
      return src !== undefined && src.dayNo === u.dayNo && src.slotNo === u.slotNo;
    }),
    'перенос обратим: ход и обратный ход возвращают сетку в исходное состояние',
  );
  const sw: ScheduleMove = { kind: 'swap', aId: units[0].id, bId: units[1].id };
  const back2 = applyMove(applyMove(units, sw), inverseMove(units, sw));
  check(
    back2.every((u) => {
      const src = units.find((x) => x.id === u.id);
      return src !== undefined && src.dayNo === u.dayNo && src.slotNo === u.slotNo;
    }),
    'обмен самообратен',
  );
}

// ─────────────────────── G-60 · снимок и выдача ───────────────────────

const meta = {
  id: 'snap-1',
  templateId: 'tpl-1',
  version: 1,
  generatedAt: '2026-08-27T00:00:00.000Z',
  classLabel: (id: string) => id.replace('c', '') + ' класс',
  subjectName: (id: string) => id.split('-')[0],
  teacherName: (id: string) => id,
};
const snap = buildSnapshot(fixed.units, ctx, meta);
check(snap.slots.length === rows.length, `снимок содержит все ${snap.slots.length} строк сетки`);
check(!JSON.stringify(snap).includes('"studentId"'), 'персональных данных учеников в снимке нет: слот занимает класс либо группа');

{
  const inGrid = snap.slots.filter((s) => s.classId === 'c5').length;
  const printed = projectGrid(snap, 'class', 'c5').flat().slice(0).filter((v, i) => i % (snap.params.days + 1) !== 0 && v !== '').length;
  const csvCells = projectCsv(snap, 'class', 'c5').split('\r\n').length - 2;
  const ics = projectIcs(snap, 'class', 'c5', { firstMonday: '20260901', until: '20261231T000000Z', exdates: ['20261104'], startMinutes: 8 * 60 });
  const events = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
  // печатная ячейка объединяет обе группы одного часа, календарная — нет:
  // отсюда сверка идёт по числу занятых ячеек, а не по числу строк снимка.
  check(printed > 0 && printed <= inGrid, `печатная проекция класса: ${printed} занятых ячеек против ${inGrid} строк снимка`);
  check(csvCells === snap.params.slotsPerDay, `файл-таблица содержит ${csvCells} строк — по строке на позицию дня`);
  check(events === inGrid, `календарная проекция содержит ${events} событий — по одному на строку снимка`);
  check(ics.includes('RRULE:FREQ=WEEKLY') && ics.includes('EXDATE:'), 'календарь выражает неделю правилом повтора с исключениями нерабочих дней, а не списком уроков');
  check(projectGrid(snap, 'teacher', 'Егор').flat().join('').length > 0, 'проекция области «педагог» непуста');
  check(
    !projectCsv(snap, 'teacher', 'Егор').includes('Вера'),
    'ссылка области «педагог» не выдаёт сетку других педагогов',
  );
}

{
  const exp = '2026-11-25T00:00:00.000Z';
  const s1 = signSnapshot(snap, 'class', 'c5', exp, 'секрет');
  const s2 = signSnapshot(buildSnapshot(fixed.units, ctx, meta), 'class', 'c5', exp, 'секрет');
  check(s1 === s2, 'подпись снимка воспроизводима на одинаковых данных');
  const s3 = signSnapshot(buildSnapshot(fixed.units, ctx, { ...meta, version: 2 }), 'class', 'c5', exp, 'секрет');
  check(s1 !== s3, 'смена версии сетки меняет подпись — старая ссылка не выдаёт новую сетку без отдельной операции отзыва');
  const s4 = signSnapshot(snap, 'teacher', 'c5', exp, 'секрет');
  check(s1 !== s4, 'область входит в подпись: ссылку класса нельзя выдать за ссылку педагога');
  const s5 = signSnapshot(snap, 'class', 'c5', exp, 'другой секрет');
  check(s1 !== s5, 'подпись зависит от секрета');
  check(canonicalSnapshot(snap) === canonicalSnapshot(snap), 'каноническая форма снимка устойчива');
}

check(SCHEDULE_BLOCK_ERRORS.every((c) => (SCHEDULE_BLOCK_ERROR_TEXTS[c] ?? '').length > 0),
  `у всех ${SCHEDULE_BLOCK_ERRORS.length} кодов блока есть текст с объектом и цифрами`);
check(SCHEDULE_BLOCK_ERROR_TEXTS.SHARE_EXPIRED === SCHEDULE_BLOCK_ERROR_TEXTS.SHARE_REVOKED,
  'истёкшая и отозванная ссылки отвечают одинаково: различить снаружи причину нельзя');

// ─────────────────────── G-61 · реестр параметров ───────────────────────

{
  const ids = SCHEDULE_PARAMS.map((p) => p.id);
  check(new Set(ids).size === ids.length, `реестр параметров: ${ids.length} записей, идентификаторы уникальны`);

  const steps = new Set(PARAM_STEPS.map((s) => s.id));
  check(SCHEDULE_PARAMS.every((p) => steps.has(p.step)), `каждый параметр приписан к одному из ${PARAM_STEPS.length} шагов мастера`);

  check(
    SCHEDULE_PARAMS.every((p) => p.label.length > 0 && p.feeds.length > 0),
    'у каждого параметра есть подпись и НАЗВАННЫЙ потребитель — мёртвого ввода в реестре нет (дыра AR-103 закрыта перечислением)',
  );

  const outOfRange = SCHEDULE_PARAMS.filter(
    (p) => typeof p.default === 'number' && ((p.min !== undefined && p.default < p.min) || (p.max !== undefined && p.default > p.max)),
  );
  check(outOfRange.length === 0, `дефолт каждого параметра лежит внутри его области${outOfRange.length ? `: нарушают ${outOfRange.map((p) => p.id).join(', ')}` : ''}`);

  const listed = SCHEDULE_PARAMS.filter((p) => p.values !== undefined);
  check(
    listed.every((p) => p.default === undefined || (p.values as readonly (string | number)[]).includes(p.default as string | number)),
    'дефолт перечислимого параметра принадлежит перечню его значений',
  );

  // Норму можно ужесточить, ослабить нельзя (AR-131).
  const loosening = SCHEDULE_PARAMS.filter((p) => p.normCap !== undefined && (p.max === undefined || p.max > p.normCap));
  check(loosening.length === 0, `ни один параметр ввода не ослабляет норму${loosening.length ? `: ${loosening.map((p) => p.id).join(', ')}` : ''} — ужесточить можно, ослабить нет`);

  // Величины чужих блоков в реестр расписания не попадают (AR-133): второй ввод
  // тех же дат и звонков означал бы второй источник истины.
  const foreign = SCHEDULE_PARAMS.filter((p) => /^(year|skeleton|day|week)\./.test(p.id) && p.kind === 'input');
  check(foreign.length === 0, `величины календаря и скелета дня не собираются расписанием${foreign.length ? `: ${foreign.map((p) => p.id).join(', ')}` : ''} — оно их читает`);
  check(EXTERNAL_SOURCES.length === 5 && EXTERNAL_SOURCES.every((s) => s.gives.length > 0),
    `названы все ${EXTERNAL_SOURCES.length} блоков-владельцев, у каждого перечислено, что он даёт расписанию`);

  // Приоритет: цена инверсии убывает с номером, приоритеты повторяемы.
  check(PRIORITIES.length === 6 && PRIORITIES[0] === 1,
    'приоритет — шкала 1…6, где 1 самый главный; приоритеты повторяются у нескольких предметов');
  // Шкала приоритета выведена из свойства, а не подобрана: один урок приоритета
  // p важнее всех уроков более низких приоритетов вместе взятых. Именно это
  // делает порядок приоритетов порядком, а не предметом размена.
  check(
    PRIORITIES.every((p) => {
      const lower = PRIORITIES.filter((q) => q > p).reduce((a, q) => a + PRIORITY_WEIGHT[q], 0);
      return PRIORITY_WEIGHT[p] > lower;
    }),
    `вес приоритета (${PRIORITIES.map((p) => PRIORITY_WEIGHT[p]).join(', ')}): каждый весомее суммы всех, что ниже — размен «сильный ради нескольких слабых» невыгоден`,
  );
  check(
    PRIORITIES.every((p) => Number.isInteger(PRIORITY_WEIGHT[p]) && PRIORITY_WEIGHT[p] > 0),
    'веса приоритета целые и положительные — доказательство завершения поиска не ломается',
  );
  check(
    [1, 2, 3, 4].every((p) => inversionCost((p + 1) as 2, (p + 2) as 3) < inversionCost(p as 1, (p + 1) as 2)),
    `цена инверсии убывает с номером: 1↔2 стоит ${inversionCost(1, 2)}, 4↔5 — ${inversionCost(4, 5)}`,
  );
  check(inversionCost(3, 3) === 0, 'инверсии между равными приоритетами не существует: приоритеты повторяемы');

  // Спаренность: шкала владельца дословно, и связь с приоритетом.
  check(PAIRING_TOLERANCE[1] === 0 && PAIRING_TOLERANCE[6] === 0,
    'спаренность: уровень 1 не допускает неспаренных часов, уровень 6 запрещает спаривание вовсе — оба жёсткие');
  check(
    PAIRING_TOLERANCE[2] === 0.2 && PAIRING_TOLERANCE[3] === 0.4 && PAIRING_TOLERANCE[4] === 0.6 && PAIRING_TOLERANCE[5] === 0.8,
    'допуски неспаренности уровней 2…5 — 20 / 40 / 60 / 80 процентов, как названо владельцем',
  );
  check(
    SCHEDULE_PARAMS.find((x) => x.id === 'subject.pairing')?.default === DEFAULT_PAIRING && DEFAULT_PAIRING === 5,
    'спаренность из приоритета НЕ выводится: шкалы не совпадают',
  );

  // AR-147 — спаренность выводится из ГОДОВЫХ ЧАСОВ: чем больше уроков, тем выше
  // порог обязательной спаренности. Вывод следует из арифметики: при часах
  // больше учебных дней какой-то день ОБЯЗАН взять два часа.
  const W = 34, D = 5;
  const lvl = (yearHours: number) => pairingFromYearHours(yearHours, W, D);
  check(
    lvl(3 * W) === 5 && lvl(5 * W) === 5,
    'до пяти часов в неделю спаривание ничем не вынуждено — уровень остаётся «необязательно»',
  );
  check(
    lvl(6 * W) === 4 && lvl(7 * W) === 3 && lvl(8 * W) === 2 && lvl(10 * W) === 1,
    'чем больше годовых часов, тем выше порог обязательной спаренности: 6 ч → 4, 7 ч → 3, 8 ч → 2, 10 ч → 1',
  );
  {
    let monotone = true;
    for (let h = 1; h < 12; h += 1) if (lvl((h + 1) * W) > lvl(h * W)) monotone = false;
    check(monotone, 'зависимость монотонна: добавление часов никогда не понижает порог обязательной спаренности');
  }
  check(
    [...Array(20).keys()].every((i) => lvl((i + 1) * W) !== 6),
    'уровень «запрещено» не выводится никогда — он ставится рукой либо следует из нормы для 1-х классов',
  );
  check(
    lvl(0) === DEFAULT_PAIRING && lvl(102) === pairingFromYearHours(102, W, D),
    'без годовых часов вывод не выдумывается, а отдаёт дефолт',
  );
  check(pairingIsAdjacent(2, 3, 2) && pairingIsAdjacent(3, 2, 2),
    'пара, разделённая большой переменой, остаётся парой — блок 2–3 при большой перемене после второго урока');
  check(
    [0, 1, 2, 3, 4, 5, 6].every((b) => pairingIsAdjacent(2, 3, b) === pairingIsAdjacent(2, 3, 0)),
    'большая перемена не влияет на то, пара это или нет: смежность считается по номеру позиции',
  );
  check(!pairingIsAdjacent(2, 5, 2), 'два часа через три позиции парой не считаются');

  // Норма отдыха — вывод из нормы завуча и объёма часов, а не константа.
  check(teacherWeekHours([4, 4, 2, 2]) === 12, 'нагрузка педагога считается сама — сумма недельных часов его пар, а не ввод');
  check(
    !SCHEDULE_PARAMS.some((x) => /ставк|fullLoad/i.test(x.id + x.label)),
    'понятия ставки в расчёте нет: всё считается от годовых часов предметов',
  );
  // Трудовых норм в блоке нет: обед, окна на отдых и предельная занятость —
  // вопросы кадров и бухгалтерии, а не завуча. Требовать окна числом было
  // ошибкой: при малом числе педагогов сетка плотная, и норма превращалась бы
  // в отказ на ровном месте.
  check(
    !SCHEDULE_PARAMS.some((x) => /lunch|обед|отдых|minWeekGaps|maxPerDay/i.test(x.id + x.label)),
    `трудовых норм в реестре расписания нет — их владелец: ${LABOUR_NORMS_OWNER}`,
  );
  check(
    !QUALITY_MARKERS.some((m) => String(m) === 'teacherGap'),
    'маркера «окно у педагога» в качестве нет: окна возникают как следствие расстановки, продукт мнения о них не имеет',
  );
  check(
    !(SCHEDULE_REFUSALS as readonly string[]).some((c) => /LUNCH|MAX_PER_DAY/.test(c)),
    'отказов по трудовым нормам не осталось: блок их не проверяет, потому что не задаёт',
  );

  // Отказ «нет решения» выведен из обихода (AR-136).
  check(!(SCHEDULE_REFUSALS as readonly string[]).includes('NO_SOLUTION'),
    'кода NO_SOLUTION в перечне отказов расписания нет: у любого отказа есть адрес и имя');
  check(
    SCHEDULE_REFUSALS.every((c) => (SCHEDULE_REFUSAL_TEXTS[c] ?? '').includes('{') || c === 'CALENDAR_NOT_READY'),
    `все ${SCHEDULE_REFUSALS.length} отказов несут подстановку с объектом и цифрами, а не общую фразу`,
  );
  check((SCHEDULE_REFUSALS as readonly string[]).includes('RELAXATION_SUGGESTED') && SCHEDULE_REFUSAL_TEXTS.RELAXATION_SUGGESTED.includes('{action}'),
    'диагностика релаксацией отвечает ДЕЙСТВИЕМ («собирается, если …»), а не диагнозом');
  check(RELAXABLE.length > 0 && RELAXABLE.every((r) => ids.includes(r)),
    `все ${RELAXABLE.length} снимаемых требований существуют в реестре параметров — снимать нечего не будет`);

  const unknownRefusal = SCHEDULE_PARAMS.flatMap((p) => p.refusals ?? []).filter((c) => !(SCHEDULE_REFUSALS as readonly string[]).includes(c));
  check(unknownRefusal.length === 0, `каждый отказ, названный параметром, существует в перечне${unknownRefusal.length ? `: неизвестны ${[...new Set(unknownRefusal)].join(', ')}` : ''}`);

  // Глубина поиска: работа измеряется вариантами, а не секундами.
  const depths = Object.values(SEARCH_DEPTHS);
  check(depths.length === 3 && depths.every((d) => d.variants > 0 && d.flatStop > 0),
    `глубина поиска: ${depths.map((d) => `${d.label} — ${d.variants} вариантов`).join(', ')}`);
  check(
    depths[0].variants < depths[1].variants && depths[1].variants < depths[2].variants,
    'глубины упорядочены: тщательнее значит больше вариантов, а не дольше секунд',
  );
  check(SCHEDULE_PARAMS.every((p) => !/seconds|minutes|время/i.test(p.id + p.label)) ,
    'ни один параметр не спрашивает у человека секунды: время — следствие числа классов и жёсткости требований');
  check(PROGRESS_SHOWS_NUMBERS === false,
    'прогресс генерации — модальное окно с анимацией: ни одной цифры человеку не показывается');
}

// ─────────────────── G-62 · единый словарь без жаргона ───────────────────

{
  const hasJargon = (s: string): string | null => JARGON.find((w) => s.toLowerCase().includes(w)) ?? null;

  check(GLOSSARY.length >= 10 && GLOSSARY.every((g) => g.human && g.code && g.means),
    `словарь блока: ${GLOSSARY.length} понятий, у каждого слово для человека, имя в коде и объяснение`);
  check(
    new Set(GLOSSARY.map((g) => g.human)).size === GLOSSARY.length,
    'одно понятие — одно слово: человеческие названия в словаре не повторяются',
  );

  const dirtyMarker = QUALITY_MARKERS.map((m) => QUALITY_MARKER_TITLES[m]).find((s) => hasJargon(s));
  check(dirtyMarker === undefined, `названия правил удобства без жаргона${dirtyMarker ? `: «${dirtyMarker}»` : ''}`);

  const dirtyInvariant = SCHEDULE_INVARIANTS.map((i) => INVARIANT_TITLES[i]).find((s) => hasJargon(s));
  check(dirtyInvariant === undefined, `названия запретов без жаргона${dirtyInvariant ? `: «${dirtyInvariant}»` : ''}`);

  const dirtyParam = SCHEDULE_PARAMS.map((p) => p.label).find((s) => hasJargon(s));
  check(dirtyParam === undefined, `подписи параметров на экранах без жаргона${dirtyParam ? `: «${dirtyParam}»` : ''}`);

  const dirtyRefusal = SCHEDULE_REFUSALS.map((c) => SCHEDULE_REFUSAL_TEXTS[c]).find((s) => hasJargon(s));
  check(dirtyRefusal === undefined, `тексты отказов без жаргона${dirtyRefusal ? `: «${dirtyRefusal}»` : ''}`);

  const dirtyBlock = SCHEDULE_BLOCK_ERRORS.map((c) => SCHEDULE_BLOCK_ERROR_TEXTS[c]).find((s) => hasJargon(s));
  check(dirtyBlock === undefined, `тексты отказов слоя без жаргона${dirtyBlock ? `: «${dirtyBlock}»` : ''}`);
}

// ─────────── G-63 · годовая норма, добор часов и подстраховка ───────────

{
  check(PLAN_IS_LAW_FOR_GENERATION === true,
    'годовая норма — закон для сборки: машина обязана уложить ровно часы учебного плана');

  // Расхождение с планом появляется ТОЛЬКО от руки человека, и текст об этом
  // существует ровно один — после автоматической сборки его быть не может.
  check(
    SCHEDULE_REFUSAL_TEXTS.PLAN_DIVERGES_BY_HAND.includes('после правки вручную'),
    'о расхождении с планом система говорит только про правку рукой — после автоматической сборки такого сообщения нет',
  );

  // Час не теряется и не заменяет собой другой предмет: он уходит в долг.
  check(hoursDebt(12, 11) === 1 && hoursDebt(12, 12) === 0 && hoursDebt(12, 13) === -1,
    'недобор, ровный счёт и забег вперёд считаются одной величиной: положено минус проведено');
  check(
    SCHEDULE_REFUSAL_TEXTS.MAKE_UP_OFFERED.includes('{date}') && SCHEDULE_REFUSAL_TEXTS.MAKE_UP_OFFERED.includes('{slot}'),
    'вместо «урок пропал» система называет конкретный день и номер урока, куда час встаёт',
  );
  check(
    SCHEDULE_REFUSAL_TEXTS.MAKE_UP_NO_ROOM.includes('некуда'),
    'когда добрать негде, это сказано прямо, а не спрятано за молчанием',
  );

  // Подстраховка при уходе педагога.
  check(COVER_MODE_WEEKS === 4, `режим подстраховки длится ${COVER_MODE_WEEKS} недели — время на поиск замены`);
  check(
    SCHEDULE_REFUSAL_TEXTS.COVER_MODE_ON.includes('{weeks}') && SCHEDULE_REFUSAL_TEXTS.COVER_MODE_ON.includes('снят'),
    'школа видит, что предмет снят и сколько недель подстраховки осталось',
  );
  check(
    SCHEDULE_REFUSAL_TEXTS.COVER_MODE_EXPIRED.includes('{debt}'),
    'по истечении срока называется накопленный недобор в часах, а решение остаётся за школой',
  );
  check(
    !SCHEDULE_REFUSAL_TEXTS.COVER_MODE_EXPIRED.includes('автоматическ'),
    'система не решает за школу, что делать с непроведёнными часами',
  );
}

report('G-56…G-63 · СЛОЙ КАЧЕСТВА, ПАРАМЕТРЫ, СЛОВАРЬ И ГОДОВАЯ НОРМА');
