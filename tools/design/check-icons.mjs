#!/usr/bin/env node
/**
 * G-83 (AR-190): **иконка — это `<Icon name=… />`, а не юникод-глиф.**
 *
 * До 1.3.0 навигация и кнопки носили символы (▣ ◈ ☰ ⚙ ⛶ ✕ ‹ ›): их рисует
 * системный шрифт — на каждой платформе своей толщиной и своим размером, и
 * интерфейс выглядел собранным из подручного. Правило держится
 * перечислением по исходникам контура: в `apps/web/src/schoolium/**\/*.tsx`
 * вне комментариев нет ни одного символа-иконки и ни одного эмодзи.
 *
 * Два класса символов:
 *   · ЖЁСТКИЕ — всегда иконка, где бы ни стояли: геометрические фигуры,
 *     дингбаты, технические знаки, эмодзи, ✕ ✓ ⚙ ☰ ⌀ …;
 *   · МЯГКИЕ — в прозе это пунктуация, иконка — только когда стоят ОДНИ:
 *     « » ‹ › (кавычки «слово», но стрелка «‹ Назад»), × − + (текст
 *     «предмет × класс», но кнопка «−»), → ← ↑ ↓ (проза «A → B», но подпись
 *     «→ Далее» или голая стрелка в кнопке).
 *
 * Исключения — только по списку `ALLOW` с причиной: копия владельца, где
 * знак — часть смысла, а не иконка («⌀ Без литер» — явный отказ, AR-77).
 * Строка исключения вырезается из проверяемого текста целиком, поэтому
 * исключение не прячет соседний глиф на той же строке.
 *
 * Запуск: node tools/design/check-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
/* Первый аргумент — другая папка: самопроверка ворот на фикстуре, не на контуре. */
const SCH = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'apps/web/src/schoolium');

/** Строки, которые НЕ являются иконкой, хотя несут глиф. Точное совпадение подстроки. */
const ALLOW = [
  { text: '⌀ Без литер', reason: 'явный отказ B-off (AR-77): «⌀» — часть копии владельца, а не иконка' },
  { text: '⌀ Без групп', reason: 'явный отказ B-off (AR-77): «⌀» — часть копии владельца, а не иконка' },
  { text: '⌀ Без приоритетов', reason: 'явный отказ B-off (AR-77): та же кнопка отказа в настройке расписания' },
];

/** Жёсткие: любой символ из этих диапазонов — иконка, где бы ни стоял. */
const HARD_RANGES = [
  [0x2190, 0x21ff, 'стрелки'], // → ← ↑ ↓ — см. SOFT ниже: из диапазона исключены четыре базовые
  [0x2300, 0x23ff, 'технические знаки (⌀ ⛶ ⏻)'],
  [0x25a0, 0x25ff, 'геометрические фигуры (▣ ▸ ▾ ◇ ◈ ●)'],
  [0x2600, 0x26ff, 'разные символы (☰ ⚙ ☐ ⛶)'],
  [0x2700, 0x27bf, 'дингбаты (✕ ✓ ✔ ✖ ✎)'],
  [0x2b00, 0x2bff, 'стрелки и фигуры (⬆ ⭐)'],
  [0x1f000, 0x1faff, 'эмодзи'],
  [0xfe0f, 0xfe0f, 'селектор эмодзи'],
];
/** Мягкие: пунктуация в прозе, иконка — только когда стоят одни (см. `softHit`). */
const SOFT = new Set(['«', '»', '‹', '›', '×', '−', '+', '→', '←', '↑', '↓']);

const isHard = (cp) => {
  if (SOFT.has(String.fromCodePoint(cp))) return false;
  return HARD_RANGES.some(([a, b]) => cp >= a && cp <= b);
};

/**
 * Мягкий глиф — иконка, если стоит один в JSX-тексте (`>−<`, строка из одного
 * символа) либо отделён пробелом от текста с «внутренней» стороны:
 * `‹ Назад`, `Далее ›`, `« Классы`. В кавычках «слово» пробела внутри нет.
 */
function softHit(line, idx) {
  const ch = line[idx];
  const trimmed = line.trim();
  if (trimmed === ch) return true;
  if (new RegExp(`>\\s*${escapeRe(ch)}\\s*<`).test(line)) return true;
  const prev = line[idx - 1] ?? '';
  const next = line[idx + 1] ?? '';
  const opening = ch === '«' || ch === '‹';
  const closing = ch === '»' || ch === '›';
  // Перенос строки внутри длинной цитаты кавычкой-иконкой не считается:
  // граница строки — не пробел.
  if (opening) return /\s/.test(next) || next === '<';
  if (closing) return /\s/.test(prev) || prev === '>';
  // × − + → ← ↑ ↓: иконка — это JSX-текст «глиф + подпись» (`+ Урок`,
  // `→ Далее`) на строке без кода. Конкатенация `"a" +` и `a + b` — код:
  // на строке есть кавычки, скобки или знак равенства.
  const esc = escapeRe(ch);
  // Сразу после открывающего тега или прямо перед закрывающим: `<b>+ Урок</b>`.
  if (new RegExp(`>\\s*${esc}\\s`).test(line) || new RegExp(`\\s${esc}\\s*<`).test(line)) return true;
  if (/[=(){};"'`]/.test(line)) return false;
  return trimmed.startsWith(ch + ' ') || trimmed.endsWith(' ' + ch);
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const scan = (dir) => {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...scan(p));
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
};

/**
 * Комментарий кодом не является: `//` и `*` в начале строки, `/* … *\/` на
 * строке, а также хвост незакрытого `/*` — блок тянется до `*\/` на одной из
 * следующих строк (`{/* … многострочный … *\/}` в JSX).
 */
function makeStripper() {
  let inBlock = false;
  return (line) => {
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end < 0) return '';
      inBlock = false;
      line = line.slice(end + 2);
    }
    if (/^\s*(\/\/|\*)/.test(line)) return '';
    line = line.replace(/\/\*.*?\*\//g, '');
    const open = line.indexOf('/*');
    if (open >= 0) { inBlock = true; line = line.slice(0, open); }
    return line;
  };
}

if (!fs.existsSync(SCH)) { console.log('Контура Schoolium на фронте нет — пропуск.'); process.exit(0); }

const files = scan(SCH);
const findings = [];
let allowed = 0;
for (const file of files) {
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const strip = makeStripper();
  lines.forEach((raw, i) => {
    let line = strip(raw);
    if (!line) return;
    for (const a of ALLOW) {
      if (line.includes(a.text)) { line = line.split(a.text).join(' '); allowed++; }
    }
    for (let idx = 0; idx < line.length; idx++) {
      const cp = line.codePointAt(idx);
      const ch = String.fromCodePoint(cp);
      const hit = isHard(cp) || (SOFT.has(ch) && softHit(line, idx));
      if (hit) findings.push({ rel, line: i + 1, ch, cp, text: raw.trim().slice(0, 90) });
      if (cp > 0xffff) idx++; // суррогатная пара
    }
  });
}

if (findings.length) {
  for (const f of findings) {
    console.error(`  ❌ ${f.rel}:${f.line}: глиф «${f.ch}» (U+${f.cp.toString(16).toUpperCase().padStart(4, '0')}) — иконка только через <Icon name=… /> (AR-190)\n       ${f.text}`);
  }
  const byFile = [...new Set(findings.map((f) => f.rel))];
  console.error(`❌ G-83: глифов-иконок ${findings.length} в файлах: ${byFile.join(', ')}`);
  process.exit(1);
}
console.log(`  ✅ файлов проверено: ${files.length}; исключений по списку ALLOW применено: ${allowed}`);
for (const a of ALLOW) console.log(`     · «${a.text}» — ${a.reason}`);
console.log('✅ G-83: юникод-глифов вместо иконок в компонентах Schoolium нет (AR-190).');
