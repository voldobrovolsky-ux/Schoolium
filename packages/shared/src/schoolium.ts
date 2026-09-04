/**
 * Schoolium 1.1.1 — канонический контракт фронт↔бэк (AR-36).
 *
 * Единственный источник ролей, прав, шкалы отметок, кодов отказа и форм всех
 * запросов/ответов версии. Обе стороны импортируют отсюда: дрейф формы ломает
 * `tsc`, а не обнаруживается в проде.
 *
 * Источники: `specs/school-onboarding/30-spec.md` (поведение),
 * `specs/school-onboarding/70-screens.md` §0, §9, §11 (экраны, коды, мутации).
 */

// ─────────────────────────── роли (AR-150) ───────────────────────────

/**
 * Восемь ролей версии 1.2.0 (AR-150). Роли совместимы: у пользователя МАССИВ
 * ролей. `admin` — полное управление workspace (реализует AR-148); `parent` и
 * `student` — читающие проекции (AR-155, AR-158). Слова словаря владельца,
 * ролями не являющиеся (`hostess`, `methodist`), зарезервированы именами и в
 * версии не существуют.
 */
export const SCHOOL_ROLES = [
  'founder',
  'director',
  'deputy_academic',
  'deputy_upbringing',
  'teacher',
  'moderator',
  'admin',
  'parent',
  'student',
] as const;
export type SchoolRole = (typeof SCHOOL_ROLES)[number];

export const ROLE_LABELS: Record<SchoolRole, string> = {
  founder: 'Учредитель',
  director: 'Директор',
  deputy_academic: 'Заместитель по учебной работе',
  deputy_upbringing: 'Заместитель по воспитательной работе',
  teacher: 'Преподаватель',
  moderator: 'Модератор школы',
  admin: 'Администратор школы',
  parent: 'Родитель',
  student: 'Ученик',
};

/** Штатные роли — те, чьи карточки живут на экране «Персонал» (`S-30`). */
export const STAFF_ROLES: SchoolRole[] = [
  'founder',
  'director',
  'deputy_academic',
  'deputy_upbringing',
  'teacher',
  'moderator',
  'admin',
];

/**
 * Секции экрана «Персонал» (`S-30`). `addable` — роли, которые заводятся
 * кнопкой «Добавить» этой секции (AR-182: замы ДОБАВЛЯЮТСЯ — школе без
 * bootstrap-слотов завуча иначе не создать; единственность синглтонов держит
 * сервер, а не отсутствие кнопки). У директора своей кнопки нет: его роль
 * выдаётся существующему сотруднику через `M-07`, единственность держит тот
 * же серверный синглтон.
 */
export const STAFF_SECTIONS = [
  { level: 1, title: 'Учредители и директор', roles: ['founder', 'director'] as SchoolRole[], addable: ['founder'] as SchoolRole[] },
  { level: 2, title: 'Заместители', roles: ['deputy_academic', 'deputy_upbringing'] as SchoolRole[], addable: ['deputy_academic', 'deputy_upbringing'] as SchoolRole[] },
  { level: 3, title: 'Преподаватели', roles: ['teacher'] as SchoolRole[], addable: ['teacher'] as SchoolRole[] },
] as const;

/**
 * Роли, существующие в школе не более чем в одном экземпляре (AR-182).
 * @deprecated см. DEFAULT_ROLE_LIMITS (AR-205): единственность — частный случай
 * лимита носителей роли `1`; экспорт оставлен для совместимости.
 */
export const SINGLETON_ROLES: SchoolRole[] = ['director', 'deputy_academic', 'deputy_upbringing'];

// ─────────────────────────── лимиты носителей ролей (AR-205) ───────────────────────────

/**
 * Лимит носителей роли в школе (AR-205, уточняет AR-182): `null` — без лимита,
 * отсутствие ключа — дефолт `DEFAULT_ROLE_LIMITS`. Хранится в
 * `SchoolAccessPolicy.roleLimits`, задаёт администратор в `S-62` «Политики».
 */
export type RoleLimits = Partial<Record<SchoolRole, number | null>>;

/** Дефолты владельца: директор и оба заместителя — по одному; остальные без лимита. */
export const DEFAULT_ROLE_LIMITS: RoleLimits = { director: 1, deputy_academic: 1, deputy_upbringing: 1 };

/** Верхняя граница лимита носителей роли — как у лимита сессий (AR-188). */
export const ROLE_LIMIT_MAX = 20;

/** Действующий лимит роли: `undefined` → дефолт, `null` → без лимита. */
export function effectiveRoleLimit(limits: RoleLimits, role: SchoolRole): number | null {
  const v = limits[role];
  if (v === undefined) return DEFAULT_ROLE_LIMITS[role] ?? null;
  return v;
}

// ─────────────────────────── права (19 кодов, AR-69, AR-88, AR-186, AR-206, AR-207) ───────────────────────────

/** Двенадцать мутационных прав версии. */
export const MUTATION_PERMISSIONS = [
  'school.manage',
  'contingent.write',
  'subject.write',
  'staff.manage',
  'schedule.build',
  // AR-174 (УТЦ v1.4): годовые нормы часов — ЕДИНСТВЕННОЕ право завуча в УТЦ
  'schedule.load.write',
  'journal.mark.post',
  'journal.topic.set',
  'staff.self.write',
  // 1.3.0 (AR-186): кабинет администратора — сеть, устройства, политики,
  // реестры, полный аудит школы. Держит ТОЛЬКО `admin`; модератор — нет.
  'school.admin',
  // 1.5.0 (AR-206, AR-207): педагог сам задаёт рабочие дни и отменяет СВОЙ
  // урок — два права с суффиксом `.self`: принадлежность проверяет сервис.
  'schedule.preference.self',
  'lesson.cancel.self',
] as const;

/** Пять читающих прав штатных ролей. Шаблона «*.read» не существует. */
export const READ_PERMISSIONS = [
  'classes.read',
  'subjects.read',
  'staff.read',
  'schedule.read',
  'journal.read',
] as const;

/** Проекции ученика и родителя (AR-158): дневник и средние по предметам. */
export const PROJECTION_PERMISSIONS = ['diary.read'] as const;

/**
 * Надзорное право завуча (AR-186): кабинет `S-61` — сводки готовности УТЦ и
 * КПЦ, чтение без единой мутации. Отдельная группа, а не «читающее право»:
 * пятёрка `*.read` выдаётся всем штатным ролям, а кабинет завуча — только
 * завучу и администратору.
 */
export const OVERSIGHT_PERMISSIONS = ['school.oversee'] as const;

export const SCHOOL_PERMISSIONS = [
  ...MUTATION_PERMISSIONS,
  ...READ_PERMISSIONS,
  ...PROJECTION_PERMISSIONS,
  ...OVERSIGHT_PERMISSIONS,
] as const;
export type SchoolPermission = (typeof SCHOOL_PERMISSIONS)[number];

/**
 * Пакеты прав ролей 1.2.0 — матрица владельца 2026-08-28 (AR-150…AR-152,
 * `specs/school-launch/20-cabinets.md` §2): все мутации — у администратора
 * школы; модератор держит КПЦ (классы, контингент, персонал, активации);
 * панель УТЦ (предметы, привязки, расписание) — у завуча; педагог пишет
 * отметки и темы только в своих уроках (проверка принадлежности — в сервисе
 * журнала). Гейты реальности не зависят от роли: `LESSON_NOT_HELD` отклоняет
 * отметку в непроведённый урок и админу.
 */
export const ROLE_PERMISSIONS: Record<SchoolRole, SchoolPermission[]> = {
  // 1.3.0 (AR-186): администратор держит все мутации, чтения и надзор —
  // три кабинета (`/admin`, `/moderator`, `/deputy`) открыты ему целиком.
  admin: [...MUTATION_PERMISSIONS, ...READ_PERMISSIONS, ...OVERSIGHT_PERMISSIONS],
  // AR-174: панель УТЦ (предметы, привязки, расписание) переезжает модератору…
  moderator: [...READ_PERMISSIONS, 'school.manage', 'contingent.write', 'staff.manage', 'staff.self.write', 'schedule.build', 'subject.write'],
  // …а завуч расставляет ТОЛЬКО годовые нормы часов: ни скелета, ни генерации,
  // ни календаря, ни привязок (решение владельца 2026-08-30, №9)
  deputy_academic: [...READ_PERMISSIONS, 'schedule.load.write', 'staff.self.write', 'school.oversee'],
  // AR-206, AR-207: педагог — пять мутаций: отметки, темы, аватар, предпочтения, отмена своего урока
  teacher: [...READ_PERMISSIONS, 'journal.mark.post', 'journal.topic.set', 'staff.self.write', 'schedule.preference.self', 'lesson.cancel.self'],
  founder: [...READ_PERMISSIONS, 'staff.self.write'],
  director: [...READ_PERMISSIONS, 'staff.self.write'],
  deputy_upbringing: [...READ_PERMISSIONS, 'staff.self.write'],
  parent: [...PROJECTION_PERMISSIONS],
  student: [...PROJECTION_PERMISSIONS],
};

// ─────────────────────────── отметки (6 значений, AR-79) ───────────────────────────

/** Порядок фиксирован — таким он показывается в `S-52`. */
export const MARK_VALUES = ['5', '4', '3', '2', 'н', 'б'] as const;
export type MarkValue = (typeof MARK_VALUES)[number];

/** Числовые отметки участвуют в среднем балле; «н» и «б» — нет (AR-79). */
export const NUMERIC_MARKS: MarkValue[] = ['5', '4', '3', '2'];
export const isNumericMark = (m: MarkValue): boolean => NUMERIC_MARKS.includes(m);

export const MARK_TOKENS: Record<MarkValue, string> = {
  '5': 'mark.m5',
  '4': 'mark.m4',
  '3': 'mark.m3',
  '2': 'mark.m2',
  'н': 'mark.n',
  'б': 'mark.b',
};

// ─────────────────────────── коды ошибок (46, `70-screens.md` §9) ───────────────────────────

export const ERROR_CODES = [
  'LINK_CODE_EXPIRED',
  'TOKEN_USED',
  'TOKEN_EXPIRED',
  // выведен из употребления в 1.2.0 (AR-154: телефон больше не ключ); код
  // остаётся в контракте — реестр кодов, как и АР-реестр, журнал, а не срез
  'PHONE_TAKEN_IN_SCHOOL',
  // контур учётки 1.2.0 (AR-153, AR-154, AR-156)
  'USERNAME_TAKEN',
  'USERNAME_INVALID',
  'PASSWORD_TOO_SHORT',
  'LOGIN_FAILED',
  'ACTIVATION_REVOKED',
  'CLASSES_ALREADY_EXIST',
  'TERM_OVERLAP',
  'TERM_REVERSED',
  // выведен из употребления (AR-199): СанПиН школой не применяется по решению
  // владельца; код не бросается, в контракте остаётся (прецедент PHONE_TAKEN_IN_SCHOOL)
  'LOAD_EXCEEDS_SANPIN',
  'LOAD_EXCEEDS_GRID',
  'GROUP_HOURS_UNEQUAL',
  'TEACHER_OVERBOOKED',
  'SUBJECT_UNCOVERED',
  'GROUPS_UNASSIGNED',
  // оба выведены из употребления (AR-199), в контракте остаются
  'DAY_EXCEEDS_SANPIN',
  'DAY_TOO_LONG',
  'CONCURRENT_EDIT',
  'NO_SOLUTION',
  'LESSON_NOT_HELD',
  'LESSON_DETACHED',
  // УТЦ v1.4 фаза I (AR-171, AR-172): скелет дня и развод перегруженного
  // LESSON_NOT_HELD — битое значение отметки больше не читается как «урок не прошёл»
  'SKELETON_INVALID',
  'MARK_VALUE_INVALID',
  // УТЦ v1.4 фаза IV (AR-175): ручная перестановка в черновике сетки
  'SWAP_CONFLICT',
  'CLASS_HAS_MARKS',
  'LAST_MODERATOR',
  'LAST_ROLE',
  'CALENDAR_YEAR_MISSING',
  'LOGIN_CODE_INVALID',
  'LOGIN_CODE_EXPIRED',
  'ACCESS_REVOKED',
  'STUDENT_INACTIVE',
  // AR-113: подмена кнопки решает сервер, но гейт живёт в контракте — между
  // открытием карточки и нажатием педагог мог поставить отметку.
  'STUDENT_HAS_MARKS',
  'STAFF_HAS_HISTORY',
  // 1.5.0 — пакет 04.09 (AR-199…AR-207), девять кодов
  // AR-201: карточка одна на пару «предмет × класс», дубль по ключу имени
  'SUBJECT_EXISTS',
  // AR-202: уменьшение числа групп при живых групповых привязках
  'GROUPS_BOUND',
  // AR-205: лимит носителей роли исчерпан (вместо «единственного экземпляра»)
  'ROLE_LIMIT_REACHED',
  // AR-204: ссылка входа с лимитом открытий использована
  'LINK_EXHAUSTED',
  // AR-206: часов педагога больше, чем урочных позиций в его рабочие дни
  'TEACHER_DAYS_SHORT',
  // AR-207: отмена урока и замена
  'NOT_YOUR_LESSON',
  'LESSON_ALREADY_HELD',
  'LESSON_CANCELLED',
  'SUBSTITUTE_BUSY',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Семь кодов отказа генератора. Шесть считаются **арифметикой до перебора**
 * (AR-107, AR-199, AR-206); `NO_SOLUTION` — единственный отказ самого перебора,
 * он же отвечает на исчерпание бюджета. Три кода СанПиН (`LOAD_EXCEEDS_SANPIN`,
 * `DAY_EXCEEDS_SANPIN`, `DAY_TOO_LONG`) сняты с AR-199 — школа норм не
 * применяет; `TEACHER_DAYS_SHORT` добавлен с AR-206 (рабочие дни педагога).
 */
export const ARITHMETIC_REFUSALS = [
  'LOAD_EXCEEDS_GRID',
  'TEACHER_OVERBOOKED',
  'SUBJECT_UNCOVERED',
  'GROUPS_UNASSIGNED',
  'GROUP_HOURS_UNEQUAL',
  'TEACHER_DAYS_SHORT',
] as const;
export const GENERATOR_REFUSALS = [...ARITHMETIC_REFUSALS, 'NO_SOLUTION'] as const;
export type GeneratorRefusal = (typeof GENERATOR_REFUSALS)[number];

/** Ответ об ошибке: код, человекочитаемый текст с объектом и цифрами, requestId (AR-97). */
export interface SchoolErrorBody {
  code: ErrorCode;
  message: string;
  requestId: string;
  details?: Record<string, unknown>;
}

// ─────────────────────────── параметры контура доступа (AR-94) ───────────────────────────

/** Все значения — `[дефолт]`: меняются решением владельца, механики не меняют. */
export const ACCESS_PARAMS = {
  /** Минимальная длина пароля при ручной замене сгенерированного (AR-156). */
  passwordMinLength: 8,
  sessionDays: 90,
  deviceLinkTtlMinutes: 3,
  activationTtlMinutes: 15,
  bindTokenTtlMinutes: 5,
  loginCodeTtlMinutes: 5,
  loginCodeDigits: 6,
  /**
   * Ссылка входа — bootstrap первого модератора (AR-93), учётки `provision`
   * и ссылка с карточки сотрудника из кабинета администратора (AR-189).
   * 48 часов — решение владельца 2026-09-02 (прежде 24); многоразовая до
   * истечения срока — решение владельца 2026-09-03 (AR-195).
   */
  bootstrapLinkTtlHours: 48,
  loginLinkTtlHours: 48,
  /**
   * AR-204: срок и число открытий ссылки входа выбирает выпускающий
   * (`S-31.select.linkTtl`, `S-31.select.linkUses`); 48 часов остаётся дефолтом
   * срока, `null` («без лимита») — дефолтом числа открытий.
   */
  loginLinkTtlOptions: [24, 48, 168],
  loginLinkUsesOptions: [1, 3, 10, null],
  /** Порог «в сети»: последняя активность сессии не старше N минут (AR-187). */
  sessionOnlineMinutes: 15,
  /** Хранение завершённых сессий в журнале подключений (AR-187, AR-194). */
  sessionJournalDays: 90,
  pollIntervalMs: 2000,
} as const;

/** Бюджет перебора генератора (AR-107): что раньше — секунды или попытки. */
export const GENERATOR_BUDGET = { seconds: 20, attempts: 200_000 } as const;

// Потолки СанПиН и длины дня: в рантайме не используются с AR-199 (генератор и
// сервис их не читают, коды не бросаются); читает только слой качества
// `quality.ts` (G-56/57). Экспорты оставлены — контракт журнал, а не срез.

/** Потолок длины учебного дня — продуктовый дефолт владельца, не норма (AR-103). В рантайме не используется с AR-199. */
export const DAY_MINUTES_CAP = 420;

/** Дневной потолок уроков по параллелям — СанПиН 1.2.3685-21 табл. 6.6 (базис #11). В рантайме не используется с AR-199; читает только `quality.ts`. */
export const DAY_SLOTS_CAP: Record<number, number> = {
  1: 4, 2: 5, 3: 5, 4: 5, 5: 6, 6: 6, 7: 7, 8: 7, 9: 7, 10: 7, 11: 7,
};

/**
 * AR-114 (вытеснено AR-199 — в рантайме не используется, читает только
 * `quality.ts`): «уроков в день» — ВЕРХНЯЯ ГРАНИЦА школьного дня, одна на школу, а
 * потолок СанПиН нормирует параллель. День класса — `min(число, потолок его
 * параллели)`; отказ `DAY_EXCEEDS_SANPIN` — только когда число выше потолка
 * самой старшей параллели школы. Иначе школа с первым и восьмым классом обязана
 * поставить 4 урока в день всем и не собирается вовсе.
 */
export const classDayCap = (parallel: number, slotsPerDay: number): number =>
  Math.min(slotsPerDay, DAY_SLOTS_CAP[parallel] ?? 0);

export const schoolDayCap = (parallels: number[]): number =>
  Math.max(0, ...parallels.map((p) => DAY_SLOTS_CAP[p] ?? 0));

/** Недельный потолок часов по параллелям — СанПиН, 5-дневка (базис #3). В рантайме не используется с AR-199; читает только `quality.ts`. */
export const WEEK_HOURS_CAP: Record<number, number> = {
  1: 21, 2: 23, 3: 23, 4: 23, 5: 29, 6: 30, 7: 32, 8: 33, 9: 33, 10: 34, 11: 34,
};

// ─────────────────────────── FSM онбординга (AR-72) ───────────────────────────

export const SCHOOL_STATES = [
  'empty',
  'classes_created',
  'students_filled',
  'subjects_created',
  'staff_activated',
  'teachers_bound',
  'terms_set',
  'load_set',
  'priorities_set',
  'day_params_set',
  'generated',
  'stale',
  'ready',
] as const;
export type SchoolState = (typeof SCHOOL_STATES)[number];

// ─────────────────────────── контингент ───────────────────────────

export type Sex = 'm' | 'f';

export interface ClassDto {
  id: string;
  parallel: number;
  letter: string | null;
  label: string;
  groupCount: number;
  students: number;
  /** Заполненные и всего — `M-13` называет первое число (AR-105). */
  filledProfiles: number;
  totalProfiles: number;
  /** Сервер решает, какая кнопка показывается: удалить или ничего (AR-89). */
  hasMarks: boolean;
  /**
   * AR-200: после какого урока у класса обед; `null` — как у школы (позиция
   * `meal` скелета). Класс с `N` не имеет урока в урочной позиции `N+1`.
   */
  lunchAfterLessonNo: number | null;
}

/** Обед одного класса (AR-200): `null` — как у школы. */
export interface ClassLunchEntryDto {
  classId: string;
  lunchAfterLessonNo: number | null;
}

/** `PUT /schedule/lunch` (AR-200): обед по классам, версия агрегата расписания (AR-109). */
export interface SetClassLunchDto {
  version: number;
  entries: ClassLunchEntryDto[];
}

/**
 * `PUT /classes/:id/groups` (AR-202): число групп класса — 0 (без групп), 2, 3
 * или 4; валидирует сервер. Уменьшение при живых групповых привязках →
 * `GROUPS_BOUND`. Версия — контингента (AR-109).
 */
export interface SetClassGroupsDto {
  groupCount: number;
  version: number;
}

export interface StudentDto {
  id: string;
  classId: string;
  lastName: string;
  firstName: string;
  middleName: string | null;
  sex: Sex | null;
  groupNo: number | null;
  deactivated: boolean;
  /** Правило подмены кнопки «удалить» → «деактивировать» (AR-78). */
  hasMarks: boolean;
  filled: boolean;
}

/** Численность ОДНОГО класса, когда она отличается от общей. */
export interface ClassHeadcountDto {
  /** Имя класса как его показал мастер: «5» или «5А». */
  label: string;
  students: number;
  /** Число учеников пола, названного в `sexKind`. */
  sexCount: number;
}

export interface CreateClassesDto {
  parallels: number;
  /** Список литер либо `null` — явный отказ «⌀ Без литер» (AR-77). */
  letters: string[] | null;
  studentsPerClass: number;
  /** 2…4 либо `null` — явный отказ «⌀ Без групп» (AR-77). */
  groups: number | null;
  sexKind: 'boys' | 'girls';
  sexCount: number;
  /**
   * Поклассные численности. Одно число на всю школу — ложь про любую реальную
   * школу: в 1-м классе не столько же детей, сколько в 11-м, и мальчиков в них
   * не поровну. `studentsPerClass` и `sexCount` остаются значением по
   * умолчанию, которым таблица заполняется, а строки её переопределяют.
   * Отсутствует или `null` — все классы одинаковы.
   */
  perClass?: ClassHeadcountDto[] | null;
  /** Версия прочитанного состояния контингента (AR-109). */
  version: number;
}

export interface UpsertStudentDto {
  lastName: string;
  firstName: string;
  middleName?: string | null;
  sex: Sex;
  groupNo?: number | null;
}

// ─────────────────────────── предметы и привязки ───────────────────────────

export type BindingScope = 'class' | 'group';

export interface SubjectDto {
  id: string;
  name: string;
  classId: string;
  classLabel: string;
  priority: boolean;
  bindings: BindingDto[];
  /** «Покрытие полное» либо перечень непокрытых групп. */
  coverageComplete: boolean;
  uncoveredGroups: number[];
  /** AR-202: число групп класса карточки — `M-25` рисует по нему чекбоксы групп. */
  groupCount: number;
}

export interface BindingDto {
  id: string;
  teacherId: string;
  teacherName: string;
  avatarUrl: string | null;
  scope: BindingScope;
  groupNos: number[];
  hoursPerWeek: number;
  /** Годовая норма, введённая завучем (AR-180); недельная — производная. */
  hoursPerYear: number;
}

// ─────────────────────────── ключ имени предмета (AR-201) ───────────────────────────

/**
 * Ключ имени предмета (AR-201): trim, пробелы схлопнуты в один, нижний регистр,
 * «ё» → «е». «Алгебра», « алгебра » и «АЛГЕБРА» — одна карточка в классе; хранится
 * в `SchoolSubject.nameKey`, тем же правилом бэкфиллит миграция.
 */
export function subjectNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase().replace(/ё/g, 'е');
}

/**
 * Каноническое имя предмета (AR-201): совпадение по ключу с пресетом — имя
 * пресета; иначе trim, схлопнутые пробелы и первая буква заглавной.
 */
export function canonicalSubjectName(name: string, presetNames: string[]): string {
  const key = subjectNameKey(name);
  const preset = presetNames.find((p) => subjectNameKey(p) === key);
  if (preset) return preset;
  const clean = name.trim().replace(/\s+/g, ' ');
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : clean;
}

// ─────────────────────────── компетенции педагога (AR-179, AR-202) ───────────────────────────

/**
 * Массовое назначение компетенций (AR-179): модератор сканирует ЛИЧНЫЙ QR
 * педагога (или выбирает его из списка) и галочками закрывает позиции
 * «предмет × класс» на весь класс. Снятая галочка ОТКРЕПЛЯЕТ педагога от
 * позиции; занятая другим позиция при `replace=false` возвращается конфликтом,
 * при `replace=true` прежние педагоги открепляются тем же событием
 * `subject.teacher.unbound.v1`. AR-202: групповые позиции назначаются этим же
 * каналом через `positions[].groupNos`; класс↔группы на одной карточке
 * взаимоисключены (Д6) — чужая привязка другого вида возвращается конфликтом.
 */
export interface SaveCompetenceDto {
  teacherId: string;
  /** Позиции «предмет × класс», которые педагог ДОЛЖЕН вести классом. */
  subjectIds: string[];
  /**
   * AR-202: позиции с группами. При наличии — приоритет над `subjectIds`;
   * пустой/отсутствующий `groupNos` = весь класс.
   */
  positions?: { subjectId: string; groupNos?: number[] }[];
  replace?: boolean;
}

export interface CompetenceConflictDto {
  subjectName: string;
  classLabels: string[];
  teacherNames: string[];
  /** AR-202: номер группы конфликта; отсутствует — конфликт по всему классу. */
  groupNo?: number;
}

export interface SaveCompetenceResultDto {
  ok: boolean;
  /** Заполнено при `ok=false`: занятые позиции, ждущие подтверждения замены. */
  conflicts?: CompetenceConflictDto[];
  bound: number;
  unbound: number;
}

export interface CreateSubjectDto {
  name: string;
  classId: string;
}

export interface BindTeacherDto {
  token: string;
  scope: BindingScope;
  groupNos?: number[];
}

/**
 * Ручная привязка педагога из карточки предмета (AR-177, УТЦ v1.4 фаза V):
 * QR остаётся основным каналом, ручная — равноправный запасной. Даёт тот же
 * `TeacherBinding` и то же событие `teacher.bound.v1`, что скан.
 */
export interface BindTeacherManualDto {
  teacherId: string;
  scope: BindingScope;
  groupNos?: number[];
}

// ─────────────────────────── персонал ───────────────────────────

export interface StaffCardDto {
  id: string;
  section: 1 | 2 | 3;
  /** Роли: у незаполненной карточки — намеченные, дальше — из членства. */
  roles: SchoolRole[];
  /**
   * 1.2.0 (AR-161): учётка заведена целиком модератором, поэтому «зарегистрирован»
   * значит «активировал вход сканом», а не «заполнил форму». Карточки с
   * `registered: false` и заполненными ФИО — список «Не авторизованные» (`S-32`).
   */
  registered: boolean;
  /** Учётка заведена (ФИО+юзернейм+пароль есть); false — пустая карточка-слот. */
  filled: boolean;
  userId: string | null;
  name: string | null;
  lastName: string | null;
  firstName: string | null;
  middleName: string | null;
  username: string | null;
  avatarUrl: string | null;
  deactivated: boolean;
  /** Сервер решает: удалить (нет истории) либо деактивировать (AR-89). */
  hasHistory: boolean;
}

/** Заведение учётки сотрудника модератором (AR-154): ФИО + юзернейм + пароль. */
export interface CreateStaffCardDto {
  role: SchoolRole;
  lastName: string;
  firstName: string;
  middleName?: string | null;
  /** Пустой — сервер предзаполнит транслитерацией ФИО. */
  username?: string | null;
  /** Пустой — сервер сгенерирует и вернёт открытым текстом один раз. */
  password?: string | null;
}

/** Заполнение существующей пустой карточки (синглтоны из bootstrap). */
export type FillStaffCardDto = Omit<CreateStaffCardDto, 'role'>;

/** `PUT /staff/:id/account` (AR-203): ФИО и логин учётки правит `staff.manage`. */
export interface UpdateStaffAccountDto {
  lastName: string;
  firstName: string;
  middleName?: string | null;
  username: string;
}

/** `POST /staff/:id/password` (AR-203): пусто — сгенерировать; иначе ≥ 8 знаков. */
export interface SetStaffPasswordDto {
  password?: string;
}

/** Креды, показанные модератору на карточке. Пароль — открытым текстом, один раз. */
export interface CredentialsDto {
  username: string;
  password: string;
}

/** Вход по юзернейму и паролю (`S-05′`, AR-156) — фолбэк слетевшей сессии. */
export interface LoginDto {
  username: string;
  password: string;
}

export type TokenStatus = 'waiting' | 'scanned' | 'used' | 'expired';

export interface ActivationTokenDto {
  token: string;
  status: TokenStatus;
  expiresAt: string;
  /** ФИО владельца карточки — подпись над QR (AR-161). */
  fullName?: string | null;
  /** После скана — идентичность сканировавшего (AR-87). */
  scannedByName?: string | null;
  registeredName?: string | null;
}

export interface LoginCodeDto {
  code: string;
  expiresAt: string;
}

// ─────────────────── доступы учеников и родителей (AR-155) ───────────────────

/** Состояние входа ученика поверх записи контингента. */
export interface StudentAccessDto {
  studentId: string;
  hasAccount: boolean;
  username: string | null;
  activated: boolean;
}

/** Карточка родителя (`S-14`): учётка + связи с детьми ведутся модератором. */
export interface GuardianCardDto {
  id: string;
  userId: string | null;
  name: string | null;
  lastName: string | null;
  firstName: string | null;
  middleName: string | null;
  username: string | null;
  registered: boolean;
  children: { studentId: string; name: string; classLabel: string }[];
}

export interface CreateGuardianDto {
  lastName: string;
  firstName: string;
  middleName?: string | null;
  username?: string | null;
  password?: string | null;
  studentIds?: string[];
}

/** «Не авторизованные» (`S-32`): рабочий экран модератора на событии. */
export interface PendingActivationsDto {
  staff: { cardId: string; name: string; roles: SchoolRole[] }[];
  students: { classId: string; classLabel: string; items: { studentId: string; name: string; hasAccount: boolean }[] }[];
  guardians: { cardId: string; name: string }[];
}

// ─────────────────── дневник и успеваемость (AR-158, AR-159) ───────────────────

export interface DiaryLessonDto {
  lessonId: string;
  slotNo: number;
  subjectName: string;
  topic: string | null;
  mark: MarkValue | null;
  /** AR-207: урок отменён без замены — строка «Урок отменён». */
  cancelled: boolean;
  /** AR-207: «Фамилия И.» заместителя; `null` — ведёт свой педагог. */
  substituteName: string | null;
}

export interface DiaryDayDto {
  date: string; // YYYY-MM-DD
  lessons: DiaryLessonDto[];
}

export interface DiaryWeekDto {
  studentId: string;
  studentName: string;
  classLabel: string;
  monday: string;
  /** Сетка времён подтверждённого расписания; null — расписания ещё нет. */
  grid: DayGridDto | null;
  /** Скелет дня (AR-171); null — фолбэк на grid. */
  skeleton?: SkeletonPositionDto[] | null;
  /** AR-200: обед класса ученика после урока N; `null`/отсутствует — как у школы. */
  lunchAfterLessonNo?: number | null;
  days: DiaryDayDto[];
  /** Недели журнала для навигации — как календарь `S-50`. */
  weeks: { monday: string; hasLessons: boolean }[];
}

/** Средний балл по предмету за текущую четверть; числовых нет — null («—»). */
export interface SubjectAverageDto {
  subjectId: string;
  subjectName: string;
  average: number | null;
  marks: number;
}

export interface DiaryChildDto {
  studentId: string;
  name: string;
  classLabel: string;
}

// ─────────────────────────── юзернейм (AR-154, правила Флёруса) ───────────────────────────

/**
 * Правила Флёруса дословно (AR-157: мягкая миграция — юзернейм переносится как
 * есть): латиница в нижнем регистре, цифры, подчёркивание; 3–30 символов.
 */
export const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

/**
 * Резервный список: маршруты обеих систем и платформенные имена. Подмножество
 * списка Флёруса, достаточное для Schoolium; сверка полного — при миграции.
 */
export const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'moderator', 'root', 'system', 'support', 'help',
  'schoolium', 'edustore', 'florus', 'flor', 'communitoria',
  'api', 'login', 'logout', 'join', 'bootstrap', 'link', 'bind', 'code',
  'account', 'settings', 'me', 'user', 'users', 'school', 'teacher', 'student',
  'parent', 'director', 'founder', 'diary', 'journal', 'schedule', 'classes',
]);

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Предзаполнение юзернейма транслитерацией ФИО: «Иванова Мария» → `m_ivanova`. */
export function usernameFromFio(lastName: string, firstName: string): string {
  const tr = (s: string): string =>
    s.toLowerCase().split('').map((ch) => TRANSLIT[ch] ?? (/[a-z0-9]/.test(ch) ? ch : '')).join('');
  const base = [tr(firstName).slice(0, 1), tr(lastName)].filter(Boolean).join('_');
  return base.slice(0, 30).padEnd(3, '0');
}

export function usernameProblem(u: string): 'invalid' | 'reserved' | null {
  if (!USERNAME_RE.test(u)) return 'invalid';
  if (RESERVED_USERNAMES.has(u)) return 'reserved';
  return null;
}

// ─────────────────────────── календарь ───────────────────────────

export interface TermDto {
  termNo: 1 | 2 | 3 | 4;
  dateFrom: string; // YYYY-MM-DD
  dateTo: string;
}

/**
 * Рекомендованный график четвертей — ФООП (базис #5): 34 учебные недели, четыре
 * четверти по **8 / 8 / 11 / 7** недель, каникулы между ними 1 / 2 / 1 неделя.
 * Учебный год начинается 1 сентября.
 *
 * Это ПРЕДЗАПОЛНЕНИЕ панелей `S-41.panel.term[1..4]`, а не хранимый период:
 * владелец периодов — календарь (AR-68), и в него даты попадают только тем,
 * что модератор нажал «Далее». Числа взяты из базиса, а не выдуманы: сумма
 * недель ровно 34, «школа вправе сдвигать даты» — поэтому панели редактируемы.
 */
export const FOOP_TERM_WEEKS = [8, 8, 11, 7] as const;
/** Каникулы между четвертями, недель: осенние, зимние, весенние. */
export const FOOP_BREAK_WEEKS = [1, 2, 1] as const;

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Учебный год дня. Сентябрь-декабрь — год начала; январь-май — год предыдущий
 * (учебный год ещё идёт). **Июнь-август принадлежат наступающему году**: школа,
 * которая заводит расписание в августе, готовит сентябрь, а не пересобирает
 * прошлый май — предзаполнить её панели ушедшим годом значило бы предложить
 * даты, которые она обязана стереть.
 */
export const academicYearOf = (isoDay: string): number => {
  const [y, m] = isoDay.split('-').map(Number);
  return m >= 6 ? y : y - 1;
};

/** Четыре панели, предзаполненные графиком ФООП от 1 сентября учебного года. */
export function recommendedTerms(isoDay: string): TermDto[] {
  let cursor = `${academicYearOf(isoDay)}-09-01`;
  const out: TermDto[] = [];
  for (let i = 0; i < 4; i += 1) {
    const dateTo = addDays(cursor, FOOP_TERM_WEEKS[i] * 7 - 1);
    out.push({ termNo: (i + 1) as 1 | 2 | 3 | 4, dateFrom: cursor, dateTo });
    if (i < 3) cursor = addDays(dateTo, FOOP_BREAK_WEEKS[i] * 7 + 1);
  }
  return out;
}

export interface SetTermsDto {
  terms: TermDto[];
}

// ─────────────────────────── расписание ───────────────────────────

/**
 * Учебных недель в году — 34 (график ФООП) [дефолт]. Единственная точка
 * конверсии годовой нормы часов в недельную (AR-180): завуч вводит ГОД,
 * генератор потребляет НЕДЕЛЮ.
 */
export const SCHOOL_YEAR_WEEKS = 34;
export const weeklyOfYear = (hoursPerYear: number): number =>
  hoursPerYear > 0 ? Math.max(1, Math.round(hoursPerYear / SCHOOL_YEAR_WEEKS)) : 0;

/** Ввод норм — ГОДОВЫМИ часами (AR-180); недельные — производная `weeklyOfYear`. */
export interface LoadEntryDto {
  bindingId: string;
  hoursPerYear: number;
}

export interface SetLoadDto {
  entries: LoadEntryDto[];
  /** Версия прочитанного состояния расписания (AR-109). */
  version: number;
}

export interface SetPrioritiesDto {
  /** Пустой список допустим только вместе с `explicitNone` (AR-77). */
  subjectIds: string[];
  explicitNone: boolean;
}

export interface DayParamsDto {
  slotsPerDay: number;
  lessonMin: number;
  breakMin: number;
  days: 5 | 6;
  bigBreakAfter: number;
  bigBreakMin: number;
  /** Начало первого урока, минуты от полуночи (540 = 9:00). Отсутствует у старых клиентов — сервер берёт 540. */
  dayStartMin?: number;
  version: number;
}

/** Временная сетка дня — из подтверждённого шаблона: времена уроков и перемен считаются из неё, а не хранятся. */
export interface DayGridDto {
  dayStartMin: number;
  lessonMin: number;
  breakMin: number;
  bigBreakAfter: number;
  bigBreakMin: number;
}

// ── скелет дня (AR-171, УТЦ v1.4) ──────────────────────────────────────────
export type SkeletonKind = 'lesson' | 'meal' | 'event';
export type GridKind = 'paired' | 'variable';

/**
 * Позиция скелета дня: явные времена, тип и место в общей нумерации.
 * У `lesson` обязателен `lessonNo` (номер урока в дне — стык со `slotNo`
 * шаблона); `pairNo` группирует части пары (внутри пары перемены нет, AR-171).
 * У `meal`/`event` обязателен `title` («Обед/прогулка», «Линейка»…).
 */
export interface SkeletonPositionDto {
  dayNo: number; // 0=ПН … 6=ВС
  posNo: number; // 1-based порядок в дне
  kind: SkeletonKind;
  title?: string | null;
  startMin: number;
  endMin: number;
  lessonNo?: number | null;
  pairNo?: number | null;
}

export interface DaySkeletonDto {
  gridKind: GridKind;
  positions: SkeletonPositionDto[];
  /** AR-200: обед по классам — читается вместе со скелетом, пишется `PUT /schedule/lunch`. */
  classLunch: ClassLunchEntryDto[];
  version: number;
}

export interface SetSkeletonDto {
  gridKind: GridKind;
  positions: SkeletonPositionDto[];
  /** Версия агрегата расписания (AR-109). */
  version: number;
}

/** Время урока № lessonNo дня dayNo по скелету; null — позиции нет (фолбэк на slotTimes). */
export function skeletonLessonTimes(
  positions: SkeletonPositionDto[],
  dayNo: number,
  lessonNo: number,
): { start: string; end: string; startMin: number; endMin: number; pairNo: number | null } | null {
  const p = positions.find((x) => x.dayNo === dayNo && x.kind === 'lesson' && x.lessonNo === lessonNo);
  if (!p) return null;
  return { start: fmtMin(p.startMin), end: fmtMin(p.endMin), startMin: p.startMin, endMin: p.endMin, pairNo: p.pairNo ?? null };
}

const fmtMin = (m: number): string => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

/** Время урока № slotNo (1-based) и длина перемены ПОСЛЕ него. */
export function slotTimes(g: DayGridDto, slotNo: number): { start: string; end: string; breakAfterMin: number } {
  let start = g.dayStartMin;
  for (let i = 1; i < slotNo; i += 1) {
    start += g.lessonMin + (i === g.bigBreakAfter ? g.bigBreakMin : g.breakMin);
  }
  return {
    start: fmtMin(start),
    end: fmtMin(start + g.lessonMin),
    breakAfterMin: slotNo === g.bigBreakAfter ? g.bigBreakMin : g.breakMin,
  };
}

export interface TemplateSlotDto {
  dayNo: number;
  slotNo: number;
  classId: string;
  classLabel: string;
  groupNo: number | null;
  subjectId: string;
  subjectName: string;
  teacherId: string;
  teacherName: string;
}

export interface SchedulePreviewDto {
  templateId: string;
  seed: number;
  status: 'draft' | 'confirmed' | 'stale';
  /** Временная сетка шаблона — для времён уроков на экранах. */
  grid: DayGridDto;
  /** Скелет дня (AR-171); null/отсутствует — школа живёт на grid (фолбэк). */
  skeleton?: SkeletonPositionDto[] | null;
  gridKind?: GridKind;
  /** AR-200: обед по классам — `S-40` вставляет строку «Обед» после урока N. */
  classLunch?: ClassLunchEntryDto[];
  slots: TemplateSlotDto[];
  /** Мягкие предупреждения приоритетов — не блокируют (ограничение 6). */
  priorityWarnings: string[];
  /** Уроки с отметками, которых нет в новом шаблоне (`S-42.warn.detach`). */
  willDetach: number;
  version: number;
}

export interface ConfirmScheduleDto {
  templateId: string;
  version: number;
}

/**
 * Ручная правка черновика сетки (`S-43`, УТЦ v1.4 фаза IV): перестановка двух
 * слотов ОДНОГО класса местами. Правится только черновик — подтверждённая
 * сетка меняется регенерацией; версия — AR-109.
 */
export interface SwapSlotsDto {
  templateId: string;
  version: number;
  a: { dayNo: number; slotNo: number };
  b: { dayNo: number; slotNo: number };
  classId: string;
}

// ─────────────────────────── предпочтения педагога (AR-206) ───────────────────────────

/**
 * Рабочие дни педагога (AR-206, уточняет AR-135: задаёт сам, без утверждения).
 * `workDays` — номера дней 0..5 (ПН…СБ); пустой список = любой день.
 * Версии агрегата нет: сохранение — событие `schedule.preference.set.v1`,
 * подтверждённая сетка → stale.
 */
export interface TeacherPreferenceDto {
  teacherId: string;
  workDays: number[];
  note: string | null;
}

/** `PUT /schedule/preferences/me` (AR-206). */
export interface SetTeacherPreferenceDto {
  workDays: number[];
  note?: string | null;
}

// ─────────────────────────── отмена урока и замена (AR-207) ───────────────────────────

/** Причины отмены урока педагогом (AR-207). */
export const LESSON_CANCEL_REASONS = ['absence', 'training', 'official', 'other'] as const;
export type LessonCancelReason = (typeof LESSON_CANCEL_REASONS)[number];

export const LESSON_CANCEL_REASON_LABELS: Record<LessonCancelReason, string> = {
  absence: 'отсутствие педагога',
  training: 'обучение, курсы',
  official: 'служебная необходимость',
  other: 'другое',
};

/** Состояние записи замены (AR-207): найден заместитель | замены нет | отзыв. */
export const LESSON_SUBSTITUTION_STATUSES = ['substituted', 'no_substitute', 'withdrawn'] as const;
export type LessonSubstitutionStatus = (typeof LESSON_SUBSTITUTION_STATUSES)[number];

/**
 * Запись замены датированного урока (AR-207). `reasonText` виден только
 * `staff.manage` / `schedule.build` / `school.oversee`; остальным — `null`.
 */
export interface LessonSubstitutionDto {
  status: LessonSubstitutionStatus;
  originalTeacherId: string;
  originalTeacherName: string;
  substituteTeacherId: string | null;
  substituteTeacherName: string | null;
  reason: LessonCancelReason;
  reasonText: string | null;
}

/** `GET /schedule/lessons?from&to[&classId][&teacherId]` (AR-207): датированный оверлей недели `S-40`. */
export interface DatedLessonDto {
  lessonId: string;
  date: string; // YYYY-MM-DD
  slotNo: number;
  classId: string;
  classLabel: string;
  groupNo: number | null;
  subjectId: string;
  subjectName: string;
  /** Текущий педагог урока — заместитель, если замена состоялась. */
  teacherId: string;
  teacherName: string;
  detached: boolean;
  substitution: LessonSubstitutionDto | null;
}

/** `POST /lessons/:id/cancel` (AR-207): свой будущий урок. */
export interface CancelLessonDto {
  reason: LessonCancelReason;
  reasonText?: string;
}

/** `POST /lessons/:id/substitute` (AR-207): ручное назначение заместителя (`schedule.build`). */
export interface SetSubstituteDto {
  teacherId: string;
}

/** Итог автоподбора замены (AR-207): «Замена: Иванова М. И.» либо «Замены нет — сообщено завучу». */
export interface SubstitutionResultDto {
  status: 'substituted' | 'no_substitute';
  substituteTeacherId: string | null;
  substituteTeacherName: string | null;
}

// ─────────────────────────── журнал ───────────────────────────

export interface JournalColumnDto {
  lessonId: string;
  date: string;
  slotNo: number;
  subjectId: string;
  teacherId: string;
  /** 0 — урок всего класса; N — урок группы N (AR-181: журнал на группу). */
  groupNo: number;
  topic: string | null;
  /** Урок ещё не прошёл — гейт в контракте, UI лишь отражает (AR-74). */
  future: boolean;
  /** Урок вне расписания после регенерации (AR-85). */
  detached: boolean;
  /** Урок отменён без замены (AR-207): отметка отклоняется `LESSON_CANCELLED`. */
  cancelled: boolean;
}

export interface JournalRowDto {
  studentId: string;
  lastName: string;
  firstName: string;
  middleName: string | null;
  sex: Sex | null;
  deactivated: boolean;
  /** Группа ученика по предмету с группами; null — деления нет (AR-181). */
  groupNo: number | null;
  marks: Record<string, MarkValue>; // lessonId → отметка
  /**
   * Средний балл **за четверть**, в которую попадает открытая неделя, — по всем
   * числовым отметкам этой четверти, а не только видимой недели. Учитель
   * смотрит на неделю, но оценивает за период: среднее по одной неделе не
   * значит ничего. `null` — числовых отметок в четверти нет (свойство P7:
   * «—», а не ноль).
   */
  average: number | null;
  /**
   * Четвертная, которая ВЫХОДИТ, — вычисленная из `average` округлением, а не
   * выставленная человеком. Это прогноз, который учитель видит по ходу
   * четверти; выставление итоговой оценки в 1.1.1 не реализовано.
   * `null` там же, где `average`.
   */
  termGrade: 2 | 3 | 4 | 5 | null;
}

/**
 * Четвертная из среднего балла — ОДНО правило на систему (AR-79 задаёт шкалу,
 * это задаёт округление).
 *
 * Округление математическое: `4.5 → 5`, `4.49 → 4`. Правило выбрано явно,
 * потому что оно предсказуемо и объяснимо родителю в одну фразу, а любая
 * «оценка в пользу ученика» на границе требует критерия, которого у системы
 * нет (вес контрольных, динамика) — и превращает число в спор.
 *
 * **[ДЕФОЛТ, ждёт подтверждения владельца.]** Порог 4.5 меняет оценку в
 * аттестате, и если в школе принято иное правило (например, «4.6 и выше»),
 * менять надо здесь — в одном месте, а не в двух реализациях.
 */
export function termGradeOf(average: number | null): 2 | 3 | 4 | 5 | null {
  if (average === null) return null;
  const g = Math.min(5, Math.max(2, Math.round(average)));
  return g as 2 | 3 | 4 | 5;
}

/** Неделя учебного года — единица навигации журнала (строка календаря). */
export interface JournalWeekDto {
  /** ISO-понедельник недели — он же её идентификатор. */
  monday: string;
  /** Воскресенье той же недели: строка календаря подписывается диапазоном. */
  sunday: string;
  /** Четверть, которой принадлежит неделя; `null` — каникулы между четвертями. */
  termNo: 1 | 2 | 3 | 4 | null;
  /** В неделе есть материализованные уроки этого предмета. */
  hasLessons: boolean;
}

export interface JournalDto {
  classId: string;
  subjectId: string;
  /**
   * Колонки ОТКРЫТОЙ НЕДЕЛИ, а не всего года: за год у предмета с двумя часами
   * в неделю накапливается под семьдесят уроков, и таблица во всю их ширину
   * не читается ни на одном экране.
   */
  columns: JournalColumnDto[];
  rows: JournalRowDto[];
  /** Строка календаря: все недели учебного года по данным календаря (AR-68). */
  weeks: JournalWeekDto[];
  /** Какая неделя открыта. По умолчанию — текущая (см. `openWeekReason`). */
  week: string;
  /**
   * Почему открыта именно эта неделя. `current` — сегодня внутри неё;
   * `nearest` — сегодня вне учебного года или на каникулах, открыта ближайшая
   * учебная; `requested` — неделю выбрал человек. Экран говорит об этом
   * словами: молча показать не ту неделю хуже, чем показать не ту и сказать.
   */
  openWeekReason: 'current' | 'nearest' | 'requested';
  /** Четверть открытой недели; `null` — неделя каникулярная. */
  termNo: 1 | 2 | 3 | 4 | null;
  /** Каникулы: ближайший учебный день из календаря (AR-68). */
  nextSchoolDay: string | null;
}

export interface PostMarkDto {
  studentId: string;
  mark: MarkValue;
}

export interface SetTopicDto {
  topic: string;
}

// ─────────────────────────── кабинет модератора ───────────────────────────

/**
 * Строка `S-60.audit`: «дата · действие · объект» (AR-30, AR-116). Подписи
 * готовит сервер — каталог событий живёт на сервере, и вторая его копия на
 * клиенте разошлась бы с первой.
 */
export interface AuditEntryDto {
  id: string;
  at: string;
  /** Тип события — техническое имя, показывается подсказкой, а не строкой. */
  action: string;
  actionLabel: string;
  objectKind: string;
  /** ФИО субъекта, если аудит его держит; иначе `null` — придумывать нечего. */
  objectName: string | null;
}

export interface AdminCabinetDto {
  state: SchoolState;
  audit: AuditEntryDto[];
}

// ─────────────────────────── витрина школ (S-92, AR-163) ───────────────────────────

/** Карточка школы на публичном лендинге — ровно эти четыре поля, ничего сверх. */
export interface SchoolDirectoryEntryDto {
  id: string;
  name: string;
  logoUrl: string | null;
  memberCount: number;
}

// ─────────────────────────── сессии и устройства ───────────────────────────

/**
 * Состояние школы словами — ОДИН словарь на все кабинеты (S-60, S-61, S-62):
 * код FSM человеку не показывается.
 */
export const SCHOOL_STATE_LABELS: Record<SchoolState, string> = {
  empty: 'школа пустая',
  classes_created: 'классы созданы',
  students_filled: 'профили заполнены',
  subjects_created: 'предметы созданы',
  staff_activated: 'персонал активирован',
  teachers_bound: 'педагоги привязаны',
  terms_set: 'четверти заданы',
  load_set: 'нормы заданы',
  priorities_set: 'приоритеты заданы',
  day_params_set: 'параметры дня заданы',
  generated: 'сетка собрана',
  stale: 'сетка устарела',
  ready: 'школа ведёт журнал',
};

/** Канал, которым выдана сессия (AR-187): читается из `AppSession.via`. */
export type SessionVia = 'registration' | 'device_link' | 'login_code' | 'bootstrap_link' | 'login_link' | 'password' | 'unknown';
/** Где живёт сессия: вкладка браузера либо установленное приложение (PWA). */
export type SessionClientKind = 'browser' | 'pwa';

/** Слова для канала входа и вида клиента — одни на S-31, S-62, S-80 (AR-187). */
export const SESSION_VIA_LABELS: Record<SessionVia, string> = {
  registration: 'активация по QR',
  device_link: 'QR с телефона',
  login_code: 'код входа',
  bootstrap_link: 'ссылка платформы',
  login_link: 'ссылка входа',
  password: 'пароль',
  unknown: 'не записан',
};
export const SESSION_CLIENT_LABELS: Record<SessionClientKind, string> = {
  browser: 'в браузере',
  pwa: 'в приложении',
};

export interface SessionDto {
  id: string;
  deviceHint: string;
  lastSeenAt: string;
  createdAt: string;
  current: boolean;
  /** 1.3.0 (AR-187): канал входа и вид клиента — `S-80` называет их словами. */
  via: SessionVia;
  clientKind: SessionClientKind;
  /** Сессия выдана сканом с телефона — идентификатор якорной сессии. */
  parentSessionId: string | null;
  /** «В сети» — активность не старше `ACCESS_PARAMS.sessionOnlineMinutes`. */
  online: boolean;
}

export interface DeviceLinkTokenDto {
  id: string;
  token: string;
  status: TokenStatus;
  expiresAt: string;
}

export interface MeDto {
  userId: string;
  name: string;
  avatarUrl: string | null;
  workspaceId: string;
  schoolName: string;
  roles: SchoolRole[];
  permissions: SchoolPermission[];
  /** Стартовый экран роли: `school.manage` → `journal.mark.post` → `classes.read`. */
  startScreen: string;
  schoolState: SchoolState;
}

/** Стартовый экран роли по первому найденному праву (карта сайта, AR-95). */
export function startScreenFor(permissions: readonly string[]): string {
  if (permissions.includes('school.manage')) return '/classes';
  // завуч (AR-186): единственная роль, чей рабочий день начинается со сводки —
  // кабинет `S-61` и есть его стартовый экран [дефолт]
  if (permissions.includes('school.oversee') && !permissions.includes('school.manage')) return '/deputy';
  if (permissions.includes('journal.mark.post')) return '/journal';
  // ученик и родитель (AR-158): единственная поверхность — дневник
  if (permissions.includes('diary.read') && !permissions.includes('journal.read')) return '/diary';
  return '/classes';
}

/**
 * `next` валидируется как относительный путь своего origin (AR-95): протокол,
 * хост и `//` отклоняются, иначе кнопка «Вход» становится открытым редиректом.
 */
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  if (next.includes('://') || next.includes('\\')) return fallback;
  return next;
}

// ─────────────────────────── кабинет администратора (S-62, AR-186…AR-189) ───────────────────────────

/** Строка аудита всей школы: то же, что `AuditEntryDto`, плюс кто действовал. */
export interface SchoolAuditEntryDto extends AuditEntryDto {
  actorId: string | null;
  actorName: string | null;
}

/** Сессия глазами администратора (AR-187): карта устройств и журнал подключений. */
export interface AdminSessionDto {
  id: string;
  userId: string;
  deviceHint: string;
  via: SessionVia;
  clientKind: SessionClientKind;
  /** Адрес входа как его увидел сервер; `null` — сессия выдана до 1.3.0. */
  ip: string | null;
  /** Первая сессия человека из этой сети (/24): подозрительный вход выделяется. */
  newNetwork: boolean;
  parentSessionId: string | null;
  createdAt: string;
  lastSeenAt: string;
  /** `active` — живая; `ended` — отозвана либо истекла. */
  status: 'active' | 'ended';
  online: boolean;
  /** Сессия того, кто смотрит карту: завершать её здесь нельзя — для этого «Выйти». */
  current: boolean;
  revokedAt: string | null;
  revokedReason: SessionRevokeReason | null;
  expiresAt: string;
}

export type SessionRevokeReason = 'manual' | 'deactivated' | 'deleted' | 'activation_revoked' | 'incident' | 'limit' | 'admin';
export const SESSION_REVOKE_REASON_LABELS: Record<SessionRevokeReason, string> = {
  manual: 'завершена человеком',
  deactivated: 'доступ закрыт',
  deleted: 'учётка удалена',
  activation_revoked: 'активация отозвана',
  incident: 'инцидент-режим',
  limit: 'лимит сессий',
  admin: 'завершена администратором',
};

/** Узел карты устройств: человек и его сессии (живые — всегда, завершённые — по запросу). */
export interface AdminDeviceUserDto {
  userId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  roles: SchoolRole[];
  deactivated: boolean;
  activated: boolean;
  sessions: AdminSessionDto[];
}

export interface AdminDeviceMapDto {
  users: AdminDeviceUserDto[];
  /** Сколько живых сессий во всей школе — сводка над картой. */
  activeSessions: number;
  onlineSessions: number;
  generatedAt: string;
}

/** Лимит одновременных сессий на роль (AR-188): `null` — без лимита. */
export type SessionLimits = Partial<Record<SchoolRole, number | null>>;

export interface AccessPolicyDto {
  sessionLimits: SessionLimits;
  /** AR-205: лимиты носителей ролей; отсутствие ключа — дефолт `DEFAULT_ROLE_LIMITS`. */
  roleLimits: RoleLimits;
  /** AR-205: занято носителей по ролям — живые членства плюс пустые слоты `plannedRoles`. */
  roleHolders: Partial<Record<SchoolRole, number>>;
  /** Последний инцидент-режим: когда и кто закрыл все сессии школы. */
  incidentAt: string | null;
  incidentByName: string | null;
  updatedAt: string | null;
}

export interface SetAccessPolicyDto {
  sessionLimits: SessionLimits;
  /** AR-205: целое 1..`ROLE_LIMIT_MAX` либо `null`; только роли из `STAFF_ROLES`. */
  roleLimits?: RoleLimits;
}

/** Сводка кабинета администратора (`S-62` обзор). */
export interface AdminOverviewDto {
  schoolName: string;
  logoUrl: string | null;
  timezone: string;
  state: SchoolState;
  membersByRole: Partial<Record<SchoolRole, number>>;
  membersTotal: number;
  activatedTotal: number;
  pendingActivations: number;
  activeSessions: number;
  onlineSessions: number;
  pwaSessions: number;
  browserSessions: number;
  networks: number;
  assets: number;
  policy: AccessPolicyDto;
}

/**
 * `POST /staff/:id/login-link` (AR-204): срок и число открытий выбирает
 * выпускающий (`staff.manage`); отсутствуют — дефолты `ACCESS_PARAMS`
 * (48 часов, без лимита).
 */
export interface IssueLoginLinkDto {
  ttlHours?: 24 | 48 | 168;
  maxUses?: number | null;
}

/** Ссылка входа с карточки сотрудника (AR-189, AR-195, AR-204): многоразовая до истечения срока либо лимита открытий. */
export interface LoginLinkDto {
  url: string;
  token: string;
  expiresAt: string;
  /** AR-204: лимит открытий; `null` — без лимита. Исчерпан → `LINK_EXHAUSTED`. */
  maxUses: number | null;
  useCount: number;
}

/** Активность учётки для карточки `M-06` (AR-187). */
export interface StaffActivityDto {
  userId: string;
  activated: boolean;
  activatedAt: string | null;
  lastSeenAt: string | null;
  activeSessions: number;
  totalSessions: number;
  sessions: AdminSessionDto[];
  /** Постоянная ссылка на карточку — переходник на профиль, не путь в кабинет. */
  profileUrl: string;
}

/** Wi-Fi сеть школы (реестр, AR-186). */
export type NetworkAudience = 'staff' | 'students' | 'guests' | 'devices';
export const NETWORK_AUDIENCES: NetworkAudience[] = ['staff', 'students', 'guests', 'devices'];
export const NETWORK_AUDIENCE_LABELS: Record<NetworkAudience, string> = {
  staff: 'персонал',
  students: 'ученики',
  guests: 'гости',
  devices: 'оборудование',
};

export interface SchoolNetworkDto {
  id: string;
  ssid: string;
  audience: NetworkAudience;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertNetworkDto {
  ssid: string;
  audience: NetworkAudience;
  note?: string | null;
}

/** Корпоративное устройство школы: принтер, сканер, компьютер (реестр, AR-186). */
export type AssetKind = 'printer' | 'scanner' | 'computer' | 'projector' | 'router' | 'other';
export const ASSET_KINDS: AssetKind[] = ['printer', 'scanner', 'computer', 'projector', 'router', 'other'];
export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  printer: 'принтер',
  scanner: 'сканер',
  computer: 'компьютер',
  projector: 'проектор',
  router: 'роутер',
  other: 'другое',
};

export interface SchoolAssetDto {
  id: string;
  name: string;
  kind: AssetKind;
  location: string | null;
  networkId: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertAssetDto {
  name: string;
  kind: AssetKind;
  location?: string | null;
  networkId?: string | null;
  note?: string | null;
}

/** Инцидент-режим (AR-188): закрыть все сессии школы, кроме текущей администратора. */
export interface IncidentResultDto {
  ok: boolean;
  revoked: number;
  users: number;
}

// ─────────────────────────── кабинет завуча (S-61, AR-193) ───────────────────────────

/** Пункт чек-листа готовности: факт выведен из данных, не хранится. */
export interface ChecklistItemDto {
  key: string;
  title: string;
  /** Что именно есть или чего не хватает — с цифрами. */
  detail: string;
  done: boolean;
  /** Кто закрывает пункт по матрице ролей (AR-152, AR-174). */
  owner: 'moderator' | 'deputy' | 'admin' | 'teacher';
  /** Куда идти закрывать: маршрут приложения. */
  to: string;
}

export interface DeputyCabinetDto {
  state: SchoolState;
  today: string;
  lessonsToday: number;
  /** УТЦ — учебно-тематический цикл: календарь, нормы, скелет, сетка, журнал. */
  utc: ChecklistItemDto[];
  /** КПЦ — контингентно-персональный центр: классы, ученики, персонал, родители. */
  kpc: ChecklistItemDto[];
  /** Покрытие предметов педагогами: сколько закрыто из скольких. */
  coverage: { covered: number; total: number };
  /** Нормы часов: сколько привязок с годовой нормой из скольких. */
  load: { set: number; total: number };
}

// ─────────────────────────── маршруты API (`70-screens.md` §11) ───────────────────────────

export const SCHOOL_API = {
  // контур доступа
  deviceLinkToken: '/api/v1/auth/device-link/token',
  deviceLinkStatus: (id: string) => `/api/v1/auth/device-link/token/${id}`,
  deviceLinkApprove: '/api/v1/auth/device-link/approve',
  loginCodeVerify: '/api/v1/auth/login-code/verify',
  login: '/api/v1/auth/login',
  logout: '/api/v1/auth/logout',
  sessions: '/api/v1/auth/sessions',
  session: (sid: string) => `/api/v1/auth/sessions/${sid}`,
  me: '/api/v1/me',
  // персонал
  staff: '/api/v1/staff',
  staffCard: (id: string) => `/api/v1/staff/${id}`,
  staffActivationToken: (id: string) => `/api/v1/staff/${id}/activation-token`,
  staffJoin: (token: string) => `/api/v1/staff/join/${token}`,
  staffCards: '/api/v1/staff/cards',
  staffFill: (id: string) => `/api/v1/staff/${id}/fill`,
  staffCredentials: (id: string) => `/api/v1/staff/${id}/credentials`,
  staffRevokeActivation: (id: string) => `/api/v1/staff/${id}/revoke-activation`,
  staffUsernameFree: '/api/v1/staff/username-free',
  staffAvatar: '/api/v1/staff/me/avatar',
  staffRoles: (id: string) => `/api/v1/staff/${id}/roles`,
  staffRole: (id: string, role: string) => `/api/v1/staff/${id}/roles/${role}`,
  staffDeactivate: (id: string) => `/api/v1/staff/${id}/deactivate`,
  staffReactivate: (id: string) => `/api/v1/staff/${id}/reactivate`,
  staffLoginCode: (id: string) => `/api/v1/staff/${id}/login-code`,
  staffRevokeSessions: (id: string) => `/api/v1/staff/${id}/sessions/revoke`,
  // контингент
  classes: '/api/v1/classes',
  classesBulk: '/api/v1/classes/bulk',
  schoolClass: (id: string) => `/api/v1/classes/${id}`,
  classStudents: (id: string) => `/api/v1/classes/${id}/students`,
  // AR-202: число групп класса
  classGroups: (id: string) => `/api/v1/classes/${id}/groups`,
  student: (id: string) => `/api/v1/students/${id}`,
  studentDeactivate: (id: string) => `/api/v1/students/${id}/deactivate`,
  studentReactivate: (id: string) => `/api/v1/students/${id}/reactivate`,
  studentAccess: (id: string) => `/api/v1/students/${id}/access`,
  studentActivationToken: (id: string) => `/api/v1/students/${id}/activation-token`,
  studentRevokeActivation: (id: string) => `/api/v1/students/${id}/revoke-activation`,
  studentCredentials: (id: string) => `/api/v1/students/${id}/credentials`,
  // родители (S-14)
  guardians: '/api/v1/guardians',
  guardian: (id: string) => `/api/v1/guardians/${id}`,
  guardianLinks: (id: string) => `/api/v1/guardians/${id}/links`,
  guardianLink: (id: string, sid: string) => `/api/v1/guardians/${id}/links/${sid}`,
  guardianActivationToken: (id: string) => `/api/v1/guardians/${id}/activation-token`,
  guardianRevokeActivation: (id: string) => `/api/v1/guardians/${id}/revoke-activation`,
  guardianCredentials: (id: string) => `/api/v1/guardians/${id}/credentials`,
  // не авторизованные (S-32) и дневник (S-90, S-91)
  pendingActivations: '/api/v1/access/pending',
  diaryChildren: '/api/v1/diary/children',
  diaryWeek: '/api/v1/diary',
  diaryAverages: '/api/v1/diary/averages',
  subjectsPreset: '/api/v1/subjects/preset',
  // предметы
  subjects: '/api/v1/subjects',
  subject: (id: string) => `/api/v1/subjects/${id}`,
  subjectBindToken: (id: string) => `/api/v1/subjects/${id}/bind-token`,
  subjectTeachers: (id: string) => `/api/v1/subjects/${id}/teachers`,
  subjectTeacher: (id: string, tid: string) => `/api/v1/subjects/${id}/teachers/${tid}`,
  scan: '/api/v1/subjects/scan',
  // календарь и расписание
  terms: '/api/v1/calendar/terms',
  schedule: '/api/v1/schedule',
  scheduleLoad: '/api/v1/schedule/load',
  schedulePriorities: '/api/v1/schedule/priorities',
  scheduleDayParams: '/api/v1/schedule/day-params',
  scheduleSkeleton: '/api/v1/schedule/skeleton',
  scheduleGenerate: '/api/v1/schedule/generate',
  scheduleGenerateCancel: '/api/v1/schedule/generate/cancel',
  scheduleConfirm: '/api/v1/schedule/confirm',
  // AR-200: обед по классам; AR-206: предпочтения педагога; AR-207: датированные уроки
  scheduleLunch: '/api/v1/schedule/lunch',
  schedulePreferencesMe: '/api/v1/schedule/preferences/me',
  schedulePreferences: '/api/v1/schedule/preferences',
  scheduleLessons: '/api/v1/schedule/lessons',
  // AR-207: отмена своего урока (POST) и отзыв отмены (DELETE); ручная замена (schedule.build)
  lessonCancel: (id: string) => `/api/v1/lessons/${id}/cancel`,
  lessonSubstitute: (id: string) => `/api/v1/lessons/${id}/substitute`,
  // журнал
  journal: '/api/v1/journal',
  lessonTopic: (id: string) => `/api/v1/lessons/${id}/topic`,
  lessonMarks: (id: string) => `/api/v1/lessons/${id}/marks`,
  lessonMark: (id: string, studentId: string) => `/api/v1/lessons/${id}/marks/${studentId}`,
  // кабинет модератора (S-60) — прежний `/api/v1/admin` (AR-186)
  moderatorCabinet: '/api/v1/moderator',
  // кабинет администратора (S-62, AR-186…AR-189)
  adminOverview: '/api/v1/admin/overview',
  adminDevices: '/api/v1/admin/devices',
  adminConnections: '/api/v1/admin/connections',
  adminSessionRevoke: (sid: string) => `/api/v1/admin/sessions/${sid}/revoke`,
  adminIncident: '/api/v1/admin/sessions/revoke-all',
  adminPolicy: '/api/v1/admin/policy',
  adminAudit: '/api/v1/admin/audit',
  adminNetworks: '/api/v1/admin/networks',
  adminNetwork: (id: string) => `/api/v1/admin/networks/${id}`,
  adminAssets: '/api/v1/admin/assets',
  adminAsset: (id: string) => `/api/v1/admin/assets/${id}`,
  staffLoginLink: (id: string) => `/api/v1/staff/${id}/login-link`,
  staffActivity: (id: string) => `/api/v1/staff/${id}/activity`,
  // AR-203: учётка и пароль с карточки сотрудника (`staff.manage`)
  staffAccount: (id: string) => `/api/v1/staff/${id}/account`,
  staffPassword: (id: string) => `/api/v1/staff/${id}/password`,
  // кабинет завуча (S-61, AR-193)
  deputyCabinet: '/api/v1/deputy',
} as const;
