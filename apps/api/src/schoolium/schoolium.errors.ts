import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODES, type ErrorCode } from '@edustore/shared';

/**
 * Коды отказа версии с текстами из `70-screens.md` §9 (29 кодов 1.1.1 + пять
 * кодов контура учётки 1.2.0, specs/school-launch/10-identity.md §9).
 *
 * Правило: текст называет **объект и цифры**, а не «произошла ошибка». Поэтому
 * шаблоны здесь — функции от деталей отказа, а не константные строки: сообщение
 * «5 класс: 34 часа при потолке 29» человек может исполнить, «ошибка валидации» —
 * нет. Каждый ответ несёт `requestId` = correlationId (AR-21, AR-97).
 */
type D = Record<string, unknown>;
const n = (d: D, k: string): string => String(d[k] ?? '—');
/** Номер четверти римским — так его называет реестр экранов (§9, §S-41). */
const ROMAN = ['—', 'I', 'II', 'III', 'IV'];
const roman = (v: unknown): string => ROMAN[Number(v)] ?? String(v ?? '—');

const TEXTS: Record<ErrorCode, (d: D) => string> = {
  // страница входа перевыпускает QR сама — текстом отказ не показывается
  LINK_CODE_EXPIRED: () => 'Код на экране устарел — обновите страницу входа на подключаемом устройстве',
  TOKEN_USED: () => 'Код уже использован, откройте карточку заново',
  TOKEN_EXPIRED: () => 'Код погас, откройте карточку заново',
  PHONE_TAKEN_IN_SCHOOL: () => 'Этот номер уже зарегистрирован в школе',
  // контур учётки 1.2.0 (AR-153…AR-156); первые три видит модератор на формах КПЦ
  USERNAME_TAKEN: (d) => `Юзернейм ${n(d, 'username')} занят — выберите другой`,
  USERNAME_INVALID: (d) =>
    `Юзернейм ${n(d, 'username')} не подходит: строчные латинские буквы, цифры и подчёркивание, от 3 до 30 знаков`,
  PASSWORD_TOO_SHORT: () => 'Пароль короче 8 знаков — удлините или оставьте поле пустым, пароль сгенерируется',
  LOGIN_FAILED: () => 'Войти не удалось: проверьте юзернейм и пароль или попросите модератора показать код входа',
  ACTIVATION_REVOKED: () => 'Активация отозвана модератором. Отсканируйте свой QR заново',
  CLASSES_ALREADY_EXIST: () => 'Классы уже созданы; добавьте класс из списка',
  // §9 и §S-41 требуют римского номера и НАЗЫВАЮТ обе четверти: «II четверть
  // начинается раньше, чем кончается I». Пара номеров и есть объект отказа.
  TERM_OVERLAP: (d) => `${roman(d.termNo)} четверть начинается раньше, чем кончается ${roman(Number(d.termNo) - 1)}`,
  // Объект здесь — сама панель, под которой стоит текст (§S-41): номер четверти
  // приезжает в `details` и ставит ошибку на место, а в тексте его нет.
  TERM_REVERSED: () => 'Дата конца раньше даты начала',
  LOAD_EXCEEDS_SANPIN: (d) => `${n(d, 'classLabel')} класс: ${n(d, 'total')} часа при потолке ${n(d, 'cap')} — СанПиН 1.2.3685-21`,
  LOAD_EXCEEDS_GRID: (d) =>
    `${n(d, 'classLabel')} класс: ${n(d, 'total')} часов при ${n(d, 'grid')} слотах недели (${n(d, 'perDay')} уроков в день × ${n(d, 'days')} дней — потолок параллели)`,
  GROUP_HOURS_UNEQUAL: (d) => `${n(d, 'subject')}, ${n(d, 'classLabel')} класс: ${n(d, 'hours')}`,
  TEACHER_OVERBOOKED: (d) => `${n(d, 'teacher')}: ${n(d, 'hours')} часов при ${n(d, 'grid')} слотах недели`,
  SUBJECT_UNCOVERED: (d) => `${n(d, 'subject')}, ${n(d, 'classLabel')} класс: ${n(d, 'groups')} без педагога`,
  GROUPS_UNASSIGNED: (d) => `${n(d, 'classLabel')} класс: группы объявлены, состав не назначен`,
  DAY_EXCEEDS_SANPIN: (d) =>
    `${n(d, 'slotsPerDay')} уроков в день при потолке ${n(d, 'cap')} (старшая параллель школы — ${n(d, 'senior')} класс) — СанПиН 1.2.3685-21`,
  // текст НЕ ссылается на СанПиН: потолок 420 минут — продуктовый дефолт (AR-103)
  DAY_TOO_LONG: (d) => `Учебный день ${n(d, 'minutes')} минут при потолке ${n(d, 'cap')}: ${n(d, 'breakdown')}`,
  CONCURRENT_EDIT: (d) => `Пока вы заполняли, ${n(d, 'editor')} изменила эти данные. Обновите экран`,
  NO_SOLUTION: () => 'Не удалось собрать сетку. Ослабьте приоритеты или добавьте учебный день',
  LESSON_NOT_HELD: () => 'Урок ещё не прошёл',
  LESSON_DETACHED: () => 'Урок вне расписания: отметки сохранены, изменить их нельзя',
  CLASS_HAS_MARKS: () => 'В классе есть выставленные отметки — класс не удаляется',
  LAST_MODERATOR: () => 'Это единственный модератор школы — удалить или деактивировать его нельзя',
  LAST_ROLE: () => 'Это единственная роль сотрудника — снять её нельзя; чтобы закрыть доступ, деактивируйте карточку',
  CALENDAR_YEAR_MISSING: (d) => `Нет производственного календаря на ${n(d, 'year')} год — обратитесь к администратору платформы`,
  LOGIN_CODE_INVALID: () => 'Неверный код',
  LOGIN_CODE_EXPIRED: () => 'Код истёк, попросите модератора открыть карточку заново',
  ACCESS_REVOKED: () => 'Доступ закрыт. Обратитесь к модератору школы',
  STUDENT_INACTIVE: () => 'Ученик деактивирован',
  STUDENT_HAS_MARKS: () => 'У ученика есть выставленные отметки — запись деактивируется, а не удаляется',
  STAFF_HAS_HISTORY: () => 'У сотрудника есть привязки к предметам или выставленные отметки — карточка деактивируется, а не удаляется',
};

/** HTTP-статус отказа: 409 у конфликтов состояния, 403 у отзыва доступа, иначе 400. */
const STATUS: Partial<Record<ErrorCode, HttpStatus>> = {
  CONCURRENT_EDIT: HttpStatus.CONFLICT,
  CLASSES_ALREADY_EXIST: HttpStatus.CONFLICT,
  PHONE_TAKEN_IN_SCHOOL: HttpStatus.CONFLICT,
  CLASS_HAS_MARKS: HttpStatus.CONFLICT,
  STUDENT_HAS_MARKS: HttpStatus.CONFLICT,
  STAFF_HAS_HISTORY: HttpStatus.CONFLICT,
  LAST_MODERATOR: HttpStatus.CONFLICT,
  LAST_ROLE: HttpStatus.CONFLICT,
  TOKEN_USED: HttpStatus.GONE,
  TOKEN_EXPIRED: HttpStatus.GONE,
  LINK_CODE_EXPIRED: HttpStatus.GONE,
  LOGIN_CODE_EXPIRED: HttpStatus.GONE,
  ACCESS_REVOKED: HttpStatus.FORBIDDEN,
  LOGIN_CODE_INVALID: HttpStatus.UNAUTHORIZED,
  USERNAME_TAKEN: HttpStatus.CONFLICT,
  LOGIN_FAILED: HttpStatus.UNAUTHORIZED,
  ACTIVATION_REVOKED: HttpStatus.FORBIDDEN,
};

/** Отказ версии: код + человекочитаемая причина с объектом и цифрами + requestId. */
export class SchoolError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    readonly details: D = {},
    requestId = 'n/a',
  ) {
    super(
      { code, message: TEXTS[code](details), requestId, details },
      STATUS[code] ?? HttpStatus.BAD_REQUEST,
    );
  }
}

export const errorText = (code: ErrorCode, details: D = {}): string => TEXTS[code](details);

/** Перечисление для ворот: у каждого из 29 кодов есть непустой текст. */
export const ALL_ERROR_CODES = ERROR_CODES;
