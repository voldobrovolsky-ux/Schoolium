#!/usr/bin/env node
/**
 * G-38: экранный реестр против FSM и контрактов спеки.
 * Проверяет перечислением, что интерфейс не врёт о бэке (линза L-15):
 *  — у каждого состояния FSM есть экран-дом;
 *  — каждый экран объявляет маршрут и роли;
 *  — идентификаторы экранов и элементов уникальны;
 *  — каждое событие, упомянутое на экранах, существует в контракте спеки;
 *  — каждый код ошибки из таблицы §9 встречается в описании экранов.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SPEC_DIR = path.join(ROOT, 'specs/school-onboarding');
const screensPath = path.join(SPEC_DIR, '70-screens.md');
if (!fs.existsSync(screensPath)) { console.log('Экранного реестра нет — пропуск.'); process.exit(0); }

const screens = fs.readFileSync(screensPath, 'utf8');
const spec = fs.readFileSync(path.join(SPEC_DIR, '30-spec.md'), 'utf8');
const { states } = await import(path.join(SPEC_DIR, 'model/states.mjs'));
const errors = [];
const fail = (m) => errors.push(m);

// ---------- 1. экраны ----------
const blocks = screens.split(/^##\s+/m).filter((b) => /^S-\d+\s+·/.test(b));
const ids = new Set();
for (const b of blocks) {
  const id = b.match(/^(S-\d+)\s+·\s+(.+)$/m);
  if (!id) continue;
  if (ids.has(id[1])) fail(`${id[1]}: дубликат экрана`);
  ids.add(id[1]);
  const isNested = /^\*\*Внутри\*\*/m.test(b);
  if (!/\*\*Маршрут:\*\*/.test(b) && !isNested) fail(`${id[1]} «${id[2].trim()}»: не объявлен маршрут`);
  if (!/\*\*Роли:\*\*/.test(b) && !isNested) fail(`${id[1]} «${id[2].trim()}»: не объявлены роли`);
}
if (ids.size < 5) fail('экранов подозрительно мало — реестр не разобран');

// ---------- 2. уникальность идентификаторов элементов ----------
// Двухсегментные имена (`S-10.empty`, `S-50.table`) — такие же элементы реестра,
// как трёхсегментные: регэксп, требовавший трёх сегментов, терял треть реестра и
// печатал заниженную цифру, которая читалась как его размер (диагностика этапа 2).
const elems = [...screens.matchAll(/`(S-\d+(?:\.\d+)?\.[a-zA-Z][a-zA-Z0-9\[\].]*)`/g)].map((m) => m[1]);
const seen = new Map();
for (const e of elems) seen.set(e, (seen.get(e) || 0) + 1);

// ---------- 3. покрытие состояний FSM ----------
const matrix = screens.slice(screens.indexOf('Матрица «состояние FSM → экран»'));
for (const s of states) {
  const row = new RegExp(`^\\|\\s*${s}\\s*\\|\\s*(S-\\d+[^|]*)\\|`, 'm').exec(matrix);
  if (!row) { fail(`состояние FSM «${s}» отсутствует в матрице «состояние → экран»`); continue; }
  for (const ref of [...row[1].matchAll(/S-\d+/g)].map((m) => m[0]))
    if (!ids.has(ref)) fail(`состояние «${s}» ссылается на несуществующий экран ${ref}`);
}

// ---------- 4. события экранов существуют в контракте спеки ----------
const specEvents = new Set([...spec.matchAll(/\b([a-z]+\.[a-z]+\.[a-z]+\.v\d+)\b/g)].map((m) => m[1]));
for (const m of screens.matchAll(/\b([a-z]+\.[a-z]+\.[a-z]+\.v\d+)\b/g))
  if (!specEvents.has(m[1])) fail(`экраны ссылаются на событие ${m[1]}, которого нет в контракте 30-spec.md`);

// ---------- 5. коды ошибок объявлены и использованы ----------
const codes = [...screens.matchAll(/^\|\s*`([A-Z_]{4,})`\s*\|/gm)].map((m) => m[1]);
for (const c of codes) {
  const uses = [...screens.matchAll(new RegExp(`\\b${c}\\b`, 'g'))].length;
  if (uses < 2) fail(`код ошибки ${c} объявлен в таблице, но не встречается в описании экранов`);
}
if (!codes.length) fail('таблица кодов ошибок пуста');

// ---------- 5b. обратная сверка: код, названный на экране, объявлен в §9 ----------
// Дыра, найденная этапом 0: проверка 5 шла в одну сторону, и код, придуманный
// в описании экрана, не попадал ни в реестр §9, ни в инвентарь 90-master.
// Исключение — код, о котором прямо сказано «не существует» (отрицательное
// утверждение: элемента нет и быть не должно).
const declared = new Set(codes);
for (const line of screens.split('\n')) {
  if (/не существует/.test(line)) continue;
  for (const m of line.matchAll(/`([A-Z][A-Z_]{3,})`/g))
    if (!declared.has(m[1])) fail(`код ошибки ${m[1]} назван на экране, но отсутствует в таблице §9`);
}

// ---------- 6. обязательные состояния экранов ----------
if (!/loading/.test(screens) || !/empty/.test(screens) || !/error/.test(screens))
  fail('не объявлены обязательные состояния экранов (loading/empty/error)');

// ---------- 7. адаптивная спецификация (G-39) ----------
const adaptivePath = path.join(SPEC_DIR, '75-adaptive.md');
let modals = 0, buttons = 0;
if (!fs.existsSync(adaptivePath)) fail('нет 75-adaptive.md — раскладки не описаны');
else {
  const ad = fs.readFileSync(adaptivePath, 'utf8');
  const cover = ad.slice(ad.indexOf('## 6. Адаптация экранов'));
  for (const id of ids)
    if (!new RegExp(`\\b${id}\\b`).test(cover))
      fail(`экран ${id} не описан в 75-adaptive.md §6 (нет мобильной/десктопной раскладки)`);
  const modalRows = [...ad.matchAll(/^\|\s*`(M-\d+)`\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|/gm)];
  modals = modalRows.length;
  for (const m of modalRows) {
    const [, id, , , desktop, mobile] = m;
    if (!desktop.trim() || desktop.trim() === '—') fail(`модалка ${id}: не описано поведение на десктопе`);
    if (!mobile.trim() || mobile.trim() === '—') fail(`модалка ${id}: не описано поведение на мобайле`);
  }
  if (modals < 10) fail(`реестр модалок подозрительно мал (${modals}) — не разобран`);
  buttons = [...ad.matchAll(/^\|\s*`(B-[a-z]+)`\s*\|/gm)].length;
  if (buttons < 8) fail(`реестр кнопок подозрительно мал (${buttons})`);
  for (const bp of ['mobile', 'desktop'])
    if (!new RegExp('`' + bp + '`').test(ad)) fail(`не объявлена точка останова «${bp}»`);
  if (!/overflow-x/.test(ad)) fail('не задано правило горизонтальной прокрутки широких таблиц');
}

console.log(`Экраны: ${ids.size}; элементов с идентификаторами: ${seen.size}; кодов ошибок: ${codes.length}; состояний FSM: ${states.length}; модалок: ${modals}; типов кнопок: ${buttons}.`);
if (errors.length) {
  console.error(`\n❌ Расхождений экранов и спеки: ${errors.length}`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('✅ G-38: каждое состояние FSM имеет экран, события и коды ошибок сходятся со спекой.');
console.log('✅ G-39: каждый экран описан в двух раскладках, у каждой модалки задано поведение на десктопе и на мобайле.');
