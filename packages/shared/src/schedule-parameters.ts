/**
 * Реестр параметров расписания — один источник для экранов и для генератора.
 *
 * Документ: `specs/schedule-block/35-parameters.md` (редакция 2).
 * Решения: AR-129…AR-136. Полнота доказывается воротами **G-61**.
 *
 * Редакция 2 (правки владельца 2026-08-27): учебный год и скелет дня вынесены
 * во внешние блоки; приоритет и спаренность стали рангами; недельные часы
 * выводятся из годовых; у педагога окна обязательны, а не запрещены; отказа
 * «нет решения» больше нет; глубина поиска измеряется вариантами, не секундами.
 */

/** Шаги мастера настройки расписания. Порядок — порядок экранов. */
export const PARAM_STEPS = [
  { no: 1, id: 'load', title: 'Нагрузка' },
  { no: 2, id: 'priority', title: 'Приоритет предмета' },
  { no: 3, id: 'pairing', title: 'Спаренность уроков' },
  { no: 4, id: 'teacher', title: 'Педагоги: методическая работа' },
  { no: 5, id: 'search', title: 'Глубина поиска' },
] as const;
export type ParamStep = (typeof PARAM_STEPS)[number]['id'];

/**
 * Блоки-владельцы величин, которые расписание ЧИТАЕТ и не хранит. Попытка
 * собрать их вторым вводом заводит второй источник истины (AR-68, AR-45).
 */
export const EXTERNAL_SOURCES = [
  { id: 'calendar', title: 'Календарь', gives: ['учебный год', 'периоды', 'каникулы', 'нерабочие дни', 'число учебных недель'] },
  { id: 'skeleton', title: 'Скелет дня', gives: ['начало дня', 'длина урока', 'перемены', 'позиции звонков'] },
  { id: 'plan', title: 'Учебный план', gives: ['годовых часов предмета по классам'] },
  { id: 'contingent', title: 'Контингент', gives: ['классы', 'параллели', 'группы и их состав'] },
  { id: 'staff', title: 'Персонал', gives: ['педагоги и роли'] },
] as const;

/**
 * Природа величины. Смешение природ — источник правок, которые школа делает
 * там, где правка бессмысленна:
 *   input   — задаёт модератор;
 *   norm    — задаёт закон, в коде константой; ужесточить можно, ослабить нет;
 *   derived — вычисляет движок, ввода не существует.
 */
export type ParamKind = 'input' | 'norm' | 'derived';

/** Есть в коде · вводится этим реестром · объявлен и выключен в версии. */
export type ParamStatus = 'present' | 'new' | 'slot';

export type ParamControl = 'number' | 'time' | 'select' | 'segment' | 'multiselect' | 'grid' | 'readonly';

export interface ScheduleParam {
  id: string;
  step: ParamStep;
  label: string;
  kind: ParamKind;
  status: ParamStatus;
  control: ParamControl;
  min?: number;
  max?: number;
  values?: readonly (string | number)[];
  default?: string | number | boolean;
  /** Верхняя граница, заданная НОРМОЙ: параметр ввода не вправе её превысить. */
  normCap?: number;
  normSource?: string;
  /** Потребитель значения: ограничение `H*`, маркер качества либо проекция. */
  feeds: readonly string[];
  refusals?: readonly string[];
}

// ─────────────────── приоритет и спаренность (AR-134) ───────────────────

/**
 * **Приоритет предмета** — 1…6, где 1 самый главный. Приоритеты ПОВТОРЯЮТСЯ:
 * несколько предметов могут иметь один и тот же приоритет и делят начало дня
 * между собой.
 *
 * Правило: в дне класса уроки идут по НЕУБЫВАНИЮ приоритета — считая по началу
 * урока (для спаренного блока это его первая позиция). Пример владельца:
 * физкультура и математика обе первого приоритета, физкультура одиночная стоит
 * первой, математика спаренная начинается со второй и занимает вторую и третью;
 * предмет второго приоритета встаёт четвёртым. Последовательность 1-1-1-2
 * неубывающая — нарушения нет, хотя третья позиция занята первым приоритетом.
 *
 * Следствие, названное явно: **продолжение спаренного блока вправе выходить за
 * зону своего приоритета**, начало — нет.
 */
export const PRIORITIES = [1, 2, 3, 4, 5, 6] as const;
export type Priority = (typeof PRIORITIES)[number];

/**
 * Вес приоритета. Шкала удваивающаяся, и это не вкус, а следствие требования
 * «сначала первые, потом вторые»:
 *
 *   W(p) = 2^(6−p)  →  32, 16, 8, 4, 2, 1
 *
 * При такой шкале **один урок приоритета p важнее всех уроков более низких
 * приоритетов вместе взятых** (32 > 16+8+4+2+1 = 31). Это единственное с
 * точностью до множителя семейство целых весов, при котором размен «уступить
 * один сильный приоритет ради нескольких слабых» никогда не выгоден — то есть
 * порядок приоритетов остаётся порядком, а не превращается в торг.
 *
 * Линейная шкала (6−p) этим свойством не обладает: она делает перестановку
 * первого со вторым такой же дешёвой, как четвёртого с пятым.
 */
export const PRIORITY_WEIGHT: Record<Priority, number> = { 1: 32, 2: 16, 3: 8, 4: 4, 5: 2, 6: 1 };

/**
 * Цена инверсии — разность весов участников: `W(min) − W(max)`. Целое, как
 * требует доказательство завершения локального поиска.
 *
 * Перестановка первого со вторым стоит 16, четвёртого с пятым — 2: ровно то
 * убывание, которое назвал владелец, но выведенное из свойства шкалы, а не
 * подобранное. Приоритет 1 инверсий не допускает вовсе (жёсткое H15), поэтому
 * его вес работает лишь как верхняя опора шкалы.
 */
export const inversionCost = (p: Priority, q: Priority): number =>
  Math.abs(PRIORITY_WEIGHT[Math.min(p, q) as Priority] - PRIORITY_WEIGHT[Math.max(p, q) as Priority]);

/**
 * **Спаренность** — 1…6, шкала владельца: 1 строго обязательно (0 %
 * неспаренности), 2 очень важно (20 %), 3 умеренно (40 %), 4 достаточно (60 %),
 * 5 необязательно (80 %), 6 запрещено (спаренных часов нет вовсе).
 */
export const PAIRING_LEVELS = [1, 2, 3, 4, 5, 6] as const;
export type PairingLevel = (typeof PAIRING_LEVELS)[number];

export const PAIRING_TOLERANCE: Record<PairingLevel, number> = { 1: 0, 2: 0.2, 3: 0.4, 4: 0.6, 5: 0.8, 6: 0 };

export const PAIRING_TITLES: Record<PairingLevel, string> = {
  1: 'строго обязательно',
  2: 'очень важно',
  3: 'умеренно необходимо',
  4: 'достаточно',
  5: 'необязательно',
  6: 'запрещено',
};

/**
 * Спаренность **из приоритета не выводится** — решение владельца 2026-08-27:
 * шкалы не совпадают. Она выводится из **годовых часов предмета** (AR-147,
 * решение владельца 2026-08-27): «чем больше уроков, тем выше порог обязательной
 * спаренности».
 *
 * Уровень не выбран вкусом, а посчитан из арифметики. Свойство, из которого он
 * следует: если недельных часов предмета больше, чем учебных дней, то какой-то
 * день **обязан** взять два часа — иного размещения не существует. Значит доля
 * часов, которая уходит в пары не по желанию школы, а по счёту, равна
 *
 *     вынужденных дней  f = max(0, h − d)
 *     доля часов в парах  s = 2·f / h
 *
 * где `h` — недельные часы (годовые, делённые на учебные недели), `d` — учебных
 * дней в неделе. Уровень — тот, чей допуск неспаренности ближе всего к `1 − s`:
 * при `s = 0` спаривать нечего принуждать, при `s = 1` весь предмет идёт парами.
 *
 * При пяти учебных днях это даёт: 1…5 ч → уровень 5, 6 ч → 4, 7 ч → 3,
 * 8…9 ч → 2, 10 ч и больше → 1.
 *
 * Уровень 6 («запрещено») **не выводится никогда** — он ставится рукой либо
 * следует из нормы для 1-х классов. Выведенный уровень человек вправе изменить:
 * вывод — дефолт, а не запрет.
 */
export const DEFAULT_PAIRING: PairingLevel = 5;

export const pairingFromYearHours = (yearHours: number, weeks: number, days: number): PairingLevel => {
  if (yearHours <= 0 || weeks <= 0 || days <= 0) return DEFAULT_PAIRING;
  const h = Math.round(yearHours / weeks);
  if (h <= 0) return DEFAULT_PAIRING;
  const share = (2 * Math.max(0, h - days)) / h;
  const want = 1 - share;
  let best: PairingLevel = DEFAULT_PAIRING;
  let bestGap = Infinity;
  for (const level of [1, 2, 3, 4, 5] as PairingLevel[]) {
    const gap = Math.abs(PAIRING_TOLERANCE[level] - want);
    if (gap < bestGap - 1e-9) {
      bestGap = gap;
      best = level;
    }
  }
  return best;
};

/**
 * Спаренный блок — два часа предмета у класса в один день, занимающие смежные
 * позиции **либо позиции, разделённые большой переменой** (слова владельца:
 * «вполне допустимо, что пара может быть разделена пополам большой переменой»).
 *
 * Большая перемена **не разрывает** пару и потому в условии не участвует:
 * позиции 2 и 3 смежны по номеру независимо от того, что стоит между ними.
 * Прежняя редакция несла вторую ветвь с `bigBreakAfter`, которая была
 * подмножеством первой — условие выглядело содержательным, ничего не проверяя.
 * Аргумент оставлен в подписи, чтобы не менять зовущий код.
 */
export const pairingIsAdjacent = (slotA: number, slotB: number, _bigBreakAfter: number): boolean =>
  Math.abs(slotA - slotB) === 1;

/**
 * Запрет сдвоенных уроков касается **1-х классов**, а не всей начальной школы,
 * и имеет исключения — физкультура по лыжной подготовке и плаванию.
 * Проверено 2026-08-27 (базис #14); прежняя формулировка «в 1–4 классах
 * сдвоенных уроков нет» была ошибкой автора спеки, а не нормой.
 */
export const PAIRING_RESTRICTED_PARALLEL = 1;
export const PAIRING_RESTRICTION_EXCEPTIONS = ['лыжная подготовка', 'плавание'] as const;

// ─────────────────────────── скелет дня ───────────────────────────

/**
 * Скелет дня — сетка звонков, в которую расписание укладывается. Отдельный
 * блок, а не поля расписания.
 *
 * **Скелет привязан к ДНЯМ НЕДЕЛИ, а не только к параллелям.** В школах
 * понедельник и четверг обычно имеют своё расписание — линейка, классные часы,
 * — поэтому у них своя сетка клеток, а вторник, среда и пятница делят общую.
 * Четверг иногда совпадает с общим рядом, поэтому нужны две операции:
 * **обособить день** (выделить в собственный скелет) и **вернуть день в общий
 * ряд**. Параллели — второе измерение: если у младшей школы свой звонок, у неё
 * свой скелет на те же дни.
 */
export interface DaySkeleton {
  id: string;
  name: string;
  /** Дни недели, к которым скелет применён; 0 = понедельник. */
  days: number[];
  /** Параллели; пусто — скелет общий для всей школы. */
  parallels: number[];
  startTime: string;
  lessonMin: number;
  breakMin: number;
  bigBreakAfter: number;
  bigBreakMin: number;
  positions: number;
}

/**
 * Режим периода — **временный скелет на диапазон дат**, а не пересборка сетки.
 *
 * Так это устроено потому, что расписание внутри четверти держится неизменным
 * (AR-140): «щадящий режим перед каникулами» не вправе переставить уроки — он
 * вправе укоротить звонки. Уроки те же, в том же порядке, просто день короче.
 * Ровно так же нормативно устроен адаптационный период первых классов: это не
 * другое расписание, а другие звонки на сентябрь-октябрь.
 *
 * Что режим МОЖЕТ менять: длину урока, длину перемен, число позиций в дне,
 * время начала. Что НЕ может: нагрузку, приоритеты, спаренность, кто ведёт —
 * иначе он перестаёт быть режимом и становится второй сеткой.
 */
export interface SkeletonPeriod {
  id: string;
  name: string;
  /** Даты действия; вне их школа возвращается к обычному скелету сама. */
  from: string;
  to: string;
  /** Какой скелет действует в эти даты вместо обычного. */
  skeletonId: string;
  /** Параллели, которых режим касается; пусто — вся школа. */
  parallels: number[];
}

/** Обособить день: вынести его из общего скелета в собственный. */
export interface SkeletonSplit { fromSkeletonId: string; day: number; name: string }
/** Вернуть день в общий ряд: слить его скелет с названным. */
export interface SkeletonMerge { skeletonId: string; day: number; intoSkeletonId: string }

export const SKELETON_NORMS = {
  lessonMaxMin: 45,
  lessonMaxMinPrimary: 40,
  breakMinMin: 10,
  bigBreakMinMin: 20,
  bigBreakMaxMin: 30,
  source: 'СанПиН 1.2.3685-21 табл. 6.6',
} as const;

// ─────────────────────────── глубина поиска ───────────────────────────

/**
 * Глубина, а не секунды. Пять минут были названы условно: при жёстких
 * параметрах сетка собирается за доли секунды, при многих классах и мягких
 * требованиях — дольше. Работа измеряется вариантами и проверками качества.
 */
export const SEARCH_DEPTHS = {
  fast: { label: 'Быстрый', variants: 5, flatStop: 2 },
  normal: { label: 'Стандартный', variants: 30, flatStop: 3 },
  thorough: { label: 'Тщательный', variants: 200, flatStop: 6 },
} as const;
export type SearchDepth = keyof typeof SEARCH_DEPTHS;

/** Прогресс — модальное окно с анимацией. Ни одной цифры человеку не показывается. */
export const PROGRESS_SHOWS_NUMBERS = false;

/**
 * Недельная нагрузка педагога — **вывод**, и никто её не вводит. Вся цепочка
 * начинается от годовых часов предмета (решение владельца 2026-08-27: понятия
 * «полная ставка педагога» в системе пока нет):
 *
 *   годовые часы предмета → недельные часы предмета → недельная нагрузка
 *   педагога (сумма его пар «предмет × класс/группа») → норма отдыха
 *
 * Ни одно звено цепочки человек не набивает руками дважды.
 */
export const teacherWeekHours = (pairsWeekHours: readonly number[]): number =>
  pairsWeekHours.reduce((a, h) => a + h, 0);

/**
 * **Трудовых норм в этом блоке нет.** Обеденный перерыв, окна на отдых,
 * предельная занятость в день — вопросы кадров и бухгалтерии, а не завуча:
 * завуч распределяет учебную работу, а не считает режим труда. Всё это придёт
 * вместе с блоком бухгалтерии и кабинетом педагога, где пожелания вносит сам
 * педагог, а утверждает директор (решение владельца 2026-08-27).
 *
 * Окна в расписании возникают как следствие расстановки: сколько нужно, столько
 * и получится. Требовать их числом было ошибкой — при малом числе педагогов
 * сетка плотная, и норма «четыре окна» превратилась бы в отказ на ровном месте.
 */
export const LABOUR_NORMS_OWNER = 'блок бухгалтерии и кадров; в расписании не задаются' as const;


// ─────────────── годовая норма, добор и подстраховка (AR-144…AR-146) ───────────────

/**
 * **Годовая норма — закон для сборки, а не пожелание.** Учебный план задаёт
 * часы на год; сборка обязана уложить ровно их. Расхождение с планом может
 * появиться **только от правки рукой** — машина его не создаёт и потому не
 * вправе о нём предупреждать: сообщение «за год выйдет 136 вместо 102» после
 * автоматической сборки означало бы, что сборка не выполнила свою работу.
 */
export const PLAN_IS_LAW_FOR_GENERATION = true;

/**
 * Неделя редко даёт ровно норму: праздник съедает урок, годовые часы не делятся
 * нацело, человек передвинул занятие. Час при этом **не теряется и не заменяет
 * собой другой предмет** — он уходит в долг и добирается следующей неделей.
 *
 * Долг к дате = сколько часов положено по плану − сколько уже проведено.
 * Положительный долг означает недобор, отрицательный — забег вперёд.
 */
export const hoursDebt = (plannedByDate: number, heldByDate: number): number => plannedByDate - heldByDate;

/**
 * Предложение добора: вместо «урок пропал» система называет **конкретный слот
 * следующей недели**, куда этот час встаёт, не ломая ни одного запрета.
 */
export interface MakeUpSlot {
  subjectName: string;
  classLabel: string;
  /** Почему час выпал: праздник, правка человека, уход педагога. */
  reason: 'holiday' | 'manual' | 'teacher-left';
  debtHours: number;
  /** Куда предлагается поставить: дата, день недели и номер урока. */
  date: string;
  dayNo: number;
  slotNo: number;
}

/**
 * **Режим подстраховки.** Аккаунт педагога убран из школы — расписание не
 * ломается и не ждёт человека: предмет снимается с сетки, оставшиеся уроки
 * дня подтягиваются (у класса окон не появляется), часы уходят в долг.
 *
 * Срок — четыре недели: это время на поиск замены. Отметки, выставленные до
 * ухода, не трогаются никогда; новых колонок по снятому предмету не появляется.
 * По истечении срока система не решает за школу — она называет накопленный долг
 * и оставляет выбор: назначить педагога и добрать часы либо сократить программу.
 */
export const COVER_MODE_WEEKS = 4;

export interface CoverMode {
  subjectName: string;
  classLabel: string;
  formerTeacher: string;
  since: string;
  /** Сколько недель подстраховки осталось; 0 — срок вышел. */
  weeksLeft: number;
  /** Накопленный недобор часов по этому предмету. */
  debtHours: number;
}

export const SCHEDULE_PARAMS: readonly ScheduleParam[] = [
  // ─── шаг 1 · нагрузка ───
  { id: 'load.yearHours', step: 'load', label: 'Часов в год', kind: 'input', status: 'new', control: 'number',
    min: 1, max: 1224, default: 102, feeds: ['load.weekHours'], refusals: ['PLAN_EXCEEDS_SANPIN'] },
  { id: 'load.weekHours', step: 'load', label: 'Часов в неделю', kind: 'derived', status: 'present', control: 'readonly',
    min: 0, max: 42, feeds: ['H1', 'единицы планирования'],
    refusals: ['LOAD_EXCEEDS_SANPIN', 'LOAD_EXCEEDS_GRID'] },
  { id: 'load.teacher', step: 'load', label: 'Кто ведёт', kind: 'input', status: 'present', control: 'select',
    feeds: ['H2'], refusals: ['SUBJECT_UNCOVERED'] },
  { id: 'load.scope', step: 'load', label: 'Ведётся', kind: 'input', status: 'present', control: 'segment',
    values: ['class', 'group'], default: 'class', feeds: ['H3', 'H4'],
    refusals: ['GROUPS_UNASSIGNED', 'GROUP_HOURS_UNEQUAL'] },

  // ─── шаг 2 · приоритет ───
  { id: 'subject.priority', step: 'priority', label: 'Приоритет', kind: 'input', status: 'new', control: 'select',
    values: PRIORITIES, default: 3, feeds: ['H15', 'маркер order'], refusals: ['PRIORITY_START_OVERFLOW'] },

  // ─── шаг 3 · спаренность ───
  { id: 'subject.pairing', step: 'pairing', label: 'Спаренность', kind: 'input', status: 'new', control: 'select',
    values: PAIRING_LEVELS, default: DEFAULT_PAIRING, feeds: ['H16', 'маркер pairing'],
    refusals: ['PAIRING_HOURS_ODD', 'PAIRING_FORBIDDEN_FIRST_GRADE'] },

  // ─── шаг 4 · педагоги ───
  { id: 'teacher.methodDay', step: 'teacher', label: 'Методический день', kind: 'input', status: 'new', control: 'select',
    feeds: ['H12'], refusals: ['TEACHER_TIME_SHORT'] },
  { id: 'method.group.members', step: 'teacher', label: 'Методическое объединение: состав', kind: 'input', status: 'new', control: 'multiselect',
    feeds: ['H17'], refusals: ['METHOD_GROUP_NO_WINDOW'] },
  { id: 'method.group.slot', step: 'teacher', label: 'Методическое объединение: когда', kind: 'input', status: 'new', control: 'grid',
    feeds: ['H17'], refusals: ['METHOD_GROUP_NO_WINDOW'] },
  { id: 'teacher.weekHours', step: 'teacher', label: 'Нагрузка педагога, часов в неделю', kind: 'derived', status: 'new', control: 'readonly',
    min: 0, feeds: ['H12', 'вместимость педагога'] },
  { id: 'teacher.unavailable', step: 'teacher', label: 'Недоступные уроки', kind: 'input', status: 'slot', control: 'grid',
    feeds: ['H12'] },

  // ─── шаг 5 · глубина поиска ───
  { id: 'search.depth', step: 'search', label: 'Насколько тщательно искать', kind: 'input', status: 'new', control: 'segment',
    values: ['fast', 'normal', 'thorough'], default: 'normal', feeds: ['число вариантов', 'число проверок качества'] },
  { id: 'search.variants', step: 'search', label: 'Вариантов собрать', kind: 'derived', status: 'new', control: 'readonly',
    min: 1, feeds: ['мультистарт'] },
  { id: 'search.qualityChecks', step: 'search', label: 'Проверок качества', kind: 'derived', status: 'new', control: 'readonly',
    min: 1, feeds: ['локальный спуск'] },
  { id: 'search.stopWhenFlat', step: 'search', label: 'Остановиться, если не улучшается', kind: 'derived', status: 'new', control: 'readonly',
    min: 1, feeds: ['ранняя остановка'] },
  { id: 'search.seed', step: 'search', label: 'Зерно перебора', kind: 'input', status: 'present', control: 'number',
    min: 1, feeds: ['воспроизводимость'] },
] as const;

/**
 * Отказа «нет решения» не существует (AR-136). Дети не могут остаться без
 * уроков, поэтому ответ «не собралось» без причины запрещён: у любого отказа
 * есть адрес и имя, и он называет, что поправить.
 *
 * Ступень 1 — арифметика до перебора (коды ниже).
 * Ступень 2 — диагностика релаксацией: движок по одному снимает снимаемые
 *   требования и называет то, чьё снятие собрало сетку (`RELAXATION_SUGGESTED`).
 * Ступень 3 — упор в норму: `PLAN_OR_CALENDAR_INVALID` с разбором.
 */
export const SCHEDULE_REFUSALS = [
  'CALENDAR_NOT_READY',
  'PLAN_EXCEEDS_SANPIN',
  'LOAD_EXCEEDS_SANPIN',
  'LOAD_EXCEEDS_GRID',
  'SUBJECT_UNCOVERED',
  'GROUPS_UNASSIGNED',
  'GROUP_HOURS_UNEQUAL',
  'TEACHER_TIME_SHORT',
  'METHOD_GROUP_NO_WINDOW',
  'PRIORITY_START_OVERFLOW',
  'PAIRING_HOURS_ODD',
  'PAIRING_FORBIDDEN_FIRST_GRADE',
  'SKELETON_TOO_SHORT',
  'RELAXATION_SUGGESTED',
  'PLAN_OR_CALENDAR_INVALID',
  'MAKE_UP_OFFERED',
  'MAKE_UP_NO_ROOM',
  'COVER_MODE_ON',
  'COVER_MODE_EXPIRED',
  'PLAN_DIVERGES_BY_HAND',
] as const;
export type ScheduleRefusal = (typeof SCHEDULE_REFUSALS)[number];

/** Требования, которые диагностика вправе снять на ступени 2. Порядок — порядок снятия. */
export const RELAXABLE = [
  'subject.pairing',
  'subject.priority',
  'teacher.methodDay',
] as const;

export const SCHEDULE_REFUSAL_TEXTS: Record<ScheduleRefusal, string> = {
  CALENDAR_NOT_READY: 'Календарь не настроен: не заданы учебные периоды {year}.',
  PLAN_EXCEEDS_SANPIN: '{class}: по учебному плану {total} ч в неделю при норме {cap} — нарушение СанПиН.',
  LOAD_EXCEEDS_SANPIN: '{class}: {total} ч в неделю при норме {cap} — нарушение СанПиН.',
  LOAD_EXCEEDS_GRID: '{class}: {total} ч не помещаются в {days} дней × {perDay} уроков.',
  SUBJECT_UNCOVERED: '{subject} в {class}: не назначен педагог{groups}.',
  GROUPS_UNASSIGNED: '{class}: группы объявлены, состав не назначен.',
  GROUP_HOURS_UNEQUAL: '{subject} в {class}: часы групп не равны ({hours}).',
  TEACHER_TIME_SHORT: '{teacher}: {hours} ч при {available} доступных уроках — методический день и обед оставляют меньше места, чем нагрузка.',
  METHOD_GROUP_NO_WINDOW: 'Методическое объединение «{group}»: {teacher} ведёт урок в это время.',
  PRIORITY_START_OVERFLOW: '{class}: часов первого приоритета {count} — они не помещаются в начала {days} учебных дней.',
  PAIRING_HOURS_ODD: '{subject}, {class}: спаренность обязательна, но часов нечётное число ({hours}).',
  PAIRING_FORBIDDEN_FIRST_GRADE: '{subject}, {class}: сдвоенные уроки в 1-х классах не проводятся, кроме физкультуры по лыжной подготовке и плаванию.',
  SKELETON_TOO_SHORT: 'Скелет «{skeleton}»: {positions} позиций при потребности {needed}.',
  RELAXATION_SUGGESTED: 'Расписание собирается, если {action}. Сделать?',
  PLAN_OR_CALENDAR_INVALID: 'Расписание не собирается при текущем учебном плане: {detail}.',
  MAKE_UP_OFFERED: '{subject} в {class}: час не проведён ({reason}). Добавить {date}, {slot} уроком?',
  MAKE_UP_NO_ROOM: '{subject} в {class}: добрать час на следующей неделе некуда — все дни заполнены до потолка.',
  COVER_MODE_ON: '{class}: {subject} снят с расписания — {teacher} больше не работает в школе. Подстраховка ещё {weeks} нед.',
  COVER_MODE_EXPIRED: '{class}: {subject} без педагога уже месяц, не проведено {debt} ч. Назначьте педагога или измените учебный план.',
  PLAN_DIVERGES_BY_HAND: '{subject} в {class}: после правки вручную за год выйдет {actual} ч вместо {planned} по учебному плану.',
};

/** Состояния асинхронной задачи генерации (AR-130). */
export const GENERATION_JOB_STATES = ['queued', 'running', 'done', 'refused', 'cancelled'] as const;
export type GenerationJobState = (typeof GENERATION_JOB_STATES)[number];

export interface GenerationJobDto {
  jobId: string;
  state: GenerationJobState;
  templateId?: string;
  refusal?: { code: ScheduleRefusal; details: Record<string, unknown> };
  /**
   * Служебные счётчики: пишутся в аудит и в отладку, но НЕ показываются
   * человеку. Экран генерации — модалка с анимацией, без единой цифры.
   */
  debug?: { variantsDone: number; variantsPlanned: number; bestPenalty: number };
}
