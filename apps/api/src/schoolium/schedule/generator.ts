import {
  ARITHMETIC_REFUSALS,
  DAY_MINUTES_CAP,
  DAY_SLOTS_CAP,
  GENERATOR_BUDGET,
  WEEK_HOURS_CAP,
  classDayCap,
  schoolDayCap,
  type GeneratorRefusal,
} from '@edustore/shared';

/**
 * Генератор шаблона недели (AR-73, AR-84). Чистая функция: ни БД, ни сети —
 * поэтому её поведение доказуемо перечислением, а не наблюдением в проде.
 *
 * Эталон — `model/props.mjs` (свойства P5, P18). Три вещи здесь неслучайны:
 *
 * 1. **Групповые часы планируются АТОМАРНОЙ спаренной единицей** — все группы
 *    предмета в одном слоте, каждая со своим педагогом (AR-75, стенд P5).
 *    Планирование групп независимыми единицами не сходится в принципе и
 *    оставляет полуокно: одна группа учится, вторая свободна в середине дня.
 * 2. **Восемь арифметических отказов считаются ДО перебора** (AR-103): иначе
 *    модератор ждёт перебор ради неинформативного `NO_SOLUTION`.
 * 3. **У перебора есть названный бюджет** — 20 секунд либо 200 000 попыток
 *    размещения, что раньше (AR-107). Исчерпание отвечает тем же `NO_SOLUTION`
 *    и тем же маршрутом восстановления: отдельный код завёл бы человека в
 *    «попробуйте ещё раз», которого у него нет.
 */

export interface GenClass {
  id: string;
  label: string;
  parallel: number;
  groupCount: number;
}

/** Пара «педагог × предмет × класс/группа × часы» — вход с экрана 2 мастера. */
export interface GenPair {
  subjectId: string;
  subjectName: string;
  classId: string;
  teacherId: string;
  teacherName: string;
  scope: 'class' | 'group';
  groupNos: number[];
  hours: number;
  priority: boolean;
}

export interface GenDayParams {
  days: number;
  slotsPerDay: number;
  lessonMin: number;
  breakMin: number;
  bigBreakAfter: number;
  bigBreakMin: number;
  /** Начало первого урока (минуты от полуночи) — перебором не используется, едет в шаблон для времён на экранах. */
  dayStartMin?: number;
}

export interface GenInput {
  classes: GenClass[];
  pairs: GenPair[];
  params: GenDayParams;
  seed: number;
  /** Классы, где группы объявлены, но состав не назначен (AR-75). */
  classesWithUnassignedGroups: { id: string; label: string }[];
  /** Предметы без полного покрытия: [{subjectId, subjectName, classId, groups}]. */
  uncovered: { subjectId: string; subjectName: string; classId: string; groups: number[] }[];
  /** Бюджет перебора; по умолчанию — значения AR-107. */
  budget?: { seconds: number; attempts: number };
}

export interface GenSlot {
  dayNo: number;
  slotNo: number;
  classId: string;
  groupNo: number; // 0 = весь класс
  subjectId: string;
  teacherId: string;
}

export type GenResult =
  | { ok: true; slots: GenSlot[]; attempts: number; durationMs: number; priorityWarnings: string[] }
  | { ok: false; code: GeneratorRefusal; details: Record<string, unknown>; attempts: number; durationMs: number };

/** Длина учебного дня: `слоты × урок + перемены + большая перемена` (AR-103). */
export function dayLength(p: GenDayParams): number {
  const breaks = Math.max(0, p.slotsPerDay - 1);
  const big = p.bigBreakAfter > 0 && p.bigBreakAfter < p.slotsPerDay ? 1 : 0;
  return p.slotsPerDay * p.lessonMin + (breaks - big) * p.breakMin + big * p.bigBreakMin;
}

export function dayLengthBreakdown(p: GenDayParams): string {
  const breaks = Math.max(0, p.slotsPerDay - 1);
  const big = p.bigBreakAfter > 0 && p.bigBreakAfter < p.slotsPerDay ? 1 : 0;
  return `${p.slotsPerDay} уроков × ${p.lessonMin} + перемены ${breaks - big} × ${p.breakMin} + большая ${big ? p.bigBreakMin : 0}`;
}

/** Детерминированный ГПСЧ: при фиксированном зерне сетка одна и та же (AR-97, `GEN_SEED`). */
function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Единица планирования: класс-час (один педагог) либо спаренный групповой час. */
interface Unit {
  classId: string;
  subjectId: string;
  /** Один элемент у класс-часа, по одному на группу у спаренного. */
  parts: { groupNo: number; teacherId: string }[];
  priority: boolean;
}

/**
 * Часы класса за неделю: класс-часы плюс максимум по группам — группы учатся
 * ПАРАЛЛЕЛЬНО, в одном слоте, поэтому их часы не складываются (AR-75).
 */
export function classWeekHours(classId: string, pairs: GenPair[]): number {
  const own = pairs.filter((p) => p.classId === classId);
  const classHours = own.filter((p) => p.scope === 'class').reduce((a, p) => a + p.hours, 0);
  const groupSubjects = [...new Set(own.filter((p) => p.scope === 'group').map((p) => p.subjectId))];
  const groupHours = groupSubjects.reduce((a, sid) => {
    const hs = own.filter((p) => p.subjectId === sid && p.scope === 'group').map((p) => p.hours);
    return a + Math.max(0, ...hs);
  }, 0);
  return classHours + groupHours;
}

/**
 * Восемь арифметических отказов ДО перебора. Порядок — из `30-spec.md`; первый
 * сработавший и есть ответ: человеку показывают одну причину с цифрами, а не
 * список гипотез.
 */
export function arithmeticRefusal(input: GenInput): { code: GeneratorRefusal; details: Record<string, unknown> } | null {
  const { classes, pairs, params } = input;
  const grid = params.days * params.slotsPerDay;

  for (const c of classes) {
    const total = classWeekHours(c.id, pairs);

    const weekCap = WEEK_HOURS_CAP[c.parallel];
    if (weekCap !== undefined && total > weekCap) {
      return { code: 'LOAD_EXCEEDS_SANPIN', details: { classLabel: c.label, total, cap: weekCap } };
    }
    // «уроков в день» — второй множитель «слотов недели» (AR-103), но считается он
    // ПОКЛАССНО: день класса ограничен потолком ЕГО параллели (AR-114), а не
    // школьным числом. Иначе первоклассник тянул бы вниз всю школу.
    const classGrid = params.days * classDayCap(c.parallel, params.slotsPerDay);
    if (total > classGrid) {
      return {
        code: 'LOAD_EXCEEDS_GRID',
        // Текст §9 объясняет, ОТКУДА взялось число слотов: «(6 уроков в день × 5
        // дней — потолок параллели)». Без разбора модератор видит цифру, которую
        // не может проверить, и не знает, какой из двух множителей менять.
        details: { classLabel: c.label, total, grid: classGrid, perDay: classDayCap(c.parallel, params.slotsPerDay), days: params.days },
      };
    }
  }

  const byTeacher = new Map<string, { name: string; hours: number }>();
  for (const p of pairs) {
    const cur = byTeacher.get(p.teacherId) ?? { name: p.teacherName, hours: 0 };
    cur.hours += p.hours;
    byTeacher.set(p.teacherId, cur);
  }
  for (const [, t] of byTeacher) {
    if (t.hours > grid) {
      return { code: 'TEACHER_OVERBOOKED', details: { teacher: t.name, hours: t.hours, grid } };
    }
  }

  if (input.uncovered.length) {
    const u = input.uncovered[0];
    const cls = classes.find((c) => c.id === u.classId);
    return {
      code: 'SUBJECT_UNCOVERED',
      details: {
        subject: u.subjectName,
        classLabel: cls?.label ?? '—',
        groups: u.groups.length ? `группа ${u.groups.join(', ')}` : 'нет педагога',
      },
    };
  }

  if (input.classesWithUnassignedGroups.length) {
    return { code: 'GROUPS_UNASSIGNED', details: { classLabel: input.classesWithUnassignedGroups[0].label } };
  }

  for (const c of classes) {
    const own = pairs.filter((p) => p.classId === c.id && p.scope === 'group');
    for (const sid of new Set(own.map((p) => p.subjectId))) {
      const ps = own.filter((p) => p.subjectId === sid);
      const hs = ps.map((p) => p.hours);
      if (new Set(hs).size > 1) {
        return {
          code: 'GROUP_HOURS_UNEQUAL',
          details: {
            subject: ps[0].subjectName,
            classLabel: c.label,
            hours: ps.map((p, i) => `группа ${p.groupNos[0] ?? i + 1} — ${p.hours} ч`).join(', '),
          },
        };
      }
    }
  }

  // Число с экрана 4 — ВЕРХНЯЯ ГРАНИЦА школьного дня (AR-114): отказ срабатывает
  // только когда оно выше потолка самой старшей параллели школы. Ниже него число
  // осмысленно, потому что каждый класс всё равно ограничен своим потолком.
  const unknown = classes.find((c) => DAY_SLOTS_CAP[c.parallel] === undefined);
  if (unknown) {
    return { code: 'DAY_EXCEEDS_SANPIN', details: { senior: unknown.parallel, slotsPerDay: params.slotsPerDay, cap: '—' } };
  }
  const dayCap = schoolDayCap(classes.map((c) => c.parallel));
  if (classes.length > 0 && params.slotsPerDay > dayCap) {
    const senior = classes.reduce((a, c) => (DAY_SLOTS_CAP[c.parallel] > DAY_SLOTS_CAP[a.parallel] ? c : a), classes[0]);
    // Отказ про ШКОЛУ, а не про класс: число выше потолка старшей параллели —
    // значит текст обязан назвать эту параллель, иначе он указывает не на тот
    // объект (§9, AR-114).
    return { code: 'DAY_EXCEEDS_SANPIN', details: { senior: senior.parallel, slotsPerDay: params.slotsPerDay, cap: dayCap } };
  }

  const minutes = dayLength(params);
  if (minutes > DAY_MINUTES_CAP) {
    return {
      code: 'DAY_TOO_LONG',
      details: { minutes, cap: DAY_MINUTES_CAP, breakdown: dayLengthBreakdown(params) },
    };
  }
  return null;
}

/** Все восемь кодов, считаемых до перебора — перечисление для ворот G-46. */
export const PRE_SEARCH_CODES = ARITHMETIC_REFUSALS;

function buildUnits(input: GenInput): Unit[] {
  const units: Unit[] = [];
  for (const c of input.classes) {
    const own = input.pairs.filter((p) => p.classId === c.id);
    for (const p of own.filter((x) => x.scope === 'class')) {
      for (let h = 0; h < p.hours; h += 1) {
        units.push({ classId: c.id, subjectId: p.subjectId, parts: [{ groupNo: 0, teacherId: p.teacherId }], priority: p.priority });
      }
    }
    for (const sid of new Set(own.filter((x) => x.scope === 'group').map((x) => x.subjectId))) {
      const ps = own.filter((x) => x.subjectId === sid && x.scope === 'group');
      const hours = ps[0].hours;
      for (let h = 0; h < hours; h += 1) {
        units.push({
          classId: c.id,
          subjectId: sid,
          // атомарная спаренная единица: все группы предмета в ОДНОМ слоте
          parts: ps.flatMap((p) => p.groupNos.map((g) => ({ groupNo: g, teacherId: p.teacherId }))),
          priority: ps[0].priority,
        });
      }
    }
  }
  return units;
}

/**
 * Перебор. Ограничения (все жёсткие, кроме приоритетов):
 *   1. нагрузка выполняется полностью — каждой паре ровно её часы;
 *   2. педагог не занимает два слота одновременно;
 *   3. класс/группа не занимает два слота одновременно;
 *   4. полуокно запрещено — спаренная единица ставится целиком;
 *   5. без окон у класса: уроки дня идут подряд с первого слота;
 *   6. приоритетные предметы — в первой половине дня (МЯГКОЕ: помечается);
 *   7. дневной максимум класса — проверен арифметикой до перебора.
 */
export function generate(input: GenInput): GenResult {
  const started = Date.now();
  const budget = input.budget ?? GENERATOR_BUDGET;
  let attempts = 0;

  const pre = arithmeticRefusal(input);
  if (pre) return { ok: false, ...pre, attempts, durationMs: Date.now() - started };

  const units = buildUnits(input);
  const { days, slotsPerDay } = input.params;
  // Дневной потолок КАЖДОГО класса: min(школьное число, потолок его параллели).
  const classCaps = new Map(input.classes.map((c) => [c.id, classDayCap(c.parallel, slotsPerDay)]));

  for (let restart = 0; ; restart += 1) {
    if (Date.now() - started > budget.seconds * 1000 || attempts >= budget.attempts) {
      return { ok: false, code: 'NO_SOLUTION', details: { attempts, exhausted: 'budget' }, attempts, durationMs: Date.now() - started };
    }
    const rand = lcg(input.seed + restart * 7919);
    const order = units
      .map((u, i) => ({ k: rand() - (u.priority ? 0.5 : 0), i })) // приоритетные — раньше в порядке
      .sort((a, b) => a.k - b.k)
      .map((x) => units[x.i]);

    const busyTeacher = new Set<string>(); // `${day}:${slot}:${teacherId}`
    const dayLen = new Map<string, number>(); // `${classId}:${day}` → занято слотов подряд
    const placed: GenSlot[] = [];
    let failed = false;

    for (const u of order) {
      const cap = classCaps.get(u.classId) ?? slotsPerDay;
      const options: [number, number][] = [];
      for (let d = 0; d < days; d += 1) {
        const s = dayLen.get(`${u.classId}:${d}`) ?? 0; // без окон: следующий подряд
        if (s >= cap) continue; // день класса ограничен потолком ЕГО параллели (AR-114)
        if (u.parts.some((p) => busyTeacher.has(`${d}:${s}:${p.teacherId}`))) continue;
        options.push([d, s]);
      }
      attempts += 1;
      if (attempts >= budget.attempts) {
        return { ok: false, code: 'NO_SOLUTION', details: { attempts, exhausted: 'budget' }, attempts, durationMs: Date.now() - started };
      }
      if (!options.length) { failed = true; break; }
      const [d, s] = options[Math.floor(rand() * options.length)];
      for (const p of u.parts) {
        busyTeacher.add(`${d}:${s}:${p.teacherId}`);
        placed.push({ dayNo: d, slotNo: s + 1, classId: u.classId, groupNo: p.groupNo, subjectId: u.subjectId, teacherId: p.teacherId });
      }
      dayLen.set(`${u.classId}:${d}`, s + 1);
    }
    if (failed) continue;

    // Приоритеты — МЯГКОЕ ограничение (6): нарушение помечается в предпросмотре и
    // не валит генерацию. Человек решает, важнее ли ему приоритет или сетка.
    const half = Math.ceil(slotsPerDay / 2);
    const warnings = [...new Set(
      placed
        .filter((sl) => units.some((u) => u.subjectId === sl.subjectId && u.priority) && sl.slotNo > half)
        .map((sl) => `${sl.subjectId}:${sl.classId}`),
    )];
    return { ok: true, slots: placed, attempts, durationMs: Date.now() - started, priorityWarnings: warnings };
  }
}

/**
 * Скользящая материализация (AR-101): идемпотентная операция «дозаполнить
 * горизонт», а не разовое событие. Ключ — дата + номер слота + класс + группа:
 * повторный прогон на тех же данных не создаёт ни одной записи, и именно поэтому
 * триггеров может быть три (подтверждение, ночной крон, открытие журнала).
 */
export function plannedLessons(args: {
  slots: GenSlot[];
  from: Date;
  weeks: number;
  isSchoolDay: (d: Date) => boolean;
  inTerm: (d: Date) => boolean;
}): { date: string; slot: GenSlot }[] {
  const out: { date: string; slot: GenSlot }[] = [];
  const cursor = new Date(args.from);
  for (let i = 0; i < args.weeks * 7; i += 1) {
    const d = new Date(cursor);
    d.setUTCDate(cursor.getUTCDate() + i);
    if (!args.isSchoolDay(d) || !args.inTerm(d)) continue;
    const dow = (d.getUTCDay() + 6) % 7; // пн = 0
    for (const s of args.slots.filter((x) => x.dayNo === dow)) {
      out.push({ date: d.toISOString().slice(0, 10), slot: s });
    }
  }
  return out;
}

/** Триггеры материализации названы поимённо (AR-101) — перечисление для G-45. */
export const MATERIALIZE_TRIGGERS = [
  'подтверждение сетки',
  'ночной крон',
  'открытие журнала с коротким горизонтом',
] as const;

/** Горизонт видимости — три недели вперёд (AR-73). Не длина расписания. */
export const HORIZON_WEEKS = 3;
