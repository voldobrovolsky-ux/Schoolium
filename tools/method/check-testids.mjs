#!/usr/bin/env node
/**
 * G-52 (AR-115, AR-81, AR-82): **реестр элементов реализован поимённо.**
 *
 * `70-screens.md` объявлен единственным источником для генерации UI, а элементы
 * ОБОЛОЧКИ живут в `75-adaptive.md` §2 — она не экран и своей секции в реестре
 * экранов не имеет. Проверяемых утверждений три, и все три перечислением:
 *
 *   1. каждый идентификатор элемента из реестра экранов присутствует в модуле
 *      СВОЕГО экрана — «экран без элемента» не принимается;
 *   2. модуль не несёт идентификаторов чужого экрана — элемент, уехавший не
 *      туда, ломает и реестр, и смок;
 *   3. каждый элемент оболочки (`L.*`) стоит в `shell.tsx` — и десктопный, и
 *      мобильный. До этапа 3 мобильные (`L.header.*`, `L.tabbar*`) были
 *      объявлены вне объёма вслух; теперь обе раскладки живут в одном модуле,
 *      и делить реестр оболочки надвое больше не на чем.
 *
 * Шаблонные идентификаторы (`S-52.chip.${markKey(m)}`) разворачиваются в
 * префиксное правило: такой идентификатор закрывает семейство, и КАЖДЫЙ
 * случай такого закрытия печатается — молчаливое послабление читалось бы как
 * «всё нашлось буквально». Буквальное присутствие шести чипов в DOM
 * доказывает смок G-53.
 *
 * Запуск: node tools/method/check-testids.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SPEC = path.join(ROOT, 'specs/school-onboarding/70-screens.md');
const WEB = path.join(ROOT, 'apps/web/src/schoolium');

if (!fs.existsSync(SPEC)) { console.log('Экранного реестра нет — пропуск.'); process.exit(0); }
if (!fs.existsSync(WEB)) { console.log('Контура Schoolium на фронте нет — пропуск.'); process.exit(0); }

// ---------- карта «экран → модуль» ----------
// Ведётся руками намеренно: она и есть утверждение о том, где живёт экран.
const HOME = {
  'S-00': ['screens/auth.tsx'], 'S-01': ['screens/auth.tsx'], 'S-03': ['screens/auth.tsx'],
  'S-04': ['screens/auth.tsx'], 'S-05': ['screens/auth.tsx'],
  'S-10': ['screens/classes.tsx'], 'S-11': ['screens/classes.tsx'],
  'S-12': ['screens/classes.tsx'], 'S-13': ['screens/classes.tsx'],
  'S-20': ['screens/subjects.tsx'], 'S-21': ['screens/subjects.tsx'], 'S-22': ['screens/subjects.tsx'],
  'S-30': ['screens/staff.tsx'], 'S-31': ['screens/staff.tsx'],
  'S-40': ['screens/schedule.tsx'], 'S-41': ['screens/schedule.tsx'], 'S-42': ['screens/schedule.tsx'],
  'S-50': ['screens/journal.tsx'], 'S-51': ['screens/journal.tsx'], 'S-52': ['screens/journal.tsx'],
  'S-60': ['screens/misc.tsx'], 'S-70': ['screens/misc.tsx'], 'S-80': ['screens/misc.tsx'],
  // 1.2.0 (specs/school-launch/20-cabinets.md §7)
  'S-14': ['screens/family.tsx'],
  'S-23': ['screens/subjects.tsx'],
  'S-32': ['screens/misc.tsx'],
  'S-90': ['screens/diary.tsx'], 'S-91': ['screens/diary.tsx'],
};

const spec = fs.readFileSync(SPEC, 'utf8');
const errors = [];
const notes = [];
const fail = (m) => errors.push(m);

// ---------- 1. ожидаемые идентификаторы из реестра ----------
const raw = [...spec.matchAll(/`(S-\d+\.[a-zA-Z][a-zA-Z0-9[\].]*)`/g)].map((m) => m[1]);
/** `S-41.panel.term[1..4]` — четыре панели, а не элемент с квадратными скобками в имени. */
const expand = (id) => {
  const r = id.match(/^(.*)\[(\d+)\.\.(\d+)\]$/);
  if (!r) return [id];
  const out = [];
  for (let i = Number(r[2]); i <= Number(r[3]); i++) out.push(`${r[1]}${i}`);
  return out;
};
const expected = [...new Set(raw.flatMap(expand))].sort();

// ---------- 2. что реально стоит в модулях ----------
const read = (rel) => {
  const p = path.join(WEB, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};
const files = new Map();
for (const rels of Object.values(HOME)) for (const rel of rels) if (!files.has(rel)) files.set(rel, read(rel));
// Оболочка тоже носит элементы экранов (шапка, меню пользователя).
files.set('shell.tsx', read('shell.tsx'));

/**
 * Что именно стоит в атрибуте. Значение бывает трёх видов, и все три
 * настоящие: строка, шаблон и ВЫРАЖЕНИЕ — тернарник вида
 * `data-testid={c.future ? "S-50.col.future" : "S-50.colhead.date"}` объявляет
 * два элемента сразу, и не увидеть их значило бы объявить реализованное
 * отсутствующим.
 */
function idsOf(src) {
  const literal = new Set();
  const templates = [];
  const addTemplate = (t) => {
    if (t.includes('${'))
      templates.push(new RegExp('^' + t.replace(/[.]/g, '\\.').replace(/\$\\?\{[^}]*\}/g, '[A-Za-z0-9._-]+') + '$'));
    else literal.add(t);
  };
  for (const m of src.matchAll(/(?:data-)?testId?="([^"]+)"/gi)) literal.add(m[1]);
  // Выражение в фигурных скобках: читаем до парной скобки и вынимаем из него
  // все строковые и шаблонные литералы.
  for (const m of src.matchAll(/(?:data-)?testId?=\{/gi)) {
    let i = m.index + m[0].length;
    let depth = 1;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
    }
    const expr = src.slice(m.index + m[0].length, i - 1);
    for (const q of expr.matchAll(/"([^"]+)"/g)) literal.add(q[1]);
    for (const q of expr.matchAll(/`([^`]+)`/g)) addTemplate(q[1]);
  }
  return { literal, templates };
}

const parsed = new Map([...files].map(([rel, src]) => [rel, idsOf(src)]));

// ---------- 3. каждый элемент — в модуле своего экрана ----------
let byTemplate = 0;
for (const id of expected) {
  const screen = id.slice(0, id.indexOf('.'));
  const homes = HOME[screen];
  if (!homes) { fail(`${id}: экран ${screen} не отнесён ни к одному модулю — карта «экран → модуль» неполна`); continue; }
  const scope = [...homes, 'shell.tsx'];
  let found = false;
  let viaTemplate = false;
  for (const rel of scope) {
    const p = parsed.get(rel);
    if (!p) continue;
    if (p.literal.has(id)) { found = true; break; }
    if (p.templates.some((re) => re.test(id))) { found = true; viaTemplate = true; }
  }
  if (!found) fail(`${id}: элемент реестра отсутствует в ${homes.join(', ')}`);
  else if (viaTemplate) { byTemplate++; notes.push(id); }
}

// ---------- 4. модуль не носит элементов чужого экрана ----------
for (const [rel, p] of parsed) {
  if (rel === 'shell.tsx') continue;
  const own = Object.entries(HOME).filter(([, rels]) => rels.includes(rel)).map(([s]) => s);
  for (const id of p.literal) {
    const m = id.match(/^(S-\d+)\./);
    if (m && !own.includes(m[1])) fail(`${rel}: несёт элемент чужого экрана ${id} (модуль отвечает за ${own.join(', ')})`);
  }
}

// ---------- 5. оболочка: элементы `L.*` из 75-adaptive.md §2 ----------
// Реестр оболочки ведёт адаптивная спека: кнопка шапки принадлежит ей, а не
// экрану (уточнение этапа 2 про `S-70.btn.scanner`/`L.topbar.scan`). Без этой
// половины G-52 оболочку не держит ничто, кроме дисциплины.
const ADAPTIVE = path.join(ROOT, 'specs/school-onboarding/75-adaptive.md');
let shellDesktop = [];
let shellMobile = [];
if (fs.existsSync(ADAPTIVE)) {
  const ad = fs.readFileSync(ADAPTIVE, 'utf8');
  const all = [...new Set([...ad.matchAll(/`(L\.[a-zA-Z][a-zA-Z0-9.<>]*)`/g)].map((m) => m[1]))]
    // `L.sidebar.item.<screen>` и `L.tabbar.item.<screen>` — семейства, а не элементы.
    .filter((id) => !id.includes('<'));
  const isMobile = (id) => id.startsWith('L.header.') || id.startsWith('L.tabbar');
  shellDesktop = all.filter((id) => !isMobile(id)).sort();
  shellMobile = all.filter(isMobile).sort();
  const shell = parsed.get('shell.tsx');
  for (const id of [...shellDesktop, ...shellMobile]) {
    if (!shell || !shell.literal.has(id)) fail(`${id}: элемент оболочки отсутствует в shell.tsx`);
  }
}

// ---------- отчёт ----------
console.log(
  `Элементов в реестре: ${expected.length} экранных + ${shellDesktop.length + shellMobile.length} оболочки ` +
    `(${shellDesktop.length} десктопных, ${shellMobile.length} мобильных); модулей: ${files.size}.`,
);
if (byTemplate > 0) {
  console.log(`Через шаблонный идентификатор закрыто ${byTemplate}: ${notes.join(', ')}`);
  console.log('  (буквальное присутствие этих узлов в DOM доказывает смок G-53)');
}
if (errors.length) {
  console.error(`\n❌ G-52: нарушений ${errors.length}`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('✅ G-52: каждый элемент реестра стоит на своём месте — экраны и оболочка в ОБЕИХ раскладках; чужих элементов ни один модуль не носит.');
