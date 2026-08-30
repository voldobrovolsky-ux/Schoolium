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

/**
 * Скелет дня для укладки (AR-171, УТЦ v1.4 фаза III): урочные позиции по дням
 * в порядке `posNo`. Когда задан — слоты недели считаются ПО НЕМУ (номер слота
 * = `lessonNo` скелета), а не арифметикой `slotsPerDay`; при `paired` часы
 * предмета укладываются парами на смежные половины одного `pairNo`.
 */
export interface GenSkeleton {
  gridKind: 'paired' | 'variable';
  days: { dayNo: number; lessons: { lessonNo: number; pairNo: number | null }[] }[];
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
  /** Скелет дня; null/отсутствует — прежняя укладка по параметрам дня. */
  skeleton?: GenSkeleton | null;
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
  /**
   * Сколько СМЕЖНЫХ слотов занимает единица: 2 — пара (два часа предмета на
   * обеих половинах одного `pairNo`, перемены внутри нет — AR-171), 1 — одинарный
   * час. Без скелета всегда 1 — прежняя укладка.
   */
  span: 1 | 2;
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
  // Слоты дня: по скелету — число урочных позиций ЭТОГО дня (день без позиций
  // не вмещает ничего); без скелета — школьное число с экрана параметров.
  const daySlots = (d: number): number => {
    const lessons = dayLessons(input.skeleton, d);
    return lessons ? lessons.length : params.slotsPerDay;
  };
  const weekDays = Array.from({ length: params.days }, (_, d) => d);
  const grid = weekDays.reduce((a, d) => a + daySlots(d), 0);

  for (const c of classes) {
    const total = classWeekHours(c.id, pairs);

    // AR-178 (решение владельца 2026-08-31, школа полного дня): у школы СО
    // СКЕЛЕТОМ день и неделю судит сам скелет — развивашки и самоподготовка
    // тоже уроки, табличные потолки СанПиН их не описывают. Табличные потолки
    // остаются судьёй только бесскелетного фолбэка.
    const weekCap = WEEK_HOURS_CAP[c.parallel];
    if (!input.skeleton && weekCap !== undefined && total > weekCap) {
      return { code: 'LOAD_EXCEEDS_SANPIN', details: { classLabel: c.label, total, cap: weekCap } };
    }
    // «уроков в день» — второй множитель «слотов недели» (AR-103); без скелета
    // считается ПОКЛАССНО: день класса ограничен потолком ЕГО параллели
    // (AR-114), а не школьным числом — иначе первоклассник тянул бы вниз всю
    // школу. Со скелетом вместимость недели — сумма его урочных позиций (AR-178).
    const classGrid = input.skeleton
      ? grid
      : weekDays.reduce((a, d) => a + Math.min(classDayCap(c.parallel, params.slotsPerDay), daySlots(d)), 0);
    if (total > classGrid) {
      return {
        code: 'LOAD_EXCEEDS_GRID',
        // Текст §9 объясняет, ОТКУДА взялось число слотов. Без разбора модератор
        // видит цифру, которую не может проверить, и не знает, что менять.
        details: {
          classLabel: c.label,
          total,
          grid: classGrid,
          breakdown: input.skeleton
            ? `урочные позиции скелета за ${params.days} дней`
            : `${classDayCap(c.parallel, params.slotsPerDay)} уроков в день × ${params.days} дней — потолок параллели`,
        },
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
  // Со скелетом (AR-178) размер дня задаёт скелет, и это число день не судит.
  if (!input.skeleton) {
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
  }

  // Длина дня школы со скелетом задана временами самого скелета и проверена
  // при его сохранении (`SKELETON_INVALID`) — арифметика параметров дня её
  // больше не описывает и потому не судит.
  const minutes = dayLength(params);
  if (!input.skeleton && minutes > DAY_MINUTES_CAP) {
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
  // Спаренная сетка: часы предмета режутся на пары (span 2) и одиночный
  // остаток (span 1). Дефолт школы — `paired` (решение владельца №7);
  // `variable` и школа без скелета укладываются прежними одиночными часами.
  const paired = input.skeleton?.gridKind === 'paired';
  const spans = (hours: number): (1 | 2)[] =>
    paired
      ? [...Array<2>(Math.floor(hours / 2)).fill(2), ...(hours % 2 ? [1 as const] : [])]
      : Array<1>(hours).fill(1);

  const units: Unit[] = [];
  for (const c of input.classes) {
    const own = input.pairs.filter((p) => p.classId === c.id);
    for (const p of own.filter((x) => x.scope === 'class')) {
      for (const span of spans(p.hours)) {
        units.push({ classId: c.id, subjectId: p.subjectId, parts: [{ groupNo: 0, teacherId: p.teacherId }], priority: p.priority, span });
      }
    }
    for (const sid of new Set(own.filter((x) => x.scope === 'group').map((x) => x.subjectId))) {
      const ps = own.filter((x) => x.subjectId === sid && x.scope === 'group');
      for (const span of spans(ps[0].hours)) {
        units.push({
          classId: c.id,
          subjectId: sid,
          // атомарная спаренная единица: все группы предмета в ОДНОМ слоте
          parts: ps.flatMap((p) => p.groupNos.map((g) => ({ groupNo: g, teacherId: p.teacherId }))),
          priority: ps[0].priority,
          span,
        });
      }
    }
  }
  return units;
}

/**
 * Урочные позиции дня по скелету, в порядке `posNo`. Дня нет в скелете —
 * пустой список: занятий туда генератор не кладёт.
 */
function dayLessons(skeleton: GenSkeleton | null | undefined, dayNo: number): { lessonNo: number; pairNo: number | null }[] | null {
  if (!skeleton) return null;
  return skeleton.days.find((d) => d.dayNo === dayNo)?.lessons ?? [];
}

/**
 * Перебор. Ограничения (все жёсткие, кроме приоритетов):
 *   1. нагрузка выполняется полностью — каждой паре ровно её часы;
 *   2. педагог не занимает два слота одновременно;
 *   3. класс/группа не занимает два слота одновременно;
 *   4. полуокно запрещено — спаренная единица ставится целиком;
 *   5. без окон у класса: уроки дня идут подряд с первого слота;
 *   6. приоритетные предметы — в первой половине дня (МЯГКОЕ: помечается);
 *   7. дневной максимум класса — проверен арифметикой до перебора;
 *   8. при скелете `paired` (AR-171): пара предмета (span 2) занимает обе
 *      половины ОДНОГО `pairNo` смежно; слоты недели = урочные позиции
 *      скелета, номер слота = его `lessonNo`.
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
      // приоритетные — раньше в порядке; пары — раньше одиночных, чтобы одиночный
      // час не занял первую половину пары и не оставил для пары несмежный остаток
      .map((u, i) => ({ k: rand() - (u.priority ? 0.5 : 0) - (u.span === 2 ? 0.25 : 0), i }))
      .sort((a, b) => a.k - b.k)
      .map((x) => units[x.i]);

    const busyTeacher = new Set<string>(); // `${day}:${lessonNo}:${teacherId}`
    const dayLen = new Map<string, number>(); // `${classId}:${day}` → занято слотов подряд
    const placed: GenSlot[] = [];
    let failed = false;

    for (const u of order) {
      const cap = classCaps.get(u.classId) ?? slotsPerDay;
      const options: [number, number][] = [];
      for (let d = 0; d < days; d += 1) {
        const s = dayLen.get(`${u.classId}:${d}`) ?? 0; // без окон: следующий подряд
        const lessons = dayLessons(input.skeleton, d);
        // со скелетом день вмещает ровно его урочные позиции — полный день сам
        // и есть решение школы (AR-178); без скелета — потолок ЕГО параллели (AR-114)
        const dCap = lessons ? lessons.length : cap;
        if (s + u.span > dCap) continue;
        // пара — на обе половины ОДНОГО pairNo, смежно и без перемены (AR-171)
        if (u.span === 2 && lessons) {
          const a = lessons[s];
          const b = lessons[s + 1];
          if (!a || !b || a.pairNo == null || a.pairNo !== b.pairNo) continue;
        }
        const nos = lessons ? lessons.slice(s, s + u.span).map((l) => l.lessonNo) : [s + 1];
        if (u.parts.some((p) => nos.some((no) => busyTeacher.has(`${d}:${no}:${p.teacherId}`)))) continue;
        options.push([d, s]);
      }
      attempts += 1;
      if (attempts >= budget.attempts) {
        return { ok: false, code: 'NO_SOLUTION', details: { attempts, exhausted: 'budget' }, attempts, durationMs: Date.now() - started };
      }
      if (!options.length) { failed = true; break; }
      const [d, s] = options[Math.floor(rand() * options.length)];
      const lessons = dayLessons(input.skeleton, d);
      for (let k = 0; k < u.span; k += 1) {
        const no = lessons ? lessons[s + k].lessonNo : s + 1 + k;
        for (const p of u.parts) {
          busyTeacher.add(`${d}:${no}:${p.teacherId}`);
          placed.push({ dayNo: d, slotNo: no, classId: u.classId, groupNo: p.groupNo, subjectId: u.subjectId, teacherId: p.teacherId });
        }
      }
      dayLen.set(`${u.classId}:${d}`, s + u.span);
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
