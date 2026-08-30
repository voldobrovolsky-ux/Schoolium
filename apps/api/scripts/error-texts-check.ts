/**
 * G-54 — **тексты отказов дословны реестру `70-screens.md` §9.**
 *
 * Правило этапа 2 звучит коротко: «Тексты ошибок — из §9, дословно. „Произошла
 * ошибка“ — дефект». Дисциплиной оно не держится: §9 — таблица из двадцати
 * девяти строк, а реализация — двадцать девять шаблонов от деталей отказа, и
 * разъезжаются они молча. Диагностика этапа 2 нашла два расхождения, и одно из
 * них называло не тот объект: `DAY_EXCEEDS_SANPIN` печатал класс там, где отказ
 * про старшую параллель школы (AR-114).
 *
 * Что проверяется перечислением, а не на глаз:
 *   1. коды §9 и `ERROR_CODES` — одно и то же множество в обе стороны;
 *   2. шаблон каждого кода, подставленный ЦИФРАМИ ИЗ ПРИМЕРА §9, даёт ровно тот
 *      текст, который в §9 написан;
 *   3. ни один текст не содержит слов-заглушек («произошла ошибка», «не
 *      получилось», «попробуйте ещё раз») и ни в одном не осталось «—» на месте
 *      подставляемой детали.
 *
 * Пример §9 — это и есть фикстура: другой источник значений позволил бы
 * подогнать проверку под реализацию.
 *
 * Запуск: npm --workspace apps/api run texts:check
 */
import fs from 'node:fs';
import path from 'node:path';
import { ERROR_CODES, type ErrorCode } from '@edustore/shared';
import { errorText } from '../src/schoolium/schoolium.errors';

const SPEC = path.resolve(__dirname, '../../../specs/school-onboarding/70-screens.md');

let pass = 0;
let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) { pass += 1; console.log(`✓  ${msg}`); }
  else { fail += 1; console.error(`✗  ${msg}`); }
};

/**
 * Детали отказа для подстановки — ровно те значения, что стоят в примере §9.
 * Код, у которого текст без подстановок, объявляется пустым объектом: молчаливый
 * пропуск читался бы как «проверено».
 */
const SAMPLE: Record<ErrorCode, Record<string, unknown>> = {
  LINK_CODE_EXPIRED: {},
  TOKEN_USED: {},
  TOKEN_EXPIRED: {},
  PHONE_TAKEN_IN_SCHOOL: {},
  CLASSES_ALREADY_EXIST: {},
  TERM_OVERLAP: { termNo: 2 },
  // Текст без подстановок намеренно: объект — панель, под которой он стоит
  // (§S-41); `termNo` едет в `details` и ставит ошибку на место, но в текст
  // не попадает.
  TERM_REVERSED: {},
  LOAD_EXCEEDS_SANPIN: { classLabel: 5, total: 34, cap: 29 },
  LOAD_EXCEEDS_GRID: { classLabel: 5, total: 40, grid: 30, perDay: 6, days: 5 },
  GROUP_HOURS_UNEQUAL: { subject: 'Английский', classLabel: 7, hours: 'группа 1 — 3 ч, группа 2 — 1 ч' },
  TEACHER_OVERBOOKED: { teacher: 'Иванова М. И.', hours: 48, grid: 35 },
  SUBJECT_UNCOVERED: { subject: 'Английский', classLabel: 7, groups: 'группа 2' },
  GROUPS_UNASSIGNED: { classLabel: 7 },
  DAY_EXCEEDS_SANPIN: { slotsPerDay: 9, cap: 7, senior: 8 },
  DAY_TOO_LONG: { minutes: 795, cap: 420, breakdown: '7 уроков × 45 + перемены 5 × 90 + большая 30' },
  CONCURRENT_EDIT: { editor: 'Петрова А. В.' },
  NO_SOLUTION: {},
  LESSON_NOT_HELD: {},
  LESSON_DETACHED: {},
  CLASS_HAS_MARKS: {},
  STUDENT_HAS_MARKS: {},
  STAFF_HAS_HISTORY: {},
  LAST_MODERATOR: {},
  LAST_ROLE: {},
  CALENDAR_YEAR_MISSING: { year: 2027 },
  LOGIN_CODE_INVALID: {},
  LOGIN_CODE_EXPIRED: {},
  ACCESS_REVOKED: {},
  STUDENT_INACTIVE: {},
  // контур учётки 1.2.0 (specs/school-launch/10-identity.md §9)
  USERNAME_TAKEN: { username: 'm_ivanova' },
  USERNAME_INVALID: { username: 'Мария!' },
  PASSWORD_TOO_SHORT: {},
  LOGIN_FAILED: {},
  ACTIVATION_REVOKED: {},
};

/** Строки §9, чей текст объявлен НЕ показываемым пользователю. */
const NOT_SHOWN = new Set<ErrorCode>(['LINK_CODE_EXPIRED']);

const BANNED = ['произошла ошибка', 'не получилось', 'попробуйте ещё раз', 'что-то пошло не так'];

function specTexts(): Map<string, string> {
  const md = fs.readFileSync(SPEC, 'utf8');
  const section = md.slice(md.indexOf('## 9. Коды ошибок и тексты'));
  const body = section.slice(0, section.indexOf('\n## ', 3));
  const out = new Map<string, string>();
  for (const m of body.matchAll(/^\|\s*`([A-Z_]+)`\s*\|[^|]*\|\s*([^|]+?)\s*\|\s*$/gm)) out.set(m[1], m[2]);
  return out;
}

console.log('\nG-54 · тексты отказов дословны §9 `70-screens.md`\n');

const spec = specTexts();

// ---------- 1. множества кодов сходятся в обе стороны ----------
ok(spec.size === ERROR_CODES.length, `кодов в §9 ${spec.size}, в контракте ${ERROR_CODES.length} — поровну`);
for (const c of ERROR_CODES) ok(spec.has(c), `${c}: код контракта объявлен в §9`);
for (const c of spec.keys()) ok((ERROR_CODES as readonly string[]).includes(c), `${c}: код §9 существует в контракте`);

// ---------- 2. шаблон на цифрах примера даёт текст §9 ----------
for (const code of ERROR_CODES) {
  const want = spec.get(code);
  if (want === undefined) continue;
  if (NOT_SHOWN.has(code)) {
    ok(/не показывается/.test(want), `${code}: §9 объявляет текст непоказываемым — сверка не нужна`);
    continue;
  }
  const got = errorText(code, SAMPLE[code]);
  ok(got === want, `${code}: «${got}»${got === want ? '' : `\n     §9 ждёт: «${want}»`}`);
}

// ---------- 3. заглушек нет, а детали действительно подставляются ----------
for (const code of ERROR_CODES) {
  const got = errorText(code, SAMPLE[code]);
  ok(!BANNED.some((b) => got.toLowerCase().includes(b)), `${code}: текст называет причину, а не «произошла ошибка»`);
  // Шаблон, который игнорирует свои детали, выглядит рабочим и лжёт цифрами:
  // текст на примере обязан отличаться от текста без деталей.
  const keys = Object.keys(SAMPLE[code]);
  if (keys.length > 0) ok(got !== errorText(code, {}), `${code}: детали (${keys.join(', ')}) действительно попадают в текст`);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} G-54 · ТЕКСТЫ ОТКАЗОВ ${fail === 0 ? 'ДОСЛОВНЫ' : 'РАЗОШЛИСЬ С §9'} — pass=${pass} fail=${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
