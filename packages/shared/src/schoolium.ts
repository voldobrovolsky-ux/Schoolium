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
 * Секции экрана «Персонал» (`S-30`). Кнопка «Добавить» стоит только у
 * множественных ролей — учредители и преподаватели (AR-60): директор и оба зама
 * существуют в одном экземпляре, и «для симметрии» кнопка не добавляется.
 */
export const STAFF_SECTIONS = [
  { level: 1, title: 'Учредители и директор', roles: ['founder', 'director'] as SchoolRole[], addable: 'founder' as SchoolRole | null },
  { level: 2, title: 'Заместители', roles: ['deputy_academic', 'deputy_upbringing'] as SchoolRole[], addable: null },
  { level: 3, title: 'Преподаватели', roles: ['teacher'] as SchoolRole[], addable: 'teacher' as SchoolRole | null },
] as const;

/** Роли, существующие в школе в единственном экземпляре (карточка одна). */
export const SINGLETON_ROLES: SchoolRole[] = ['director', 'deputy_academic', 'deputy_upbringing'];

// ─────────────────────────── права (13 кодов, AR-69, AR-88) ───────────────────────────

/** Восемь мутационных прав версии. */
export const MUTATION_PERMISSIONS = [
  'school.manage',
  'contingent.write',
  'subject.write',
  'staff.manage',
  'schedule.build',
  'journal.mark.post',
  'journal.topic.set',
  'staff.self.write',
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

export const SCHOOL_PERMISSIONS = [...MUTATION_PERMISSIONS, ...READ_PERMISSIONS, ...PROJECTION_PERMISSIONS] as const;
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
  admin: [...MUTATION_PERMISSIONS, ...READ_PERMISSIONS],
  moderator: [...READ_PERMISSIONS, 'school.manage', 'contingent.write', 'staff.manage', 'staff.self.write'],
  deputy_academic: [...READ_PERMISSIONS, 'schedule.build', 'subject.write', 'staff.self.write'],
  teacher: [...READ_PERMISSIONS, 'journal.mark.post', 'journal.topic.set', 'staff.self.write'],
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

// ─────────────────────────── коды ошибок (29, `70-screens.md` §9) ───────────────────────────

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
  'LOAD_EXCEEDS_SANPIN',
  'LOAD_EXCEEDS_GRID',
  'GROUP_HOURS_UNEQUAL',
  'TEACHER_OVERBOOKED',
  'SUBJECT_UNCOVERED',
  'GROUPS_UNASSIGNED',
  'DAY_EXCEEDS_SANPIN',
  'DAY_TOO_LONG',
  'CONCURRENT_EDIT',
  'NO_SOLUTION',
  'LESSON_NOT_HELD',
  'LESSON_DETACHED',
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
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Девять кодов отказа генератора. Восемь считаются **арифметикой до перебора**
 * (AR-103, AR-107); `NO_SOLUTION` — единственный отказ самого перебора, он же
 * отвечает на исчерпание бюджета.
 */
export const ARITHMETIC_REFUSALS = [
  'LOAD_EXCEEDS_SANPIN',
  'LOAD_EXCEEDS_GRID',
  'TEACHER_OVERBOOKED',
  'SUBJECT_UNCOVERED',
  'GROUPS_UNASSIGNED',
  'GROUP_HOURS_UNEQUAL',
  'DAY_EXCEEDS_SANPIN',
  'DAY_TOO_LONG',
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
  bootstrapLinkTtlHours: 24,
  pollIntervalMs: 2000,
} as const;

/** Бюджет перебора генератора (AR-107): что раньше — секунды или попытки. */
export const GENERATOR_BUDGET = { seconds: 20, attempts: 200_000 } as const;

/** Потолок длины учебного дня — продуктовый дефолт владельца, не норма (AR-103). */
export const DAY_MINUTES_CAP = 420;

/** Дневной потолок уроков по параллелям — СанПиН 1.2.3685-21 табл. 6.6 (базис #11). */
export const DAY_SLOTS_CAP: Record<number, number> = {
  1: 4, 2: 5, 3: 5, 4: 5, 5: 6, 6: 6, 7: 7, 8: 7, 9: 7, 10: 7, 11: 7,
};

/**
 * AR-114: «уроков в день» — ВЕРХНЯЯ ГРАНИЦА школьного дня, одна на школу, а
 * потолок СанПиН нормирует параллель. День класса — `min(число, потолок его
 * параллели)`; отказ `DAY_EXCEEDS_SANPIN` — только когда число выше потолка
 * самой старшей параллели школы. Иначе школа с первым и восьмым классом обязана
 * поставить 4 урока в день всем и не собирается вовсе.
 */
export const classDayCap = (parallel: number, slotsPerDay: number): number =>
  Math.min(slotsPerDay, DAY_SLOTS_CAP[parallel] ?? 0);

export const schoolDayCap = (parallels: number[]): number =>
  Math.max(0, ...parallels.map((p) => DAY_SLOTS_CAP[p] ?? 0));

/** Недельный потолок часов по параллелям — СанПиН, 5-дневка (базис #3). */
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
}

export interface BindingDto {
  id: string;
  teacherId: string;
  teacherName: string;
  avatarUrl: string | null;
  scope: BindingScope;
  groupNos: number[];
  hoursPerWeek: number;
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

export interface LoadEntryDto {
  bindingId: string;
  hoursPerWeek: number;
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

// ─────────────────────────── журнал ───────────────────────────

export interface JournalColumnDto {
  lessonId: string;
  date: string;
  slotNo: number;
  subjectId: string;
  teacherId: string;
  topic: string | null;
  /** Урок ещё не прошёл — гейт в контракте, UI лишь отражает (AR-74). */
  future: boolean;
  /** Урок вне расписания после регенерации (AR-85). */
  detached: boolean;
}

export interface JournalRowDto {
  studentId: string;
  lastName: string;
  firstName: string;
  middleName: string | null;
  sex: Sex | null;
  deactivated: boolean;
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

// ─────────────────────────── сессии и устройства ───────────────────────────

export interface SessionDto {
  id: string;
  deviceHint: string;
  lastSeenAt: string;
  createdAt: string;
  current: boolean;
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
  scheduleGenerate: '/api/v1/schedule/generate',
  scheduleGenerateCancel: '/api/v1/schedule/generate/cancel',
  scheduleConfirm: '/api/v1/schedule/confirm',
  // журнал
  journal: '/api/v1/journal',
  lessonTopic: (id: string) => `/api/v1/lessons/${id}/topic`,
  lessonMarks: (id: string) => `/api/v1/lessons/${id}/marks`,
  lessonMark: (id: string, studentId: string) => `/api/v1/lessons/${id}/marks/${studentId}`,
} as const;
