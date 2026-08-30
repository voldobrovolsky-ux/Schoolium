import { createHmac } from 'node:crypto';
import {
  DAY_MINUTES_CAP,
  INVARIANT_TITLES,
  QUALITY_MARKERS,
  QUALITY_MARKER_TITLES,
  QUALITY_WEIGHTS,
  REPAIR_BUDGET,
  classDayCap,
  type ExportFormat,
  type InvariantViolation,
  type MarkerPenalty,
  type PenaltyVector,
  type QualityMarker,
  type ScheduleMove,
  type ScheduleQualityDto,
  type ScheduleSnapshot,
  type ShareScope,
  type SlotOrigin,
} from '@edustore/shared';
import { dayLength, type GenDayParams } from './generator';

/**
 * Слой качества, корректировки и выдачи расписания (блок «Расписание» УТЦ).
 *
 * Спека: `specs/schedule-block/30-spec.md`. Решения: AR-118…AR-127.
 * Эталон: `specs/schedule-block/model/quality.mjs`, свойства Q1…Q12.
 * Ворота: G-56…G-60 (`npm --workspace apps/api run quality:check`).
 *
 * Модуль чист: ни Prisma, ни Nest, ни времени — поэтому его поведение
 * доказывается перечислением, а не наблюдением в проде. Три вещи здесь
 * неслучайны:
 *
 * 1. **Штрафы целые.** Π(x) = Σ wᵢ·πᵢ(x) ∈ ℤ≥0, и доказательство завершения
 *    локального поиска стоит на строгом убывании этой последовательности.
 *    Нормированные Qᵢ ∈ [0,1] — представление для человека, не предмет поиска.
 * 2. **Окрестность названа.** MOVE в первую свободную позицию дня и SWAP внутри
 *    класса — и только они. Инвариант I-5 (без окон) делает остальные ходы
 *    недопустимыми по построению, и перебор тратился бы на заведомые отказы.
 * 3. **Ход человека и ход машины — один и тот же объект.** Различие в праве
 *    принять ухудшающий ход, а не в множестве ходов.
 */

// ─────────────────────────── представление сетки ───────────────────────────

/**
 * Учебный час на своём месте — единица планирования с координатами. Групповой
 * час неделим: его части (по одной на группу) живут в одной записи и не имеют
 * собственных координат (AR-75, ограничение H4).
 */
export interface PlacedUnit {
  /** Стабильный ключ `класс:предмет:порядковый` — переживает перестановки. */
  id: string;
  classId: string;
  subjectId: string;
  priority: boolean;
  parts: { groupNo: number; teacherId: string }[];
  dayNo: number;
  slotNo: number;
  origin: SlotOrigin;
}

/** Строка `TemplateSlot`: в БД групповой час лежит по строке на группу. */
export interface SlotRow {
  dayNo: number;
  slotNo: number;
  classId: string;
  groupNo: number;
  subjectId: string;
  teacherId: string;
  origin?: SlotOrigin;
}

export interface QualityContext {
  classes: { id: string; label: string; parallel: number }[];
  params: GenDayParams;
  /** Приоритетные предметы — ввод экрана `S-41` шаг 3. */
  priority: Set<string>;
}

/**
 * Сборка единиц из строк шаблона. Строки одного слота, класса и предмета — это
 * один групповой час, а не два независимых: разделив их, слой посчитал бы
 * полуокно нормой и предложил бы человеку ход, ломающий AR-75.
 */
export function unitsFromSlots(rows: SlotRow[], ctx: QualityContext): PlacedUnit[] {
  const groups = new Map<string, SlotRow[]>();
  for (const r of rows) {
    const k = `${r.dayNo}:${r.slotNo}:${r.classId}:${r.subjectId}`;
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }
  const ordinal = new Map<string, number>();
  const out: PlacedUnit[] = [];
  for (const rs of groups.values()) {
    const head = rs[0];
    const key = `${head.classId}:${head.subjectId}`;
    const n = (ordinal.get(key) ?? 0) + 1;
    ordinal.set(key, n);
    out.push({
      id: `${key}:${n}`,
      classId: head.classId,
      subjectId: head.subjectId,
      priority: ctx.priority.has(head.subjectId),
      parts: rs.map((r) => ({ groupNo: r.groupNo, teacherId: r.teacherId })),
      dayNo: head.dayNo,
      slotNo: head.slotNo,
      origin: head.origin ?? 'generated',
    });
  }
  // Порядок фиксирован: от него зависит воспроизводимость локального поиска.
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Обратная проекция — строки шаблона для записи в БД. */
export function slotsFromUnits(units: PlacedUnit[]): SlotRow[] {
  return units.flatMap((u) =>
    u.parts.map((p) => ({
      dayNo: u.dayNo,
      slotNo: u.slotNo,
      classId: u.classId,
      groupNo: p.groupNo,
      subjectId: u.subjectId,
      teacherId: p.teacherId,
      origin: u.origin,
    })),
  );
}

const addr = (u: PlacedUnit): string => `${u.classId}:${u.dayNo}:${u.slotNo}`;

// ─────────────────────── автопроверка: инварианты (AR-120) ───────────────────────

/**
 * I-1…I-8 перечислением по ВСЕЙ сетке, а не выборкой: инвариант, проверенный на
 * образце, инвариантом не является. Нарушение — дефект движка, а не ввода
 * человека, и такая сетка наружу не выходит (`INVARIANT_BROKEN`).
 */
export function invariants(units: PlacedUnit[], ctx: QualityContext): InvariantViolation[] {
  const v: InvariantViolation[] = [];
  const { days, slotsPerDay } = ctx.params;

  // I-1: каждый час размещён ровно один раз — дубликаты ключей запрещены.
  const ids = new Set<string>();
  for (const u of units) {
    if (ids.has(u.id)) v.push({ code: 'I-1', address: u.id, message: `час ${u.id} размещён дважды` });
    ids.add(u.id);
  }

  // I-2: педагог не занимает два слота одновременно.
  const seenT = new Set<string>();
  for (const u of units) {
    for (const p of u.parts) {
      const k = `${u.dayNo}:${u.slotNo}:${p.teacherId}`;
      if (seenT.has(k)) v.push({ code: 'I-2', address: addr(u), message: `педагог занят дважды в слоте ${k}` });
      seenT.add(k);
    }
  }

  // I-3: класс не занимает два слота одновременно.
  const seenC = new Set<string>();
  for (const u of units) {
    const k = `${u.dayNo}:${u.slotNo}:${u.classId}`;
    if (seenC.has(k)) v.push({ code: 'I-3', address: addr(u), message: 'класс занят дважды' });
    seenC.add(k);
  }

  // I-4: групповой час неделим — по одной части на группу, без части «весь класс».
  for (const u of units) {
    if (u.parts.length < 2) continue;
    const gs = new Set(u.parts.map((p) => p.groupNo));
    if (gs.has(0)) v.push({ code: 'I-4', address: addr(u), message: 'спаренный час содержит часть «весь класс»' });
    if (gs.size !== u.parts.length) v.push({ code: 'I-4', address: addr(u), message: 'группа продублирована в часе' });
  }

  // I-5: занятые позиции дня класса образуют префикс 1…k.
  const byClassDay = new Map<string, number[]>();
  for (const u of units) {
    const k = `${u.classId}:${u.dayNo}`;
    const list = byClassDay.get(k);
    if (list) list.push(u.slotNo);
    else byClassDay.set(k, [u.slotNo]);
  }
  for (const [k, poss] of byClassDay) {
    const sorted = [...poss].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i += 1) {
      if (sorted[i] !== i + 1) {
        v.push({ code: 'I-5', address: k, message: `окно: заняты позиции ${sorted.join(', ')}` });
        break;
      }
    }
  }

  // I-6: дневной потолок ЕГО параллели (AR-114), а не школьное число.
  for (const c of ctx.classes) {
    const cap = classDayCap(c.parallel, slotsPerDay);
    for (let d = 0; d < days; d += 1) {
      const n = (byClassDay.get(`${c.id}:${d}`) ?? []).length;
      if (n > cap) v.push({ code: 'I-6', address: `${c.id}:${d}`, message: `${n} уроков при потолке ${cap}` });
    }
  }

  // I-7: координаты в границах сетки недели.
  for (const u of units) {
    if (u.dayNo < 0 || u.dayNo >= days) v.push({ code: 'I-7', address: u.id, message: `день ${u.dayNo} вне 0…${days - 1}` });
    if (u.slotNo < 1 || u.slotNo > slotsPerDay) v.push({ code: 'I-7', address: u.id, message: `позиция ${u.slotNo} вне 1…${slotsPerDay}` });
  }

  // I-8: длина дня — параметрический инвариант, от расстановки не зависит.
  const minutes = dayLength(ctx.params);
  if (minutes > DAY_MINUTES_CAP) v.push({ code: 'I-8', address: 'params', message: `${minutes} мин при потолке ${DAY_MINUTES_CAP}` });

  return v;
}

/** Текст инварианта для отказа — тот же, что видит человек на экране. */
export const invariantTitle = (code: InvariantViolation['code']): string => INVARIANT_TITLES[code];

// ─────────────────────── маркеры качества (AR-119) ───────────────────────

/**
 * Точный максимум Σ|n_δ·D − H| при Σn_δ = H и n_δ ≤ cap: достигается набиванием
 * дней под потолок. Считается явно, а не берётся оценкой сверху — иначе
 * нормировка Qᵢ ∈ [0,1] не выводится и «качество 87 %» не имеет области
 * определения (свойство Q4 сверяет функцию с перебором всех разбиений).
 */
export function maxSpread(total: number, days: number, cap: number): number {
  if (total <= 0 || days <= 0) return 0;
  const per = new Array<number>(days).fill(0);
  let left = total;
  for (let d = 0; d < days && left > 0; d += 1) {
    per[d] = Math.min(cap, left);
    left -= per[d];
  }
  return per.reduce((a, n) => a + Math.abs(n * days - total), 0);
}

const emptyMarker = (): MarkerPenalty => ({ pi: 0, max: 1, cells: [] });

/**
 * Восемь штрафов за один проход по сетке. Проход один не ради скорости ради
 * скорости: расчёт штрафа вызывается на каждом ходе окрестности, и квадратичная
 * версия выводит локальный поиск за любой бюджет ожидания человека.
 */
export function penalties(units: PlacedUnit[], ctx: QualityContext, baseline?: Map<string, { dayNo: number; slotNo: number }>): PenaltyVector {
  const { days, slotsPerDay } = ctx.params;
  const half = Math.ceil(slotsPerDay / 2);

  const classDay = new Map<string, { n: number; last: number }>();
  const subjDay = new Map<string, number>();
  const teacherDay = new Map<string, { n: number; min: number; max: number }>();
  const teachers = new Set<string>();
  const perSubjClass = new Map<string, number>();

  const out: PenaltyVector = {
    prio: emptyMarker(),
    subjectSpread: emptyMarker(),
    dayBalance: emptyMarker(),
    stability: emptyMarker(),
    teacherBalance: emptyMarker(),
    groupEdge: emptyMarker(),
    firstLast: emptyMarker(),
  };

  let prioMax = 0;
  let firstLastMax = 0;
  let groupEdgeMax = 0;

  for (const u of units) {
    if (u.priority) {
      prioMax += slotsPerDay - half;
      firstLastMax += 1;
      const over = Math.max(0, u.slotNo - half);
      if (over > 0) {
        out.prio.pi += over;
        out.prio.cells.push(addr(u));
      }
    }
    if (u.parts.length > 1) groupEdgeMax += 1;
    for (const p of u.parts) teachers.add(p.teacherId);

    perSubjClass.set(`${u.classId}:${u.subjectId}`, (perSubjClass.get(`${u.classId}:${u.subjectId}`) ?? 0) + 1);

    const ck = `${u.classId}:${u.dayNo}`;
    const cd = classDay.get(ck) ?? { n: 0, last: 0 };
    cd.n += 1;
    cd.last = Math.max(cd.last, u.slotNo);
    classDay.set(ck, cd);

    const sk = `${u.classId}:${u.subjectId}:${u.dayNo}`;
    subjDay.set(sk, (subjDay.get(sk) ?? 0) + 1);

    for (const p of u.parts) {
      const tk = `${p.teacherId}:${u.dayNo}`;
      const td = teacherDay.get(tk) ?? { n: 0, min: Number.POSITIVE_INFINITY, max: 0 };
      td.n += 1;
      td.min = Math.min(td.min, u.slotNo);
      td.max = Math.max(td.max, u.slotNo);
      teacherDay.set(tk, td);
    }

    if (baseline) {
      const b = baseline.get(u.id);
      if (!b || b.dayNo !== u.dayNo || b.slotNo !== u.slotNo) {
        out.stability.pi += 1;
        out.stability.cells.push(addr(u));
      }
    }
  }

  out.prio.max = Math.max(1, prioMax);
  out.stability.max = baseline ? Math.max(1, baseline.size) : 1;

  // dayBalance: отклонение дневной нагрузки класса от средней в целых единицах.
  let dayBalanceMax = 0;
  for (const c of ctx.classes) {
    const per: number[] = [];
    let tot = 0;
    for (let d = 0; d < days; d += 1) {
      const n = classDay.get(`${c.id}:${d}`)?.n ?? 0;
      per.push(n);
      tot += n;
    }
    for (let d = 0; d < days; d += 1) {
      const delta = Math.abs(per[d] * days - tot);
      out.dayBalance.pi += delta;
      if (delta > 0 && per[d] > 0) out.dayBalance.cells.push(`${c.id}:${d}`);
    }
    dayBalanceMax += maxSpread(tot, days, classDayCap(c.parallel, slotsPerDay));
  }
  out.dayBalance.max = Math.max(1, dayBalanceMax);

  // teacherBalance: та же мера по педагогам.
  let teacherBalanceMax = 0;
  for (const t of teachers) {
    const per: number[] = [];
    let tot = 0;
    for (let d = 0; d < days; d += 1) {
      const n = teacherDay.get(`${t}:${d}`)?.n ?? 0;
      per.push(n);
      tot += n;
    }
    for (const n of per) out.teacherBalance.pi += Math.abs(n * days - tot);
    teacherBalanceMax += maxSpread(tot, days, slotsPerDay);
  }
  out.teacherBalance.max = Math.max(1, teacherBalanceMax);

  // subjectSpread: часы одного предмета, попавшие в один день класса.
  let subjectSpreadMax = 0;
  for (const [k, n] of subjDay) {
    if (n > 1) {
      out.subjectSpread.pi += n - 1;
      out.subjectSpread.cells.push(k);
    }
  }
  for (const h of perSubjClass.values()) subjectSpreadMax += Math.max(0, h - 1);
  out.subjectSpread.max = Math.max(1, subjectSpreadMax);

  // Окна педагога не штрафуются и не поощряются: продукт мнения об этом не
  // имеет (см. QUALITY_MARKERS). Индекс `teacherDay` остаётся — он нужен
  // маркеру равномерности нагрузки педагога.

  // groupEdge и firstLast — вторым проходом: обоим нужен конец дня класса.
  for (const u of units) {
    const cd = classDay.get(`${u.classId}:${u.dayNo}`);
    if (!cd) continue;
    if (u.parts.length > 1 && u.slotNo !== 1 && u.slotNo !== cd.last) {
      out.groupEdge.pi += 1;
      out.groupEdge.cells.push(addr(u));
    }
    if (u.priority && u.slotNo === cd.last && cd.n > 1) {
      out.firstLast.pi += 1;
      out.firstLast.cells.push(addr(u));
    }
  }
  out.groupEdge.max = Math.max(1, groupEdgeMax);
  out.firstLast.max = Math.max(1, firstLastMax);

  return out;
}

/** Π(x) = Σ wᵢ·πᵢ(x) — неотрицательное целое, предмет минимизации. */
export const totalPenalty = (pen: PenaltyVector): number =>
  QUALITY_MARKERS.reduce((a, k) => a + QUALITY_WEIGHTS[k] * pen[k].pi, 0);

/**
 * Аналитическая нижняя граница штрафа: величина, ниже которой не опускается
 * НИКАКАЯ расстановка при данной нагрузке — она следует из арифметики, а не из
 * удачи перебора.
 *
 * Без неё число «качество 88 %» нечитаемо: непонятно, это близко к пределу или
 * вдвое хуже достижимого. Граница не обязана быть достижимой (ограничения
 * взаимодействуют), поэтому она честно называется границей, а не эталоном:
 * настоящий минимум лежит между ней и найденным локальным.
 *
 * Считается по маркерам, у которых предел выводится:
 *   dayBalance / teacherBalance — самое ровное распределение H часов по d дням
 *     даёт ровно 2·r·(d−r), где r = H mod d;
 *   subjectSpread — часов предмета больше, чем дней: сгущение неизбежно;
 *   prio — приоритетных часов больше, чем ранних позиций недели;
 *   firstLast — последние уроки дней нечем закрыть, кроме приоритетных часов.
 * Для groupEdge и stability предел равен нулю: он достижим в принципе, и
 * объявлять его выше нуля значило бы занизить требование к слою.
 */
export function lowerBound(units: PlacedUnit[], ctx: QualityContext): { markers: Record<QualityMarker, number>; total: number } {
  const { days, slotsPerDay } = ctx.params;
  const half = Math.ceil(slotsPerDay / 2);
  const lb: Record<QualityMarker, number> = {
    prio: 0, subjectSpread: 0, dayBalance: 0, stability: 0, teacherBalance: 0, groupEdge: 0, firstLast: 0,
  };

  for (const c of ctx.classes) {
    const own = units.filter((u) => u.classId === c.id);
    const H = own.length;
    if (H === 0) continue;
    const cap = classDayCap(c.parallel, slotsPerDay);
    const r = H % days;
    lb.dayBalance += 2 * r * (days - r);

    const prioCount = own.filter((u) => u.priority).length;
    let excess = Math.max(0, prioCount - days * Math.min(half, cap));
    for (let pos = half + 1; pos <= cap && excess > 0; pos += 1) {
      const take = Math.min(excess, days);
      lb.prio += take * (pos - half);
      excess -= take;
    }

    const bySubject = new Map<string, number>();
    for (const u of own) bySubject.set(u.subjectId, (bySubject.get(u.subjectId) ?? 0) + 1);
    for (const h of bySubject.values()) lb.subjectSpread += Math.max(0, h - days);

    lb.firstLast += Math.max(0, Math.min(days, H) - (H - prioCount));
  }

  const byTeacher = new Map<string, number>();
  for (const u of units) for (const p of u.parts) byTeacher.set(p.teacherId, (byTeacher.get(p.teacherId) ?? 0) + 1);
  for (const h of byTeacher.values()) {
    const r = h % days;
    lb.teacherBalance += 2 * r * (days - r);
  }

  return { markers: lb, total: QUALITY_MARKERS.reduce((a, k) => a + QUALITY_WEIGHTS[k] * lb[k], 0) };
}

/**
 * Ответ панели качества `S-40`: агрегат, восемь маркеров, адреса виновных ячеек
 * и **потолок** — агрегат, который дала бы сетка, взявшая нижнюю границу по
 * каждому маркеру. Потолок показывается рядом с агрегатом: «88 % при пределе
 * 93 %» — суждение, а «88 %» — число без шкалы.
 */
export function qualityDto(pen: PenaltyVector, hasBaseline: boolean, floor?: { markers: Record<QualityMarker, number>; total: number }): ScheduleQualityDto {
  const markers = QUALITY_MARKERS.map((id: QualityMarker) => ({
    id,
    title: QUALITY_MARKER_TITLES[id],
    pi: pen[id].pi,
    max: pen[id].max,
    value: 1 - pen[id].pi / pen[id].max,
    weight: QUALITY_WEIGHTS[id],
    cells: pen[id].cells,
    // Маркер `stability` без подтверждённой сетки точки отсчёта не имеет — он
    // показывается неактивным, а не единицей: единица означала бы «расхождений
    // нет», хотя сравнивать было не с чем.
    active: id !== 'stability' || hasBaseline,
  }));
  const active = markers.filter((m) => m.active);
  const w = active.reduce((a, m) => a + m.weight, 0);
  const ceiling =
    floor === undefined || w === 0
      ? undefined
      : active.reduce((a, m) => a + m.weight * (1 - floor.markers[m.id] / pen[m.id].max), 0) / w;
  return {
    aggregate: w === 0 ? 1 : active.reduce((a, m) => a + m.weight * m.value, 0) / w,
    penalty: totalPenalty(pen),
    floor: floor?.total,
    ceiling,
    markers,
  };
}

// ─────────────────────── ходы и корректировка (AR-121, AR-122) ───────────────────────

/**
 * Окрестность N(x) — замкнутый список ходов:
 *   MOVE(u → день δ) — в первую свободную позицию класса в дне δ. Других
 *     позиций нет: по I-5 занятые позиции дня образуют префикс.
 *   SWAP(u₁, u₂) — обмен внутри одного класса. Межклассовый обмен рвёт префикс
 *     сразу у обоих, а межклассовый перенос уже покрыт ходом MOVE.
 *
 * Часы с происхождением `manual` в окрестность не входят: человек их подвинул,
 * и машина возвращать их назад не вправе (§7 спеки).
 */
export function neighbourhood(units: PlacedUnit[], ctx: QualityContext): ScheduleMove[] {
  const { days } = ctx.params;
  const out: ScheduleMove[] = [];
  const byClass = new Map<string, PlacedUnit[]>();
  for (const u of units) {
    const list = byClass.get(u.classId);
    if (list) list.push(u);
    else byClass.set(u.classId, [u]);
  }
  for (const u of units) {
    if (u.origin === 'manual') continue;
    const siblings = byClass.get(u.classId) ?? [];
    for (let d = 0; d < days; d += 1) {
      let n = 0;
      for (const s of siblings) if (s.id !== u.id && s.dayNo === d) n += 1;
      const slotNo = n + 1;
      if (u.dayNo === d && u.slotNo === slotNo) continue;
      out.push({ kind: 'move', unitId: u.id, dayNo: d, slotNo });
    }
  }
  for (const list of byClass.values()) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (list[i].origin === 'manual' || list[j].origin === 'manual') continue;
        out.push({ kind: 'swap', aId: list[i].id, bId: list[j].id });
      }
    }
  }
  return out;
}

/** Применение хода. Новая сетка — новый массив: исходная не меняется. */
export function applyMove(units: PlacedUnit[], mv: ScheduleMove, origin?: SlotOrigin): PlacedUnit[] {
  if (mv.kind === 'move') {
    return units.map((u) => (u.id === mv.unitId ? { ...u, dayNo: mv.dayNo, slotNo: mv.slotNo, origin: origin ?? u.origin } : u));
  }
  const a = units.find((u) => u.id === mv.aId);
  const b = units.find((u) => u.id === mv.bId);
  if (!a || !b) return units;
  return units.map((u) => {
    if (u.id === a.id) return { ...u, dayNo: b.dayNo, slotNo: b.slotNo, origin: origin ?? u.origin };
    if (u.id === b.id) return { ...u, dayNo: a.dayNo, slotNo: a.slotNo, origin: origin ?? u.origin };
    return u;
  });
}

/** Обратный ход существует всегда — это и есть механика «отменить» (AR-90). */
export function inverseMove(units: PlacedUnit[], mv: ScheduleMove): ScheduleMove {
  if (mv.kind === 'swap') return mv;
  const u = units.find((x) => x.id === mv.unitId);
  return { kind: 'move', unitId: mv.unitId, dayNo: u?.dayNo ?? mv.dayNo, slotNo: u?.slotNo ?? mv.slotNo };
}

export interface RepairOutcome {
  units: PlacedUnit[];
  movesApplied: number;
  penaltyBefore: number;
  penaltyAfter: number;
  /** Поиск встал в локальном минимуме, а не упёрся в бюджет. */
  localMinimum: boolean;
  trace: { move: ScheduleMove; from: number; to: number }[];
  /**
   * Маркеры, ухудшившиеся при падении общей Π, — **размен**.
   *
   * Скалярная свёртка обязана разменивать: уменьшая Π на 5·Δ по весомому
   * маркеру, она платит 2·δ по лёгкому, и это её правильное поведение, а не
   * дефект. Дефектом это становится в момент, когда размен не показан: человек
   * видит «качество выросло», а в его школе приоритетный предмет стал последним
   * уроком вдвое чаще. Поэтому размен возвращается всегда и печатается на
   * `S-42` рядом с итогом, а не прячется за агрегатом.
   */
  traded: { marker: QualityMarker; title: string; before: number; after: number }[];
}

/**
 * Автокорректировка — локальный поиск по целым штрафам.
 *
 * Завершение доказано, а не ограничено таймером: последовательность Π строго
 * убывает в ℤ≥0 и обрывается не позже чем через Π(x₀) шагов. Бюджет — потолок
 * ожидания человека; без строгого убывания он прятал бы зацикливание вместо
 * того, чтобы его исключать.
 *
 * Детерминизм: ходы перебираются в фиксированном порядке, при равенстве Π
 * побеждает первый. Иначе жалоба «после исправления стало хуже» невоспроизводима.
 */
export function repair(
  units0: PlacedUnit[],
  ctx: QualityContext,
  budget: { seconds: number; moves: number } = REPAIR_BUDGET,
  baseline?: Map<string, { dayNo: number; slotNo: number }>,
  now: () => number = Date.now,
): RepairOutcome {
  const started = now();
  const before = penalties(units0, ctx, baseline);
  const penaltyBefore = totalPenalty(before);
  let units = units0;
  let cur = penaltyBefore;
  const trace: RepairOutcome['trace'] = [];
  let localMinimum = false;

  for (let step = 0; step < budget.moves; step += 1) {
    if (now() - started > budget.seconds * 1000) break;
    let best: { move: ScheduleMove; units: PlacedUnit[]; t: number } | null = null;
    for (const mv of neighbourhood(units, ctx)) {
      const next = applyMove(units, mv, 'repaired');
      if (invariants(next, ctx).length) continue;
      const t = totalPenalty(penalties(next, ctx, baseline));
      if (t < cur && (best === null || t < best.t)) best = { move: mv, units: next, t };
    }
    if (best === null) {
      localMinimum = true;
      break;
    }
    trace.push({ move: best.move, from: cur, to: best.t });
    units = best.units;
    cur = best.t;
  }

  const after = penalties(units, ctx, baseline);
  const traded = QUALITY_MARKERS.filter((k) => after[k].pi > before[k].pi).map((k) => ({
    marker: k,
    title: QUALITY_MARKER_TITLES[k],
    before: before[k].pi,
    after: after[k].pi,
  }));

  return { units, movesApplied: trace.length, penaltyBefore, penaltyAfter: cur, localMinimum, trace, traded };
}

export interface ManualMoveVerdict {
  /** Ход нарушает жёсткий инвариант — не применяется никогда. */
  rejected: InvariantViolation[];
  penaltyBefore: number;
  penaltyAfter: number;
  /** Маркеры, ухудшившиеся ходом: ответ `MOVE_DEGRADES` требует подтверждения. */
  degraded: { marker: QualityMarker; title: string; delta: number }[];
  units: PlacedUnit[];
  inverse: ScheduleMove;
}

/**
 * Ручной ход. Три исхода, и они перечислены, а не выведены на месте:
 * нарушает жёсткое — отказ; не ухудшает Π — применяется; ухудшает — требует
 * подтверждения и ставит на час признак `manual`.
 */
export function evaluateManualMove(
  units: PlacedUnit[],
  ctx: QualityContext,
  mv: ScheduleMove,
  baseline?: Map<string, { dayNo: number; slotNo: number }>,
): ManualMoveVerdict {
  const before = penalties(units, ctx, baseline);
  const next = applyMove(units, mv, 'manual');
  const violations = invariants(next, ctx);
  const after = penalties(next, ctx, baseline);
  const degraded = QUALITY_MARKERS.filter((k) => after[k].pi > before[k].pi).map((k) => ({
    marker: k,
    title: QUALITY_MARKER_TITLES[k],
    delta: after[k].pi - before[k].pi,
  }));
  return {
    rejected: violations,
    penaltyBefore: totalPenalty(before),
    penaltyAfter: totalPenalty(after),
    degraded,
    units: next,
    inverse: inverseMove(units, mv),
  };
}

// ─────────────────────── снимок и выдача (AR-124…AR-127) ───────────────────────

export interface SnapshotMeta {
  id: string;
  templateId: string;
  version: number;
  generatedAt: string;
  classLabel: (classId: string) => string;
  subjectName: (subjectId: string) => string;
  teacherName: (teacherId: string) => string;
}

/**
 * Снимок — единственный источник для печати, файла и ссылки (AR-124). Собранные
 * тремя путями, они расходятся, и школа теряет арбитра в споре о том, что было
 * в расписании в четверг.
 */
export function buildSnapshot(units: PlacedUnit[], ctx: QualityContext, meta: SnapshotMeta): ScheduleSnapshot {
  const slots = units
    .flatMap((u) =>
      u.parts.map((p) => ({
        dayNo: u.dayNo,
        slotNo: u.slotNo,
        classId: u.classId,
        classLabel: meta.classLabel(u.classId),
        groupNo: p.groupNo === 0 ? null : p.groupNo,
        subjectName: meta.subjectName(u.subjectId),
        teacherName: meta.teacherName(p.teacherId),
        origin: u.origin,
      })),
    )
    .sort(
      (a, b) =>
        a.dayNo - b.dayNo ||
        a.slotNo - b.slotNo ||
        a.classId.localeCompare(b.classId) ||
        (a.groupNo ?? 0) - (b.groupNo ?? 0),
    );
  return { id: meta.id, templateId: meta.templateId, version: meta.version, generatedAt: meta.generatedAt, params: ctx.params, slots };
}

/**
 * Каноническая форма снимка. Порядок полей фиксирован явно: `JSON.stringify` по
 * порядку вставки сделал бы подпись зависящей от того, как объект собрали, и
 * ссылка перестала бы проверяться после безобидной правки кода.
 */
export function canonicalSnapshot(snap: ScheduleSnapshot): string {
  const slots = snap.slots.map((s) =>
    [s.dayNo, s.slotNo, s.classId, s.classLabel, s.groupNo ?? 0, s.subjectName, s.teacherName].join(''),
  );
  return [snap.id, snap.templateId, String(snap.version), JSON.stringify(snap.params), ...slots].join('');
}

/**
 * Подпись ссылки. Версия сетки входит в подписываемую строку, поэтому
 * публикация новой версии обрывает старую ссылку сама — без отдельной операции
 * отзыва и без обращения к БД при проверке (AR-125, AR-127).
 */
export function signSnapshot(snap: ScheduleSnapshot, scope: ShareScope, targetId: string, expiresAt: string, secret: string): string {
  return createHmac('sha256', secret)
    .update([canonicalSnapshot(snap), scope, targetId, expiresAt].join(''))
    .digest('base64url')
    .slice(0, 32);
}

/** Отбор слотов по области ссылки: `teacher` не выдаёт сетку других педагогов. */
export function scopeSlots(snap: ScheduleSnapshot, scope: ShareScope, targetId: string): ScheduleSnapshot['slots'] {
  if (scope === 'school') return snap.slots;
  if (scope === 'class') return snap.slots.filter((s) => s.classId === targetId);
  return snap.slots.filter((s) => s.teacherName === targetId);
}

/** Печатная проекция: строки — позиции дня, столбцы — дни недели. */
export function projectGrid(snap: ScheduleSnapshot, scope: ShareScope, targetId: string): string[][] {
  const slots = scopeSlots(snap, scope, targetId);
  const rows: string[][] = [];
  for (let s = 1; s <= snap.params.slotsPerDay; s += 1) {
    const row = [String(s)];
    for (let d = 0; d < snap.params.days; d += 1) {
      const cell = slots.filter((x) => x.dayNo === d && x.slotNo === s);
      row.push(cell.map((c) => (c.groupNo ? `${c.subjectName} (гр. ${c.groupNo})` : c.subjectName)).join(' / '));
    }
    rows.push(row);
  }
  return rows;
}

const DAY_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const ICS_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** CSV: UTF-8 с BOM и разделителем `;` — иначе таблица открывается одной колонкой. */
export function projectCsv(snap: ScheduleSnapshot, scope: ShareScope, targetId: string): string {
  const header = ['Урок', ...DAY_NAMES.slice(0, snap.params.days)];
  const rows = projectGrid(snap, scope, targetId);
  const esc = (v: string) => (v.includes(';') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v);
  return '﻿' + [header, ...rows].map((r) => r.map(esc).join(';')).join('\r\n') + '\r\n';
}

/**
 * ICS (RFC 5545, базис #15): шаблон недели выражается ОДНИМ правилом повтора на
 * слот, а не списком уроков. Список ломается при сдвиге четверти, правило — нет;
 * нерабочие дни уходят в `EXDATE` из календаря (AR-100).
 */
export function projectIcs(
  snap: ScheduleSnapshot,
  scope: ShareScope,
  targetId: string,
  args: { firstMonday: string; until: string; exdates: string[]; startMinutes: number },
): string {
  const slots = scopeSlots(snap, scope, targetId);
  const pad = (n: number) => String(n).padStart(2, '0');
  const at = (slotNo: number, offset: number): string => {
    const total = args.startMinutes + offset + (slotNo - 1) * (snap.params.lessonMin + snap.params.breakMin);
    return `${pad(Math.floor(total / 60))}${pad(total % 60)}00`;
  };
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EduStore//Schoolium//RU', 'CALSCALE:GREGORIAN'];
  for (const s of slots) {
    const day = shiftDate(args.firstMonday, s.dayNo);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${snap.id}-${s.dayNo}-${s.slotNo}-${s.classId}-${s.groupNo ?? 0}@schoolium`,
      `DTSTART:${day}T${at(s.slotNo, 0)}`,
      `DTEND:${day}T${at(s.slotNo, snap.params.lessonMin)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${ICS_DAYS[s.dayNo]};UNTIL=${args.until}`,
      ...(args.exdates.length ? [`EXDATE:${args.exdates.map((d) => `${d}T${at(s.slotNo, 0)}`).join(',')}`] : []),
      `SUMMARY:${s.subjectName}${s.groupNo ? ` (гр. ${s.groupNo})` : ''} — ${s.classLabel}`,
      `DESCRIPTION:${s.teacherName}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/** Сдвиг даты `YYYYMMDD` на `days` суток — без зависимостей и без часовых поясов. */
function shiftDate(yyyymmdd: string, days: number): string {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10).replace(/-/g, '');
}

/** Перечень форматов для отказа `EXPORT_FORMAT_UNSUPPORTED`. */
export const isExportFormat = (v: string): v is ExportFormat => v === 'csv' || v === 'ics';
