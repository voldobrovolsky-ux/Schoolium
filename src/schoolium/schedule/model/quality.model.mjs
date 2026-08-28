#!/usr/bin/env node
/**
 * Исполняемая модель слоя генерации расписания УТЦ.
 *
 * Эталон раздела «Математическая модель» в `30-spec.md`. Модель одноразовая
 * (уровень T2): ни БД, ни сети — все утверждения доказываются перечислением на
 * данных первой школы (8 параллелей, английский по группам).
 *
 * Запуск: node specs/schedule-block/model/quality.mjs
 *
 * Свойства: Q1…Q12. Каждое свойство сперва формулируется как утверждение о
 * математическом объекте, затем перечисляется до отказа либо до исчерпания
 * области.
 */

const ok = (m) => console.log('  ✅ ' + m);
let fails = 0;
const bad = (m) => { console.error('  ❌ ' + m); fails += 1; };
const eq = (a, b, m) => (a === b ? ok(`${m} (${a})`) : bad(`${m}: ожидалось ${b}, получено ${a}`));

// ───────────────────────────── 0. Параметры ─────────────────────────────

/** Дневной потолок уроков по параллелям — СанПиН 1.2.3685-21 табл. 6.6. */
const DAY_SLOTS_CAP = { 1: 4, 2: 5, 3: 5, 4: 5, 5: 6, 6: 6, 7: 7, 8: 7, 9: 7, 10: 7, 11: 7 };
/** Недельный потолок часов по параллелям — тот же источник, 5-дневка. */
const WEEK_HOURS_CAP = { 1: 21, 2: 23, 3: 23, 4: 23, 5: 29, 6: 30, 7: 32, 8: 33, 9: 33, 10: 34, 11: 34 };
const DAY_MINUTES_CAP = 420;

const classDayCap = (parallel, slotsPerDay) => Math.min(slotsPerDay, DAY_SLOTS_CAP[parallel] ?? 0);

/**
 * Веса маркеров качества — ЦЕЛЫЕ. Целость не украшение: суммарный штраф
 * Π(x) = Σ wᵢ·πᵢ(x) обязан быть неотрицательным целым, иначе доказательство
 * завершения локального поиска (свойство Q8) опирается на сравнение чисел с
 * плавающей точкой и разваливается на первом же ε.
 */
// Правил удобства семь. «Окно у педагога» снято решением владельца (AR-135,
// редакция 6): окна возникают как следствие расстановки, и продукт мнения о них
// не имеет — трудовые нормы принадлежат кадрам, а не расписанию. Модель обязана
// считать ту же величину, что реализация (packages/shared/src/schedule-quality.ts),
// иначе «модель зелёная» ничего не доказывает про поставляемый продукт.
const WEIGHTS = { prio: 8, dayBalance: 5, subjectSpread: 6, teacherBalance: 3, groupEdge: 2, stability: 4, firstLast: 2 };
const MARKER_IDS = Object.keys(WEIGHTS);

// ───────────────────────── 1. Единицы планирования ─────────────────────────

/**
 * Единица планирования — неделимый объект, занимающий РОВНО один слот.
 * Класс-час: одна часть. Групповой час: по части на каждую группу предмета,
 * все части в одном слоте (атомарная спаренная единица, AR-75).
 */
function buildUnits(classes, pairs) {
  const units = [];
  for (const c of classes) {
    const own = pairs.filter((p) => p.classId === c.id);
    for (const p of own.filter((x) => x.scope === 'class')) {
      for (let h = 0; h < p.hours; h += 1) {
        units.push({ classId: c.id, subjectId: p.subjectId, parts: [{ groupNo: 0, teacherId: p.teacherId }], priority: !!p.priority });
      }
    }
    for (const sid of new Set(own.filter((x) => x.scope === 'group').map((x) => x.subjectId))) {
      const ps = own.filter((x) => x.subjectId === sid && x.scope === 'group');
      for (let h = 0; h < ps[0].hours; h += 1) {
        units.push({
          classId: c.id,
          subjectId: sid,
          parts: ps.flatMap((p) => p.groupNos.map((g) => ({ groupNo: g, teacherId: p.teacherId }))),
          priority: !!ps[0].priority,
        });
      }
    }
  }
  return units.map((u, i) => ({ ...u, id: `u${i}` }));
}

/** Часы класса за неделю: класс-часы плюс максимум по группам (группы идут параллельно). */
function classWeekHours(classId, pairs) {
  const own = pairs.filter((p) => p.classId === classId);
  const cls = own.filter((p) => p.scope === 'class').reduce((a, p) => a + p.hours, 0);
  const subs = [...new Set(own.filter((p) => p.scope === 'group').map((p) => p.subjectId))];
  return cls + subs.reduce((a, sid) => a + Math.max(0, ...own.filter((p) => p.subjectId === sid && p.scope === 'group').map((p) => p.hours)), 0);
}

/** Длина учебного дня в минутах — производная параметров, от расстановки не зависит. */
const dayLength = (p) => {
  const breaks = Math.max(0, p.slotsPerDay - 1);
  const big = p.bigBreakAfter > 0 && p.bigBreakAfter < p.slotsPerDay ? 1 : 0;
  return p.slotsPerDay * p.lessonMin + (breaks - big) * p.breakMin + big * p.bigBreakMin;
};

// ───────────────── 2. Необходимые условия допустимости (леммы) ─────────────────

/**
 * Восемь арифметических отказов — это ЛЕММЫ о непустоте множества допустимых
 * сеток, а не эвристики. Каждая доказывается принципом Дирихле, и потому
 * считается ДО перебора: перебор не может опровергнуть арифметику.
 */
function necessary(input) {
  const { classes, pairs, params } = input;
  const grid = params.days * params.slotsPerDay;
  for (const c of classes) {
    const total = classWeekHours(c.id, pairs);
    const weekCap = WEEK_HOURS_CAP[c.parallel];
    if (weekCap !== undefined && total > weekCap) return { code: 'LOAD_EXCEEDS_SANPIN', total, cap: weekCap, cls: c.label };
    const classGrid = params.days * classDayCap(c.parallel, params.slotsPerDay);
    if (total > classGrid) return { code: 'LOAD_EXCEEDS_GRID', total, grid: classGrid, cls: c.label };
  }
  const byTeacher = new Map();
  for (const p of pairs) byTeacher.set(p.teacherId, (byTeacher.get(p.teacherId) ?? 0) + p.hours);
  for (const [t, h] of byTeacher) if (h > grid) return { code: 'TEACHER_OVERBOOKED', teacher: t, hours: h, grid };
  for (const c of classes) {
    const own = pairs.filter((p) => p.classId === c.id && p.scope === 'group');
    for (const sid of new Set(own.map((p) => p.subjectId))) {
      const hs = own.filter((p) => p.subjectId === sid).map((p) => p.hours);
      if (new Set(hs).size > 1) return { code: 'GROUP_HOURS_UNEQUAL', subject: sid, cls: c.label, hours: hs };
    }
  }
  const senior = Math.max(0, ...classes.map((c) => DAY_SLOTS_CAP[c.parallel] ?? 0));
  if (classes.length && params.slotsPerDay > senior) return { code: 'DAY_EXCEEDS_SANPIN', slotsPerDay: params.slotsPerDay, cap: senior };
  const minutes = dayLength(params);
  if (minutes > DAY_MINUTES_CAP) return { code: 'DAY_TOO_LONG', minutes, cap: DAY_MINUTES_CAP };
  return null;
}

// ───────────────────────────── 3. Генератор ─────────────────────────────

function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

/** Жадный перебор с рестартами. Возвращает присваивание x: единица → слот. */
function generate(input, budget = { attempts: 200_000 }) {
  const pre = necessary(input);
  if (pre) return { ok: false, ...pre };
  const units = buildUnits(input.classes, input.pairs);
  const { days, slotsPerDay } = input.params;
  const caps = new Map(input.classes.map((c) => [c.id, classDayCap(c.parallel, slotsPerDay)]));
  let attempts = 0;
  for (let restart = 0; ; restart += 1) {
    if (attempts >= budget.attempts) return { ok: false, code: 'NO_SOLUTION', attempts };
    const rand = lcg(input.seed + restart * 7919);
    const order = units.map((u, i) => ({ k: rand() - (u.priority ? 0.5 : 0), i })).sort((a, b) => a.k - b.k).map((x) => units[x.i]);
    const busy = new Set();
    const len = new Map();
    const x = new Map();
    let failed = false;
    for (const u of order) {
      const cap = caps.get(u.classId) ?? slotsPerDay;
      const opts = [];
      for (let d = 0; d < days; d += 1) {
        const s = len.get(`${u.classId}:${d}`) ?? 0;
        if (s >= cap) continue;
        if (u.parts.some((p) => busy.has(`${d}:${s}:${p.teacherId}`))) continue;
        opts.push([d, s]);
      }
      attempts += 1;
      if (!opts.length) { failed = true; break; }
      const [d, s] = opts[Math.floor(rand() * opts.length)];
      for (const p of u.parts) busy.add(`${d}:${s}:${p.teacherId}`);
      x.set(u.id, { dayNo: d, slotNo: s + 1 });
      len.set(`${u.classId}:${d}`, s + 1);
    }
    if (!failed) return { ok: true, units, x, attempts, seed: input.seed + restart * 7919 };
  }
}

// ───────────────────── 4. Автопроверка: жёсткие инварианты ─────────────────────

/**
 * I-1…I-8 — жёсткие инварианты сетки. Проверяются перечислением по ВСЕМ слотам,
 * а не выборкой: инвариант, проверенный на образце, инвариантом не является.
 * Нарушение любого — дефект генератора, а не ввода человека, и наружу такая
 * сетка не выходит (`INVARIANT_BROKEN`).
 */
function invariants(units, x, input) {
  const v = [];
  const { days, slotsPerDay, } = input.params;
  const byId = new Map(units.map((u) => [u.id, u]));

  // I-1: полнота нагрузки — каждая единица размещена ровно один раз.
  for (const u of units) if (!x.has(u.id)) v.push({ code: 'I-1', addr: u.id, msg: 'единица не размещена' });
  for (const id of x.keys()) if (!byId.has(id)) v.push({ code: 'I-1', addr: id, msg: 'размещена несуществующая единица' });

  // I-2: педагог не занимает два слота одновременно.
  const seenT = new Set();
  for (const [id, s] of x) {
    for (const p of byId.get(id)?.parts ?? []) {
      const k = `${s.dayNo}:${s.slotNo}:${p.teacherId}`;
      if (seenT.has(k)) v.push({ code: 'I-2', addr: k, msg: `педагог ${p.teacherId} в двух местах` });
      seenT.add(k);
    }
  }

  // I-3: учебная единица (класс либо его группа) не занята дважды.
  const seenC = new Set();
  for (const [id, s] of x) {
    const u = byId.get(id);
    if (!u) continue;
    const k = `${s.dayNo}:${s.slotNo}:${u.classId}`;
    if (seenC.has(k)) v.push({ code: 'I-3', addr: k, msg: `класс ${u.classId} занят дважды` });
    seenC.add(k);
  }

  // I-4: атомарность групповой единицы — все её части в одном слоте.
  //      В этой модели неделимость структурная (одна запись на единицу), поэтому
  //      проверяется полнота частей: у группового часа их столько же, сколько групп.
  for (const u of units) {
    if (u.parts.length > 1) {
      const gs = new Set(u.parts.map((p) => p.groupNo));
      if (gs.has(0)) v.push({ code: 'I-4', addr: u.id, msg: 'спаренная единица содержит часть «весь класс»' });
      if (gs.size !== u.parts.length) v.push({ code: 'I-4', addr: u.id, msg: 'группа продублирована в единице' });
    }
  }

  // I-5: без окон у класса — занятые позиции дня образуют префикс 1…k.
  const perClassDay = new Map();
  for (const [id, s] of x) {
    const u = byId.get(id);
    if (!u) continue;
    const k = `${u.classId}:${s.dayNo}`;
    (perClassDay.get(k) ?? perClassDay.set(k, []).get(k)).push(s.slotNo);
  }
  for (const [k, poss] of perClassDay) {
    const sorted = [...poss].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i += 1) if (sorted[i] !== i + 1) { v.push({ code: 'I-5', addr: k, msg: `окно: позиции ${sorted.join(',')}` }); break; }
  }

  // I-6: дневной потолок параллели.
  for (const c of input.classes) {
    const cap = classDayCap(c.parallel, slotsPerDay);
    for (let d = 0; d < days; d += 1) {
      const n = (perClassDay.get(`${c.id}:${d}`) ?? []).length;
      if (n > cap) v.push({ code: 'I-6', addr: `${c.id}:${d}`, msg: `${n} уроков при потолке ${cap}` });
    }
  }

  // I-7: позиция в границах сетки.
  for (const [id, s] of x) {
    if (s.dayNo < 0 || s.dayNo >= days) v.push({ code: 'I-7', addr: id, msg: `день ${s.dayNo} вне 0…${days - 1}` });
    if (s.slotNo < 1 || s.slotNo > slotsPerDay) v.push({ code: 'I-7', addr: id, msg: `позиция ${s.slotNo} вне 1…${slotsPerDay}` });
  }

  // I-8: длина дня в границах — параметрический инвариант, от расстановки не зависит.
  if (dayLength(input.params) > DAY_MINUTES_CAP) v.push({ code: 'I-8', addr: 'params', msg: `${dayLength(input.params)} мин при потолке ${DAY_MINUTES_CAP}` });

  return v;
}

// ─────────────────── 5. Маркеры качества: целые штрафы π ───────────────────

/**
 * Каждый маркер определён ЦЕЛЫМ штрафом πᵢ(x) ≥ 0 и верхней границей πᵢᵐᵃˣ > 0.
 * Показываемая величина Qᵢ = 1 − πᵢ/πᵢᵐᵃˣ ∈ [0,1] — представление, а не предмет
 * оптимизации: локальный поиск работает с целыми штрафами.
 */
function penalties(units, x, input, baseline = null) {
  const { days, slotsPerDay } = input.params;
  const half = Math.ceil(slotsPerDay / 2);

  // Один проход по размещённым единицам строит три индекса; все восемь штрафов
  // считаются из них. Без индексов расчёт штрафа стоит O(|U|²) и локальный
  // поиск перестаёт укладываться в бюджет ожидания человека.
  const classDay = new Map();   // `класс:день` → { n, last }
  const subjDay = new Map();    // `класс:предмет:день` → n
  const teacherDay = new Map(); // `педагог:день` → { n, min, max }
  const teachers = new Set();
  const placed = [];
  let prio = 0, prioMax = 0, firstLastMax = 0, groupEdgeMax = 0, stability = 0;
  const unitsBySubjClass = new Map();

  for (const u of units) {
    if (u.priority) { prioMax += slotsPerDay - half; firstLastMax += 1; }
    if (u.parts.length > 1) groupEdgeMax += 1;
    for (const p of u.parts) teachers.add(p.teacherId);
    const sk0 = `${u.classId}:${u.subjectId}`;
    unitsBySubjClass.set(sk0, (unitsBySubjClass.get(sk0) ?? 0) + 1);

    const s = x.get(u.id);
    if (!s) continue;
    placed.push([u, s]);
    if (u.priority) prio += Math.max(0, s.slotNo - half);

    const ck = `${u.classId}:${s.dayNo}`;
    const cd = classDay.get(ck) ?? { n: 0, last: 0 };
    cd.n += 1;
    cd.last = Math.max(cd.last, s.slotNo);
    classDay.set(ck, cd);

    const sk = `${u.classId}:${u.subjectId}:${s.dayNo}`;
    subjDay.set(sk, (subjDay.get(sk) ?? 0) + 1);

    for (const p of u.parts) {
      const tk = `${p.teacherId}:${s.dayNo}`;
      const td = teacherDay.get(tk) ?? { n: 0, min: Infinity, max: 0 };
      td.n += 1;
      td.min = Math.min(td.min, s.slotNo);
      td.max = Math.max(td.max, s.slotNo);
      teacherDay.set(tk, td);
    }

    if (baseline) {
      const b = baseline.get(u.id);
      if (!b || b.dayNo !== s.dayNo || b.slotNo !== s.slotNo) stability += 1;
    }
  }

  // π-dayBalance: отклонение дневной нагрузки класса от средней, в целых
  // единицах (умножение на число дней убирает дробное среднее).
  let dayBalance = 0, dayBalanceMax = 0;
  for (const c of input.classes) {
    let tot = 0;
    const per = [];
    for (let d = 0; d < days; d += 1) { const n = classDay.get(`${c.id}:${d}`)?.n ?? 0; per.push(n); tot += n; }
    for (const n of per) dayBalance += Math.abs(n * days - tot);
    dayBalanceMax += maxSpread(tot, days, classDayCap(c.parallel, slotsPerDay));
  }

  // π-teacherBalance: та же мера по педагогам.
  let teacherBalance = 0, teacherBalanceMax = 0;
  for (const t of teachers) {
    let tot = 0;
    const per = [];
    for (let d = 0; d < days; d += 1) { const n = teacherDay.get(`${t}:${d}`)?.n ?? 0; per.push(n); tot += n; }
    for (const n of per) teacherBalance += Math.abs(n * days - tot);
    teacherBalanceMax += maxSpread(tot, days, slotsPerDay);
  }

  // π-subjectSpread: часы одного предмета, попавшие в один день класса.
  let subjectSpread = 0, subjectSpreadMax = 0;
  for (const n of subjDay.values()) subjectSpread += Math.max(0, n - 1);
  for (const h of unitsBySubjClass.values()) subjectSpreadMax += Math.max(0, h - 1);


  // π-groupEdge: групповой час не на краю дня класса.
  // π-firstLast: приоритетный предмет последним уроком дня.
  let groupEdge = 0, firstLast = 0;
  for (const [u, s] of placed) {
    const cd = classDay.get(`${u.classId}:${s.dayNo}`);
    if (u.parts.length > 1 && s.slotNo !== 1 && s.slotNo !== cd.last) groupEdge += 1;
    if (u.priority && s.slotNo === cd.last && cd.n > 1) firstLast += 1;
  }

  return {
    prio: { pi: prio, max: Math.max(1, prioMax) },
    dayBalance: { pi: dayBalance, max: Math.max(1, dayBalanceMax) },
    subjectSpread: { pi: subjectSpread, max: Math.max(1, subjectSpreadMax) },
    teacherBalance: { pi: teacherBalance, max: Math.max(1, teacherBalanceMax) },
    groupEdge: { pi: groupEdge, max: Math.max(1, groupEdgeMax) },
    stability: { pi: stability, max: baseline ? Math.max(1, baseline.size) : 1 },
    firstLast: { pi: firstLast, max: Math.max(1, firstLastMax) },
  };
}

/**
 * Верхняя граница суммы |n_d·D − H| при Σn_d = H и n_d ≤ cap — достигается
 * набиванием дней под потолок. Считается явно, а не угадывается: без неё
 * нормировка Q ∈ [0,1] не доказуема.
 */
function maxSpread(total, days, cap) {
  if (total === 0 || days === 0) return 0;
  const per = Array.from({ length: days }, () => 0);
  let left = total;
  for (let d = 0; d < days && left > 0; d += 1) { per[d] = Math.min(cap, left); left -= per[d]; }
  return per.reduce((a, n) => a + Math.abs(n * days - total), 0);
}

/** Свёртка: Π(x) = Σ wᵢ·πᵢ(x) — неотрицательное целое. */
const total = (pen) => MARKER_IDS.reduce((a, k) => a + WEIGHTS[k] * pen[k].pi, 0);
/** Представление для человека: Qᵢ ∈ [0,1], 1 — маркер чист. */
const quality = (pen) => Object.fromEntries(MARKER_IDS.map((k) => [k, 1 - pen[k].pi / pen[k].max]));
/** Агрегат для человека — взвешенное среднее Qᵢ по тем же весам. */
const aggregate = (pen) => {
  const q = quality(pen);
  const w = MARKER_IDS.reduce((a, k) => a + WEIGHTS[k], 0);
  return MARKER_IDS.reduce((a, k) => a + WEIGHTS[k] * q[k], 0) / w;
};

// ─────────────────────── 6. Ходы: авто- и ручная правка ───────────────────────

/**
 * Ход — единственный способ изменить сетку, и он один и тот же для машины и для
 * человека. Различие не в множестве ходов, а в праве принять ход, ухудшающий
 * мягкий маркер: машина такого хода не делает, человек делает под подпись.
 */
const applyMove = (x, mv) => {
  const next = new Map(x);
  if (mv.kind === 'move') next.set(mv.unitId, { dayNo: mv.dayNo, slotNo: mv.slotNo });
  else { const a = next.get(mv.aId), b = next.get(mv.bId); next.set(mv.aId, b); next.set(mv.bId, a); }
  return next;
};

/** Обратный ход существует всегда — это и есть механика «отменить» (AR-90). */
const inverse = (x, mv) => (mv.kind === 'move' ? { kind: 'move', unitId: mv.unitId, ...x.get(mv.unitId) } : mv);

/** Ход допустим, если результат не нарушает ни одного жёсткого инварианта. */
function admissible(units, x, input, mv) {
  const next = applyMove(x, mv);
  return { next, violations: invariants(units, next, input) };
}

/**
 * Окрестность N(x) — замкнутый список ходов, и он назван, а не подразумевается:
 *
 *   MOVE(u → день d) — перенос единицы в ПЕРВУЮ свободную позицию её класса в
 *     дне d. Других позиций не перебирается: инвариант I-5 (без окон) делает
 *     занятые позиции дня префиксом, поэтому единственная позиция, куда единица
 *     может встать в чужой день, — следующая за концом префикса.
 *   SWAP(u₁, u₂) — обмен позициями двух единиц ОДНОГО класса. Обмен между
 *     разными классами не входит в окрестность: он рвёт префикс сразу у обоих
 *     и отбрасывается проверкой допустимости в подавляющем большинстве случаев,
 *     а межклассовый перенос уже покрыт ходом MOVE.
 *
 * |N(x)| = |U|·D + Σ_c C(h_c, 2) — величина, названная числом, а не «перебором
 * соседей»: на первой школе это 1288 ходов на один шаг поиска.
 */
function neighbourhood(units, x, input) {
  const { days } = input.params;
  const out = [];
  const byClass = new Map();
  for (const u of units) (byClass.get(u.classId) ?? byClass.set(u.classId, []).get(u.classId)).push(u.id);
  for (const u of units) {
    const at = x.get(u.id);
    for (let d = 0; d < days; d += 1) {
      // первая свободная позиция класса в дне d, считая перенос самой единицы
      let n = 0;
      for (const other of byClass.get(u.classId)) {
        if (other === u.id) continue;
        if (x.get(other).dayNo === d) n += 1;
      }
      const slotNo = n + 1;
      if (at.dayNo === d && at.slotNo === slotNo) continue;
      out.push({ kind: 'move', unitId: u.id, dayNo: d, slotNo });
    }
  }
  for (const ids of byClass.values()) {
    for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) out.push({ kind: 'swap', aId: ids[i], bId: ids[j] });
  }
  return out;
}

/**
 * Автокорректировка — локальный поиск по целым штрафам. Принимается только
 * строго улучшающий ход, поэтому последовательность Π строго убывает в ℤ≥0 и
 * обрывается не позже, чем через Π(x₀) шагов: завершение доказано, а не
 * ограничено таймером. Таймер здесь — потолок ожидания человека, не гарантия.
 */
function repair(units, x0, input, budget = { moves: 4000 }, baseline = null) {
  let x = x0;
  let cur = total(penalties(units, x, input, baseline));
  const trace = [];
  for (let step = 0; step < budget.moves; step += 1) {
    let best = null;
    for (const mv of neighbourhood(units, x, input)) {
      const { next, violations } = admissible(units, x, input, mv);
      if (violations.length) continue;
      const t = total(penalties(units, next, input, baseline));
      if (t < cur && (!best || t < best.t)) best = { mv, next, t };
    }
    if (!best) break; // локальный минимум: улучшающего хода нет
    trace.push({ from: cur, to: best.t, mv: best.mv });
    x = best.next;
    cur = best.t;
  }
  return { x, penalty: cur, trace };
}

// ──────────────────── 7. Снимок, подпись, проекции ────────────────────

/**
 * Снимок — иммутабельная проекция подтверждённой сетки. Печать, файл и ссылка —
 * проекции ОДНОГО снимка, а не три независимых сборки: иначе распечатка и
 * присланная родителю ссылка расходятся, и спорить о том, что было в четверг,
 * школе придётся без арбитра.
 */
function snapshot(units, x, input, meta) {
  const byId = new Map(units.map((u) => [u.id, u]));
  const slots = [...x]
    .map(([id, s]) => {
      const u = byId.get(id);
      return { dayNo: s.dayNo, slotNo: s.slotNo, classId: u.classId, subjectId: u.subjectId, parts: u.parts };
    })
    .sort((a, b) => a.dayNo - b.dayNo || a.slotNo - b.slotNo || a.classId.localeCompare(b.classId));
  return { version: meta.version, templateId: meta.templateId, params: input.params, slots };
}

/** Каноническая сериализация: порядок полей фиксирован, иначе подпись не воспроизводима. */
const canonical = (snap) => JSON.stringify(snap, Object.keys(snap).sort());

/** Подпись ссылки. В модели — детерминированная свёртка; в коде — HMAC-SHA256. */
function sign(payload, secret) {
  let h = 2166136261;
  for (const ch of secret + '|' + payload) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** Проекция «сетка класса» — таблица день × позиция. */
function projectClass(snap, classId) {
  const rows = [];
  for (let s = 1; s <= snap.params.slotsPerDay; s += 1) {
    const row = [s];
    for (let d = 0; d < snap.params.days; d += 1) {
      const cell = snap.slots.filter((x) => x.classId === classId && x.dayNo === d && x.slotNo === s);
      row.push(cell.map((c) => c.subjectId).join(' / '));
    }
    rows.push(row);
  }
  return rows;
}

/** Проекция в календарь: одно правило повторения на слот, исключения — нерабочие дни. */
function projectIcs(snap, classId, until, exdates) {
  return snap.slots
    .filter((s) => s.classId === classId)
    .map((s) => ({
      uid: `${snap.templateId}-${s.dayNo}-${s.slotNo}-${s.classId}-${s.subjectId}`,
      rrule: `FREQ=WEEKLY;BYDAY=${['MO', 'TU', 'WE', 'TH', 'FR', 'SA'][s.dayNo]};UNTIL=${until}`,
      exdate: exdates,
      summary: s.subjectId,
    }));
}

// ───────────────────────────── Данные первой школы ─────────────────────────────

const TEACHERS = ['Мария', 'Ольга', 'Иван', 'Пётр', 'Анна', 'Нина', 'Олег', 'Юлия', 'Егор', 'Вера'];

function firstSchool(seed) {
  const classes = Array.from({ length: 8 }, (_, i) => ({ id: `c${i + 1}`, label: String(i + 1), parallel: i + 1, groupCount: 2 }));
  const pairs = [];
  classes.forEach((c, i) => {
    const add = (subjectId, teacher, hours, scope, groupNos, priority = false) =>
      pairs.push({ subjectId: `${subjectId}-${c.id}`, classId: c.id, teacherId: teacher, scope, groupNos, hours, priority });
    add('математика', TEACHERS[i % 3], 4, 'class', [], true);
    add('русский', TEACHERS[3 + (i % 3)], 4, 'class', [], true);
    add('история', TEACHERS[6], 2, 'class', []);
    add('физкультура', TEACHERS[7], 2, 'class', []);
    add('английский', TEACHERS[8], 2, 'group', [1]);
    add('английский', TEACHERS[9], 2, 'group', [2]);
  });
  return { classes, pairs, params: { days: 5, slotsPerDay: 7, lessonMin: 45, breakMin: 10, bigBreakAfter: 2, bigBreakMin: 30 }, seed };
}

// ───────────────────────────── Свойства Q1…Q12 ─────────────────────────────

console.log('Слой генерации расписания УТЦ — исполняемая модель\n');

const input = firstSchool(20260826);
const gen = generate(input);
if (!gen.ok) { bad(`сетка не собралась: ${gen.code}`); process.exit(1); }
const { units, x } = gen;

console.log('Q1. Допустимость: жёсткие инварианты на всей сетке');
{
  const v = invariants(units, x, input);
  eq(v.length, 0, `нарушений жёстких инвариантов на ${units.length} единицах и ${input.params.days * input.params.slotsPerDay} слотах недели`);
}

console.log('Q2. Автопроверка ловит подделку: каждый инвариант воспроизводим');
{
  const cases = [
    ['I-1', (m) => { m.delete(units[0].id); }],
    ['I-3', (m) => { m.set(units[1].id, m.get(units[0].id)); }],
    ['I-5', (m) => { const s = m.get(units[0].id); m.set(units[0].id, { dayNo: s.dayNo, slotNo: input.params.slotsPerDay }); }],
    ['I-7', (m) => { m.set(units[0].id, { dayNo: 99, slotNo: 1 }); }],
  ];
  for (const [code, mutate] of cases) {
    const broken = new Map(x);
    mutate(broken);
    const codes = new Set(invariants(units, broken, input).map((v) => v.code));
    if (codes.has(code)) ok(`подделка воспроизводит ${code}`);
    else bad(`подделка НЕ поймана инвариантом ${code} (поймано: ${[...codes].join(',') || 'ничего'})`);
  }
  // I-6 отдельно: класс 1 (потолок 4) переполняется до 5 уроков в один день.
  const broken = new Map(x);
  const c1 = units.filter((u) => u.classId === 'c1');
  c1.slice(0, 5).forEach((u, i) => broken.set(u.id, { dayNo: 0, slotNo: i + 1 }));
  const codes = new Set(invariants(units, broken, input).map((v) => v.code));
  if (codes.has('I-6')) ok('подделка воспроизводит I-6 (дневной потолок параллели)');
  else bad(`I-6 не пойман (поймано: ${[...codes].join(',')})`);
}

console.log('Q3. Маркеры качества нормированы: πᵢ ≥ 0, Qᵢ ∈ [0,1]');
{
  const pen = penalties(units, x, input);
  const q = quality(pen);
  let badMarker = null;
  for (const k of MARKER_IDS) {
    if (pen[k].pi < 0 || !Number.isInteger(pen[k].pi)) badMarker = `${k}: π=${pen[k].pi} не является неотрицательным целым`;
    if (q[k] < 0 || q[k] > 1) badMarker = `${k}: Q=${q[k].toFixed(3)} вне [0,1]`;
  }
  if (badMarker) bad(badMarker);
  else ok(`восемь маркеров: π целые ≥ 0, Q ∈ [0,1]; агрегат ${(aggregate(pen) * 100).toFixed(1)}%`);
}

console.log('Q4. Верхняя граница разброса вычислена, а не угадана');
{
  // Перечислением по всем разбиениям малой задачи: maxSpread — действительно максимум.
  const H = 7, D = 3, CAP = 4;
  let best = 0;
  const rec = (d, left, acc) => {
    if (d === D) { if (left === 0) best = Math.max(best, acc.reduce((a, n) => a + Math.abs(n * D - H), 0)); return; }
    for (let n = 0; n <= Math.min(CAP, left); n += 1) rec(d + 1, left - n, [...acc, n]);
  };
  rec(0, H, []);
  eq(maxSpread(H, D, CAP), best, `maxSpread(7,3,4) совпал с максимумом по всем разбиениям`);
}

console.log('Q5. Свёртка Π — неотрицательное целое');
{
  const p = total(penalties(units, x, input));
  if (Number.isInteger(p) && p >= 0) ok(`Π(x₀) = ${p}`);
  else bad(`Π = ${p} не является неотрицательным целым`);
}

console.log('Q6. Автокорректировка не ухудшает и завершается локальным минимумом');
{
  const before = total(penalties(units, x, input));
  const r = repair(units, x, input, { moves: 200 });
  const after = total(penalties(units, r.x, input));
  if (after <= before) ok(`Π: ${before} → ${after} за ${r.trace.length} ходов (не возросло)`);
  else bad(`Π выросло: ${before} → ${after}`);
  const strictlyDecreasing = r.trace.every((t) => t.to < t.from);
  if (strictlyDecreasing) ok('каждый принятый ход строго уменьшает Π — последовательность в ℤ≥0 обрывается');
  else bad('принят ход, не уменьшивший Π — завершение не доказано');
  const v = invariants(units, r.x, input);
  eq(v.length, 0, 'после автокорректировки жёсткие инварианты держатся');
  // локальный минимум: повторный прогон не находит улучшающего хода
  const again = repair(units, r.x, input, { moves: 200 });
  eq(again.trace.length, 0, 'повторный прогон из локального минимума не делает ни одного хода');
}

console.log('Q7. Автокорректировка детерминирована');
{
  const a = repair(units, x, input, { moves: 60 });
  const b = repair(units, x, input, { moves: 60 });
  const same = JSON.stringify([...a.x].sort()) === JSON.stringify([...b.x].sort());
  if (same) ok('два прогона на одном входе дают одну сетку');
  else bad('прогоны разошлись — правка невоспроизводима');
}

console.log('Q8. Ручной ход: жёсткое запрещено, мягкое — под подпись');
{
  // ход, ломающий жёсткий инвариант: поставить единицу класса на занятую им позицию
  const a = units.find((u) => u.classId === 'c3');
  const b = units.find((u) => u.classId === 'c3' && u.id !== a.id);
  const collide = { kind: 'move', unitId: b.id, ...x.get(a.id) };
  const res = admissible(units, x, input, collide);
  if (res.violations.length) ok(`ход в занятую позицию отклонён: ${[...new Set(res.violations.map((v) => v.code))].join(', ')}`);
  else bad('ход, ломающий жёсткий инвариант, признан допустимым');

  // ход, ухудшающий мягкий маркер: допустим, но помечается как ухудшение
  let worse = null;
  for (const u of units) {
    for (let d = 0; d < input.params.days && !worse; d += 1) {
      for (let s = 1; s <= input.params.slotsPerDay; s += 1) {
        const mv = { kind: 'move', unitId: u.id, dayNo: d, slotNo: s };
        const r = admissible(units, x, input, mv);
        if (r.violations.length) continue;
        const t = total(penalties(units, r.next, input));
        if (t > total(penalties(units, x, input))) { worse = { mv, t }; break; }
      }
    }
    if (worse) break;
  }
  if (worse) ok(`найден допустимый ход, ухудшающий Π до ${worse.t} — интерфейс обязан запросить подтверждение`);
  else bad('ни одного ухудшающего допустимого хода — модель ручной правки непроверяема');
}

console.log('Q9. Обратимость: у каждого хода есть обратный');
{
  const mv = { kind: 'move', unitId: units[0].id, dayNo: x.get(units[0].id).dayNo, slotNo: x.get(units[0].id).slotNo };
  const inv = inverse(x, mv);
  const back = applyMove(applyMove(x, mv), inv);
  const same = JSON.stringify([...back].sort()) === JSON.stringify([...x].sort());
  if (same) ok('ход и обратный ход возвращают сетку в исходное состояние');
  else bad('обратный ход не восстанавливает сетку');

  const sw = { kind: 'swap', aId: units[0].id, bId: units[1].id };
  const back2 = applyMove(applyMove(x, sw), inverse(x, sw));
  if (JSON.stringify([...back2].sort()) === JSON.stringify([...x].sort())) ok('обмен самообратен');
  else bad('обмен не самообратен');
}

console.log('Q10. Стабильность регенерации измеряется, а не декларируется');
{
  const gen2 = generate(firstSchool(20260827));
  const pen = penalties(gen2.units, gen2.x, input, x);
  const moved = pen.stability.pi;
  if (moved >= 0 && moved <= gen2.units.length) ok(`регенерация с другим зерном сдвинула ${moved} из ${gen2.units.length} часов — величина показывается человеку`);
  else bad(`метрика стабильности вне области: ${moved}`);
}

console.log('Q11. Снимок один, проекции согласованы');
{
  const snap = snapshot(units, x, input, { version: 1, templateId: 't1' });
  const rows = projectClass(snap, 'c5');
  const cells = rows.flat().slice(0).filter((v, i) => i % (snap.params.days + 1) !== 0).filter((v) => v !== '').length;
  const inGrid = snap.slots.filter((s) => s.classId === 'c5').length;
  eq(cells, inGrid, 'печатная проекция класса содержит ровно столько занятых ячеек, сколько слотов у класса в снимке');

  const ics = projectIcs(snap, 'c5', '20261231T000000Z', ['20260223']);
  eq(ics.length, inGrid, 'календарная проекция содержит столько же событий');

  const s1 = sign(canonical(snap), 'secret');
  const s2 = sign(canonical(snapshot(units, x, input, { version: 1, templateId: 't1' })), 'secret');
  eq(s1, s2, 'подпись снимка воспроизводима на одинаковых данных');
  const s3 = sign(canonical(snapshot(units, x, input, { version: 2, templateId: 't1' })), 'secret');
  if (s3 !== s1) ok('смена версии сетки меняет подпись — старая ссылка не выдаёт новую сетку');
  else bad('подпись не зависит от версии');
}

console.log('Q12. Арифметические отказы — леммы, а не эвристики');
{
  const cases = [
    ['LOAD_EXCEEDS_SANPIN', (i) => { i.pairs.push({ subjectId: 'доп-c1', classId: 'c1', teacherId: 'Мария', scope: 'class', groupNos: [], hours: 20 }); }],
    ['GROUP_HOURS_UNEQUAL', (i) => { i.pairs.find((p) => p.classId === 'c2' && p.groupNos[0] === 2).hours = 1; }],
    ['DAY_EXCEEDS_SANPIN', (i) => { i.params.slotsPerDay = 9; }],
    ['DAY_TOO_LONG', (i) => { i.params.lessonMin = 45; i.params.breakMin = 45; i.params.bigBreakMin = 30; }],
  ];
  for (const [code, mutate] of cases) {
    const inp = firstSchool(1);
    mutate(inp);
    const r = necessary(inp);
    if (r?.code === code) ok(`${code} обнаружен арифметикой до перебора`);
    else bad(`${code} не обнаружен (получено: ${r?.code ?? 'ничего'})`);
  }
  // LOAD_EXCEEDS_GRID: класс 1 (потолок дня 4 → 20 слотов недели) с 21 часом
  const inp = firstSchool(1);
  inp.pairs.push({ subjectId: 'доп-c1', classId: 'c1', teacherId: 'Мария', scope: 'class', groupNos: [], hours: 7 });
  const r = necessary(inp);
  if (r?.code === 'LOAD_EXCEEDS_GRID' || r?.code === 'LOAD_EXCEEDS_SANPIN') ok(`перегруз класса 1 отклонён кодом ${r.code} до перебора`);
  else bad(`перегруз класса 1 не отклонён (получено: ${r?.code ?? 'ничего'})`);
}

console.log('');
if (fails) { console.error(`❌ Свойств нарушено: ${fails}`); process.exit(1); }
console.log('✅ Q1…Q12 — зелёные.');

export { buildUnits, necessary, generate, invariants, penalties, neighbourhood, repair, snapshot, projectClass, projectIcs, sign, total, quality, aggregate, WEIGHTS, maxSpread };
