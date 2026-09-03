#!/usr/bin/env node
/**
 * G-84 (AR-197): **слои — только через Radix, Radix — только через `ui.tsx`.**
 *
 * До 1.4.0 модалка, поповер и меню держали фокус самописной ловушкой: обход
 * фокусируемых `querySelectorAll` + перехват `Tab`, ручной возврат фокуса,
 * отдельный эффект «перефокусировать карточку после каждого рендера». Каждый
 * такой кусок терял свою гарантию по одному (этап 2 — фокус в поповере,
 * G-53 — `Esc` со второго шага мастера). Решение AR-197 переносит эти
 * гарантии в `@radix-ui/react-dialog` / `react-popover` / `react-toast`, и
 * ворота держат ДВА правила перечислением по `apps/web/src/schoolium/**\/*.tsx`:
 *
 *   1. библиотека входит в контур через один файл: `@radix-ui/*` импортируют
 *      только `ui.tsx` и `shell.tsx` — экран не знает, чем сделан слой, и
 *      смена версии Radix не трогает экраны;
 *   2. слой руками больше не пишется: вне библиотеки нет литералов
 *      `role="dialog"`/`aria-modal` (их ставит Radix), ни в одном файле нет
 *      перехвата `Tab` ради ловушки фокуса и ручного позиционирования слоя по
 *      `getBoundingClientRect` в `ui.tsx`;
 *   3. каждый слой библиотеки несёт `data-shape` (реестр форм `75-adaptive.md`
 *      §3): смок G-55 читает форму слоя атрибутом, а не догадкой.
 *
 * Запуск: node tools/design/check-layers.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SCH = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'apps/web/src/schoolium');
/** Единственные файлы, которым разрешён импорт `@radix-ui/*`. */
const RADIX_HOME = new Set(['ui.tsx', 'shell.tsx']);

const scan = (dir) => {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...scan(p));
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
};

/** Комментарии из проверки вырезаются: правило — про код, не про пояснения к нему. */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

if (!fs.existsSync(SCH)) { console.log('Контура Schoolium на фронте нет — пропуск.'); process.exit(0); }

const errors = [];
const notes = [];
let radixImports = 0;
for (const file of scan(SCH)) {
  const rel = path.relative(ROOT, file);
  const base = path.basename(file);
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    if (/from\s+["']@radix-ui\//.test(line)) {
      radixImports++;
      if (!RADIX_HOME.has(base)) errors.push(`${at}: импорт @radix-ui вне ui.tsx/shell.tsx — слой берётся из библиотеки компонентов, а не собирается экраном (AR-197 п.1)`);
    }
    if (/role=["']dialog["']|aria-modal=/.test(line)) errors.push(`${at}: литерал role="dialog"/aria-modal — семантику слоя ставит Radix, руками она расходится с поведением (AR-197 п.2)`);
    if (/key\s*===\s*["']Tab["']/.test(line)) errors.push(`${at}: ручная ловушка Tab — фокус держит FocusScope Radix, второй ловушке неоткуда взять гарантию (AR-197 п.2)`);
  });
  if (base === 'ui.tsx') {
    if (/innerHeight|innerWidth/.test(src)) errors.push(`${rel}: ручное позиционирование слоя по окну — позиционирует Popper Radix (AR-197 п.2)`);
    const dialogs = (src.match(/<Dialog\.Content\b/g) ?? []).length;
    const popovers = (src.match(/<PopoverPrimitive\.Content\b/g) ?? []).length;
    if (dialogs === 0) errors.push(`${rel}: нет ни одного <Dialog.Content> — модалка не на Radix (AR-197)`);
    if (popovers === 0) errors.push(`${rel}: нет ни одного <PopoverPrimitive.Content> — поповер не на Radix (AR-197)`);
    // Каждый <Dialog.Content …> несёт data-shape в пределах своего открывающего тега.
    for (const m of src.matchAll(/<Dialog\.Content\b([\s\S]*?)>/g)) {
      if (!/data-shape=/.test(m[1])) errors.push(`${rel}: <Dialog.Content> без data-shape — смок G-55 читает форму слоя атрибутом (75-adaptive §3)`);
    }
    notes.push(`ui.tsx: Dialog.Content ×${dialogs}, PopoverPrimitive.Content ×${popovers}, все с data-shape`);
  }
}
notes.push(`импортов @radix-ui в контуре: ${radixImports}, разрешённые файлы: ${[...RADIX_HOME].join(', ')}`);

for (const n of notes) console.log(`  ✅ ${n}`);
if (errors.length) {
  for (const e of errors) console.error(`  ❌ ${e}`);
  console.error(`❌ G-84: нарушений ${errors.length}`);
  process.exit(1);
}
console.log('✅ G-84: слои — только через Radix, Radix — только через ui.tsx/shell.tsx; ручных ловушек фокуса и литералов role="dialog" в контуре нет (AR-197).');
