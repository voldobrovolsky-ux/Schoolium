/**
 * Блок «Расписание» УТЦ — контракт слоя качества, корректировки и выдачи.
 *
 * Спека: `specs/schedule-block/30-spec.md`. Решения: AR-118…AR-127.
 * Эталон поведения: `specs/schedule-block/model/quality.mjs` (Q1…Q12).
 *
 * Здесь только контракт — типы, коды и ЦЕЛЫЕ веса. Вычисления живут в
 * `apps/api/src/schoolium/schedule/quality.ts` и остаются чистыми функциями:
 * ворота G-56…G-60 доказывают их перечислением, без БД и сети.
 */

// ─────────────────────────── единый словарь (AR-143) ───────────────────────────

/**
 * Одно понятие — одно слово, и человеку оно говорится по-русски.
 *
 * Задача блока формулируется одной фразой владельца: **машина обязана
 * выстроить предметы комфортно и логично**. Всё остальное — способ это
 * посчитать, и способ не должен вылезать в разговор с человеком.
 *
 * Слева — слово, которое видит человек на экране и слышит в разговоре.
 * Справа — как та же вещь называется внутри кода. Смешивать их запрещено:
 * «штраф», «вес», «инверсия» и «свёртка» не появляются ни на одном экране.
 */
export const GLOSSARY = [
  { human: 'запрет', code: 'жёсткое ограничение (H*), инвариант (I-*)', means: 'нарушать нельзя никогда; сетка с нарушением наружу не выходит' },
  { human: 'правило удобства', code: 'маркер качества', means: 'стараемся соблюсти; нарушение считается и показывается' },
  { human: 'нарушений', code: 'штраф πᵢ', means: 'сколько раз правило нарушено в этой сетке' },
  { human: 'важность правила', code: 'вес wᵢ', means: 'насколько это правило важнее другого' },
  { human: 'общий счёт', code: 'свёртка Π', means: 'все нарушения вместе, с учётом важности' },
  { human: 'удобство расписания', code: 'агрегат Q', means: 'то же самое, но в процентах — понятнее человеку' },
  { human: 'предел', code: 'нижняя граница Π_LB', means: 'лучше уже не сделает никакая расстановка' },
  { human: 'улучшать больше нечем', code: 'локальный минимум', means: 'ни одна перестановка не делает лучше' },
  { human: 'предмет стоит позже, чем должен', code: 'инверсия приоритета', means: 'нарушение порядка предметов в дне' },
  { human: 'подсказка «собирается, если …»', code: 'диагностика релаксацией', means: 'что поправить, чтобы расписание сложилось' },
] as const;

/** Слова, которых человек видеть не должен — ни на экране, ни в тексте отказа. */
export const JARGON = ['штраф', 'вес ', 'маркер', 'инверси', 'свёртк', 'агрегат', 'локальн', 'релаксац', 'эвристик', 'окрестност'] as const;

// ─────────────────────────── правила удобства (AR-119) ───────────────────────────

/**
 * Правила удобства (внутри кода — маркеры качества). Порядок — порядок строк
 * панели на `S-40`, и расхождение между ними человек читает как два разных
 * списка.
 *
 * **Маркера «окно у педагога» здесь нет** (решение владельца 2026-08-27). Он
 * штрафовал окна как зло, и это оказалось предпочтением, а не свойством: одним
 * педагогам окно нужно, другим мешает, а при малом числе педагогов сетка и так
 * плотная и окон почти не даёт. Окна возникают как следствие расстановки, и
 * продукт по этому поводу мнения не имеет — оно появится вместе с пожеланиями
 * педагогов, когда те смогут их вносить сами.
 */
export const QUALITY_MARKERS = [
  'prio',
  'subjectSpread',
  'dayBalance',
  'stability',
  'teacherBalance',
  'groupEdge',
  'firstLast',
] as const;
export type QualityMarker = (typeof QUALITY_MARKERS)[number];

/**
 * Веса маркеров — **целые** (AR-118). Целость не стиль: доказательство
 * завершения локального поиска (§6.2 спеки) стоит на строгом убывании
 * Π(x) = Σ wᵢ·πᵢ(x) в ℤ≥0. Свёртка на вещественных числах зацикливается на
 * разнице порядка машинного эпсилон, и таймер это прячет, а не исключает.
 *
 * Порядок величин обоснован в §3.2 спеки: правовой приоритет (МР 2.4.0331-23,
 * базис #13) выше цены окна педагога, та выше эстетики сетки. Изменение любого
 * веса — решение реестра, а не правка константы: веса задают, какую сетку
 * продукт называет лучшей.
 */
export const QUALITY_WEIGHTS: Record<QualityMarker, number> = {
  prio: 8,
  subjectSpread: 6,
  dayBalance: 5,
  stability: 4,
  teacherBalance: 3,
  groupEdge: 2,
  firstLast: 2,
};

/**
 * Как правило называется человеку. Это те же строки, что на панели `S-40`, и
 * жаргона в них нет: человек читает «математика стоит последним уроком», а не
 * «маркер firstLast, штраф 20».
 */
export const QUALITY_MARKER_TITLES: Record<QualityMarker, string> = {
  prio: 'приоритетный предмет позже середины дня',
  subjectSpread: 'два часа предмета в один день',
  dayBalance: 'разброс дневной нагрузки класса',
  stability: 'расхождение с подтверждённой сеткой',
  teacherBalance: 'разброс дневной нагрузки педагога',
  groupEdge: 'групповой час не на краю дня',
  firstLast: 'приоритетный предмет последним уроком',
};

/** Штраф маркера: целое πᵢ ≥ 0, явная верхняя граница πᵢᵐᵃˣ > 0 и адреса виновных ячеек. */
export interface MarkerPenalty {
  pi: number;
  max: number;
  /** `класс:день:позиция` — по этим адресам панель качества подсвечивает сетку. */
  cells: string[];
}

export type PenaltyVector = Record<QualityMarker, MarkerPenalty>;

/** Ответ `GET /api/v1/schedule/quality`: агрегат, потолок, маркеры и свёртка. */
export interface ScheduleQualityDto {
  /** Q(x) ∈ [0,1] — взвешенное среднее нормированных маркеров. Представление. */
  aggregate: number;
  /** Π(x) ∈ ℤ≥0 — то, что минимизирует автокорректировка. */
  penalty: number;
  /**
   * Аналитическая нижняя граница Π: величина, ниже которой не опускается
   * никакая расстановка при данной нагрузке. Не обязана быть достижимой —
   * настоящий минимум лежит между ней и найденным локальным.
   */
  floor?: number;
  /**
   * Агрегат, который дала бы сетка, взявшая нижнюю границу по каждому маркеру.
   * Показывается рядом с `aggregate`: «88 % при пределе 93 %» — суждение,
   * «88 %» — число без шкалы.
   */
  ceiling?: number;
  markers: {
    id: QualityMarker;
    title: string;
    pi: number;
    max: number;
    /** Qᵢ = 1 − πᵢ/πᵢᵐᵃˣ ∈ [0,1]. */
    value: number;
    weight: number;
    cells: string[];
    /** Маркер `stability` без подтверждённой сетки точки отсчёта не имеет. */
    active: boolean;
  }[];
}

// ─────────────────────────── автопроверка (AR-120) ───────────────────────────

/**
 * Жёсткие инварианты сетки — машинная форма ограничений H1…H7 спеки плюс
 * проверка границ. Нарушение любого — дефект движка, а не ввода человека:
 * такая сетка не выходит наружу ни в каком виде (`INVARIANT_BROKEN`).
 */
export const SCHEDULE_INVARIANTS = ['I-1', 'I-2', 'I-3', 'I-4', 'I-5', 'I-6', 'I-7', 'I-8'] as const;
export type ScheduleInvariant = (typeof SCHEDULE_INVARIANTS)[number];

export const INVARIANT_TITLES: Record<ScheduleInvariant, string> = {
  'I-1': 'каждый час размещён ровно один раз',
  'I-2': 'педагог не занимает два урока одновременно',
  'I-3': 'класс не занимает два урока одновременно',
  'I-4': 'групповой час неделим: по одной части на группу',
  'I-5': 'у класса нет окон: уроки дня идут подряд',
  'I-6': 'уроков в день не больше потолка параллели',
  'I-7': 'координаты урока лежат в сетке недели',
  'I-8': 'учебный день не длиннее 420 минут',
};

/** Инварианты, за которыми стоит норма: их текст отказа называет источник. */
export const LEGAL_INVARIANTS: ScheduleInvariant[] = ['I-6', 'I-8'];

export interface InvariantViolation {
  code: ScheduleInvariant;
  /** `класс:день:позиция` либо идентификатор часа — адрес, а не описание. */
  address: string;
  message: string;
}

// ─────────────────────────── ходы (AR-121, AR-122) ───────────────────────────

/**
 * Ход — единственный способ изменить сетку, и он один и тот же у машины и у
 * человека. Различие не в множестве ходов, а в праве принять ход, ухудшающий
 * мягкий маркер: машина такого хода не делает, человек делает под подпись.
 */
export type ScheduleMove =
  | { kind: 'move'; unitId: string; dayNo: number; slotNo: number }
  | { kind: 'swap'; aId: string; bId: string };

/** Бюджет автокорректировки — потолок ожидания человека, не гарантия остановки. */
export const REPAIR_BUDGET = { seconds: 5, moves: 2000 } as const;

export interface RepairResultDto {
  templateId: string;
  movesApplied: number;
  penaltyBefore: number;
  penaltyAfter: number;
  /** Локальный минимум достигнут, а не бюджет исчерпан. */
  localMinimum: boolean;
}

export interface MoveResultDto {
  applied: boolean;
  penaltyBefore: number;
  penaltyAfter: number;
  /** Заполнено, когда ход ухудшает Π: какой маркер и на сколько. */
  degraded?: { marker: QualityMarker; title: string; delta: number }[];
  /** Обратный ход — его и применяет кнопка «отменить». */
  inverse?: ScheduleMove;
}

/** Происхождение слота: автокорректировка не трогает то, что подвинул человек. */
export const SLOT_ORIGINS = ['generated', 'repaired', 'manual'] as const;
export type SlotOrigin = (typeof SLOT_ORIGINS)[number];

// ─────────────────────────── выдача наружу (AR-124…AR-127) ───────────────────────────

/** Область ссылки. Ссылка области `teacher` не выдаёт сетку других педагогов. */
export const SHARE_SCOPES = ['class', 'teacher', 'school'] as const;
export type ShareScope = (typeof SHARE_SCOPES)[number];

export const EXPORT_FORMATS = ['csv', 'ics'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Срок жизни выданной ссылки — `[дефолт]`, вопрос В1 спеки. */
export const SHARE_TTL_DAYS = 90;

/**
 * Иммутабельная проекция подтверждённой сетки. Печать, файл и ссылка — проекции
 * ОДНОГО снимка (AR-124): собранные тремя путями, они расходятся, и школа
 * теряет арбитра в споре о том, что было в расписании в четверг.
 *
 * Персональных данных учеников в снимке нет по построению: слот занимает класс
 * либо группа, ученик в сетке не фигурирует.
 */
export interface ScheduleSnapshot {
  id: string;
  templateId: string;
  /** Версия сетки входит в подпись: новая версия обрывает старую ссылку сама. */
  version: number;
  generatedAt: string;
  params: { days: number; slotsPerDay: number; lessonMin: number; breakMin: number; bigBreakAfter: number; bigBreakMin: number };
  slots: {
    dayNo: number;
    slotNo: number;
    classId: string;
    classLabel: string;
    groupNo: number | null;
    subjectName: string;
    teacherName: string;
    origin: SlotOrigin;
  }[];
}

export interface SharedLinkDto {
  snapshotId: string;
  scope: ShareScope;
  /** Идентификатор класса либо педагога; для области `school` не заполняется. */
  targetId?: string;
  url: string;
  expiresAt: string;
  revokedAt?: string;
}

// ─────────────────────────── коды отказов блока ───────────────────────────

/**
 * Коды блока держатся отдельным перечислением, а не вливаются в `ERROR_CODES`
 * версии 1.1.1: ворота G-54 сверяют тот список с §9 экранного реестра
 * `70-screens.md` в обе стороны, и молчаливое пополнение уронило бы их. Слияние
 * списков происходит тем же коммитом, что вносит блок в версию и расширяет
 * G-54 текстами новых кодов (критерий готовности 6 спеки).
 */
export const SCHEDULE_BLOCK_ERRORS = [
  'INVARIANT_BROKEN',
  'MOVE_REJECTED',
  'MOVE_DEGRADES',
  'SNAPSHOT_NOT_FOUND',
  'SHARE_EXPIRED',
  'SHARE_REVOKED',
  'SHARE_VERSION_STALE',
  'EXPORT_FORMAT_UNSUPPORTED',
  // Леммы параметров шагов 4 и 5 (AR-132): каждое новое жёсткое ограничение
  // сужает область допустимых сеток, поэтому несёт отказ ДО перебора — иначе
  // модератор ждёт пять минут ради `NO_SOLUTION` без диагноза.
  'SUBJECT_MAX_PER_DAY_UNREACHABLE',
  'PAIRED_HOURS_ODD',
  'PAIRED_FORBIDDEN_FIRST_GRADE',
  'SUBJECT_POSITION_IMPOSSIBLE',
  'GROUP_EDGE_UNREACHABLE',
  'TEACHER_UNAVAILABLE_OVERBOOKED',
  'TEACHER_MAX_PER_DAY_UNREACHABLE',
  'TEACHER_NO_GAPS_UNREACHABLE',
] as const;
export type ScheduleBlockError = (typeof SCHEDULE_BLOCK_ERRORS)[number];

/**
 * `SHARE_EXPIRED` и `SHARE_REVOKED` отвечают одинаково по форме: различить
 * снаружи, отозвали ссылку или она истекла, нельзя.
 */
export const SCHEDULE_BLOCK_ERROR_TEXTS: Record<ScheduleBlockError, string> = {
  INVARIANT_BROKEN: 'Сетка нарушает правило «{invariant}» в ячейке {address}. Расписание не будет показано — нажмите «Регенерировать».',
  MOVE_REJECTED: 'Так поставить урок нельзя: {invariant}. Ячейка {address}.',
  MOVE_DEGRADES: 'Перестановка ухудшит расписание: {marker} — на {delta}. Применить всё равно?',
  SNAPSHOT_NOT_FOUND: 'Расписание по этой ссылке не найдено.',
  SHARE_EXPIRED: 'Срок действия ссылки истёк. Запросите новую у школы.',
  SHARE_REVOKED: 'Срок действия ссылки истёк. Запросите новую у школы.',
  SHARE_VERSION_STALE: 'Расписание изменилось после выдачи ссылки. Запросите новую у школы.',
  EXPORT_FORMAT_UNSUPPORTED: 'Формат «{format}» не поддерживается. Доступны: {formats}.',
  SUBJECT_MAX_PER_DAY_UNREACHABLE: '{subject} в {class}: {hours} ч в неделю не помещаются при ограничении {maxPerDay} ч в день и {days} учебных днях.',
  PAIRED_HOURS_ODD: '{subject} в {class}: сдвоенные уроки обязательны, но часов нечётное число ({hours}).',
  PAIRED_FORBIDDEN_FIRST_GRADE: '{subject} в {class}: сдвоенные уроки в 1-х классах не проводятся, кроме физкультуры по лыжной подготовке и плаванию.',
  SUBJECT_POSITION_IMPOSSIBLE: '{subject} в {class}: {hours} ч не помещаются в {available} разрешённых позиций недели.',
  GROUP_EDGE_UNREACHABLE: '{class}: групповых часов {hours}, а краёв дня за неделю только {available}.',
  TEACHER_UNAVAILABLE_OVERBOOKED: '{teacher}: {hours} ч при {available} доступных уроках — методический день и отметки занятости оставляют меньше места, чем нагрузка.',
  TEACHER_MAX_PER_DAY_UNREACHABLE: '{teacher}: {hours} ч в неделю не помещаются при ограничении {maxPerDay} уроков в день и {days} учебных днях.',
  TEACHER_NO_GAPS_UNREACHABLE: '{teacher}: требование «без окон» невыполнимо при {hours} ч и текущих отметках занятости.',
};

/** Право на выдачу расписания наружу — отдельно от права его строить (§11.1 спеки). */
export const SCHEDULE_SHARE_PERMISSION = 'schedule.share' as const;

/** События блока. Канон имён — AR-23, публичный контракт — AR-52. */
export const SCHEDULE_BLOCK_EVENTS = {
  templateRepaired: 'schedule.template.repaired.v1',
  slotMoved: 'schedule.slot.moved.v1',
  snapshotPublished: 'schedule.snapshot.published.v1',
  shareRevoked: 'schedule.share.revoked.v1',
} as const;
