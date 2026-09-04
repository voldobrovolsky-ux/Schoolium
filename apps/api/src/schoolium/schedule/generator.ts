import { ARITHMETIC_REFUSALS, GENERATOR_BUDGET, type GeneratorRefusal } from '@edustore/shared';

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
 * 2. **Шесть арифметических отказов считаются ДО перебора** (AR-107, AR-199,
 *    AR-206): иначе модератор ждёт перебор ради неинформативного `NO_SOLUTION`.
 *    Нормативных потолков (СанПиН, длина дня) генератор не считает — школа
 *    полного дня задаёт день сама (AR-199).
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
  /**
   * Обед по классам (AR-200): `classId → lessonNo` урочной позиции, которую
   * занимает обед класса (= `lunchAfterLessonNo + 1`). Класса нет в карте —
   * обед как у школы (позиция `meal` скелета, генератору не видна).
   */
  classLunch?: Record<string, number>;
  /**
   * Рабочие дни педагогов (AR-206): `teacherId → dayNo[]` (0 = ПН). Педагога
   * нет в карте либо список пуст — любой день.
   */
  teacherDays?: Record<string, number[]>;
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

/** Длина учебного дня: `слоты × урок + перемены + большая перемена` — справка `S-41.calc.dayLength` (AR-103, AR-199). */
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

/** Короткие имена дней для текстов отказов (`TEACHER_DAYS_SHORT`, §9). */
export const DAY_SHORT = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'] as const;

/** «ПН, СР, ПТ» — рабочие дни педагога словами, в порядке недели. */
export const dayNames = (days: number[]): string =>
  [...new Set(days)].sort((a, b) => a - b).map((d) => DAY_SHORT[d] ?? String(d)).join(', ');

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

type Position = { lessonNo: number; pairNo: number | null };

/**
 * Урочные позиции дня ШКОЛЫ: по скелету — позиции этого дня в порядке `posNo`
 * (дня нет в скелете — пустой список: занятий туда генератор не кладёт); без
 * скелета — `1..slotsPerDay` (AR-199: одно число на школу, потолков параллели нет).
 */
function schoolDayPositions(input: GenInput, dayNo: number): Position[] {
  if (input.skeleton) return input.skeleton.days.find((d) => d.dayNo === dayNo)?.lessons ?? [];
  return Array.from({ length: Math.max(0, input.params.slotsPerDay) }, (_, i) => ({ lessonNo: i + 1, pairNo: null }));
}

/**
 * Урочные позиции дня КЛАССА (AR-200): позиции школы без позиции обеда класса.
 * Именно этот список перебирается «подряд с первого» — поэтому обед не окно:
 * урок после обеда стоит в списке сразу за уроком до него.
 */
export function dayLessons(input: GenInput, dayNo: number, classId: string): Position[] {
  const all = schoolDayPositions(input, dayNo);
  const lunch = input.classLunch?.[classId];
  return lunch === undefined ? all : all.filter((p) => p.lessonNo !== lunch);
}

/** Педагог работает в этот день (AR-206): нет записи либо пустой список — любой день. */
function worksOn(input: GenInput, teacherId: string, dayNo: number): boolean {
  const days = input.teacherDays?.[teacherId];
  return !days || days.length === 0 || days.includes(dayNo);
}

/**
 * Шесть арифметических отказов ДО перебора. Порядок — из `30-spec.md`; первый
 * сработавший и есть ответ: человеку показывают одну причину с цифрами, а не
 * список гипотез.
 */
export function arithmeticRefusal(input: GenInput): { code: GeneratorRefusal; details: Record<string, unknown> } | null {
  const { classes, pairs, params } = input;
  // Слоты дня школы: по скелету — число урочных позиций ЭТОГО дня (день без
  // позиций не вмещает ничего); без скелета — школьное число с экрана параметров.
  const daySlots = (d: number): number => schoolDayPositions(input, d).length;
  const weekDays = Array.from({ length: params.days }, (_, d) => d);
  const grid = weekDays.reduce((a, d) => a + daySlots(d), 0);

  for (const c of classes) {
    const total = classWeekHours(c.id, pairs);

    // AR-199 (пакет 04.09, школа полного дня): недельные и дневные потолки
    // СанПиН не судят ни школу со скелетом, ни фолбэк — `LOAD_EXCEEDS_SANPIN`,
    // `DAY_EXCEEDS_SANPIN` и `DAY_TOO_LONG` выведены из употребления; потолка
    // параллели (AR-114) нет: «уроков в день» — одно число на школу.
    // «уроков в день» — второй множитель «слотов недели» (AR-103); со скелетом
    // вместимость недели — сумма его урочных позиций (AR-178). У класса со своим
    // обедом (AR-200) позиция обеда из вместимости каждого дня вычтена.
    const classGrid = weekDays.reduce((a, d) => a + dayLessons(input, d, c.id).length, 0);
    if (total > classGrid) {
      const lunch = input.classLunch?.[c.id];
      return {
        code: 'LOAD_EXCEEDS_GRID',
        // Текст §9 объясняет, ОТКУДА взялось число слотов. Без разбора модератор
        // видит цифру, которую не может проверить, и не знает, что менять.
        details: {
          classLabel: c.label,
          total,
          grid: classGrid,
          breakdown: input.skeleton
            ? `урочные позиции скелета за ${params.days} дней${lunch !== undefined ? ` без позиции обеда ${lunch}` : ''}`
            : lunch !== undefined
              ? `${params.slotsPerDay} уроков в день × ${params.days} дней минус позиция обеда ${lunch} в каждом дне`
              : `${params.slotsPerDay} уроков в день × ${params.days} дней`,
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

  // AR-206: рабочие дни педагога — жёсткое ограничение, и у него есть своя
  // арифметика (лемма непустоты, AR-132): часов больше, чем урочных позиций в
  // его рабочие дни — перебор не нужен, ответ известен до него, с адресом и
  // действием («расширьте дни или снимите часы»).
  for (const [teacherId, t] of byTeacher) {
    const days = (input.teacherDays?.[teacherId] ?? []).filter((d) => d >= 0 && d < params.days);
    if (!days.length) continue; // пусто = любой день — судит TEACHER_OVERBOOKED выше
    const slots = [...new Set(days)].reduce((a, d) => a + daySlots(d), 0);
    if (t.hours > slots) {
      return { code: 'TEACHER_DAYS_SHORT', details: { teacher: t.name, hours: t.hours, slots, days: dayNames(days) } };
    }
  }

  // AR-199: длину дня и число уроков в день задаёт школа; нормативных
  // потолков (AR-103, AR-114) генератор больше не считает.
  return null;
}

/** Все шесть кодов, считаемых до перебора — перечисление для ворот G-46 (AR-199, AR-206). */
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
 * Перебор. Ограничения (все жёсткие, кроме приоритетов):
 *   1. нагрузка выполняется полностью — каждой паре ровно её часы;
 *   2. педагог не занимает два слота одновременно;
 *   3. класс/группа не занимает два слота одновременно;
 *   4. полуокно запрещено — спаренная единица ставится целиком;
 *   5. без окон у класса: уроки дня идут подряд с первого слота; позиция
 *      обеда класса (AR-200) окном не считается — её в списке позиций нет;
 *   6. приоритетные предметы — в первой половине дня (МЯГКОЕ: помечается);
 *   7. день вмещает ровно свои урочные позиции: по скелету — его позиции
 *      (AR-178), без скелета — «уроков в день» школы (AR-199), минус обед класса;
 *   8. при скелете `paired` (AR-171): пара предмета (span 2) занимает обе
 *      половины ОДНОГО `pairNo` смежно; слоты недели = урочные позиции
 *      скелета, номер слота = его `lessonNo`;
 *   9. рабочие дни педагога (AR-206): единица не ставится в день, когда хоть
 *      один её педагог не работает — группы атомарны (AR-75), день общий.
 */
export function generate(input: GenInput): GenResult {
  const started = Date.now();
  const budget = input.budget ?? GENERATOR_BUDGET;
  let attempts = 0;

  const pre = arithmeticRefusal(input);
  if (pre) return { ok: false, ...pre, attempts, durationMs: Date.now() - started };

  const units = buildUnits(input);
  const { days, slotsPerDay } = input.params;

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
    const dayLen = new Map<string, number>(); // `${classId}:${day}` → занято позиций подряд
    const placed: GenSlot[] = [];
    let failed = false;

    for (const u of order) {
      const options: [number, number][] = [];
      for (let d = 0; d < days; d += 1) {
        // AR-206: день отбрасывается, если хоть один педагог единицы в него не работает
        if (u.parts.some((p) => !worksOn(input, p.teacherId, d))) continue;
        const s = dayLen.get(`${u.classId}:${d}`) ?? 0; // без окон: следующий подряд
        // позиции дня КЛАССА: скелет либо `slotsPerDay`, без позиции обеда (AR-200)
        const lessons = dayLessons(input, d, u.classId);
        if (s + u.span > lessons.length) continue;
        // пара — на обе половины ОДНОГО pairNo, смежно и без перемены (AR-171)
        if (u.span === 2) {
          const a = lessons[s];
          const b = lessons[s + 1];
          if (a.pairNo == null || a.pairNo !== b.pairNo) continue;
        }
        const nos = lessons.slice(s, s + u.span).map((l) => l.lessonNo);
        if (u.parts.some((p) => nos.some((no) => busyTeacher.has(`${d}:${no}:${p.teacherId}`)))) continue;
        options.push([d, s]);
      }
      attempts += 1;
      if (attempts >= budget.attempts) {
        return { ok: false, code: 'NO_SOLUTION', details: { attempts, exhausted: 'budget' }, attempts, durationMs: Date.now() - started };
      }
      if (!options.length) { failed = true; break; }
      const [d, s] = options[Math.floor(rand() * options.length)];
      const lessons = dayLessons(input, d, u.classId);
      for (let k = 0; k < u.span; k += 1) {
        const no = lessons[s + k].lessonNo;
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
