#!/usr/bin/env node
/**
 * Фитнес-функция реестра линз (docs/method/LENS-PROTOCOL.md).
 * Проверяет полноту паспортов, сквозную нумерацию, покрытие чек-листа
 * эволюционной архитектуры и отсутствие «линз-сирот».
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const errors = [];
const fail = (m) => errors.push(m);

const lensesDoc = fs.readFileSync(path.join(ROOT, 'docs/method/LENSES.md'), 'utf8');
const evoDoc = fs.readFileSync(path.join(ROOT, 'docs/method/EVO-CHECKLIST.md'), 'utf8');

const REQUIRED = ['Вопрос', 'Последствие', 'Объект', 'Детектор', 'Порог', 'Тип', 'Держит', 'Статус'];
const STATUSES = ['proposed', 'active', 'automated', 'retired'];

// ---------- 1. паспорта ----------
const lenses = new Map();
const blocks = lensesDoc.split(/^###\s+/m).slice(1);
for (const block of blocks) {
  const head = block.match(/^L-(\d+)\s*·\s*(.+)$/m);
  if (!head) continue;
  const n = Number(head[1]);
  const body = block.split(/^###\s+/m)[0];
  if (lenses.has(n)) fail(`L-${n}: дубликат паспорта`);
  const fields = {};
  for (const f of REQUIRED) {
    const m = body.match(new RegExp(`^- \\*\\*${f}:\\*\\*\\s*(.+)$`, 'm'));
    if (!m || !m[1].trim()) fail(`L-${n} «${head[2].trim()}»: нет обязательного поля «${f}»`);
    else fields[f] = m[1].trim();
  }
  const status = (fields['Статус'] || '').trim();
  if (status && !STATUSES.includes(status) && !/^merged into L-\d+$/.test(status))
    fail(`L-${n}: статус «${status}» вне множества ${STATUSES.join('/')}/merged into L-x`);
  if (status === 'active' && /^(—|-|нет)$/i.test(fields['Детектор'] || ''))
    fail(`L-${n}: active-линза без детектора — допустимо только для proposed`);
  lenses.set(n, { name: head[2].trim(), ...fields, status });
}

// ---------- 2. нумерация ----------
const nums = [...lenses.keys()].sort((a, b) => a - b);
const max = nums[nums.length - 1] ?? 0;
for (let n = 1; n <= max; n++) if (!lenses.has(n)) fail(`Дыра в нумерации линз: L-${n} отсутствует`);

// ---------- 3. сводная таблица совпадает с паспортами ----------
const tableIds = new Set([...lensesDoc.matchAll(/^\|\s*L-(\d+)\s*\|/gm)].map((m) => Number(m[1])));
for (const n of lenses.keys()) if (!tableIds.has(n)) fail(`L-${n}: есть паспорт, но нет строки в сводной таблице`);
for (const n of tableIds) if (!lenses.has(n)) fail(`L-${n}: есть строка в таблице, но нет паспорта`);

// ---------- 4. ссылки паспортов ----------
const gchecks = fs.readFileSync(path.join(ROOT, 'docs/G-CHECKS.md'), 'utf8');
const knownG = new Set([...gchecks.matchAll(/\bG-(\d+)\b/g)].map((m) => m[1]));
const arDir = path.join(ROOT, 'docs/ar');
const knownAR = new Set();
for (const f of fs.readdirSync(arDir).filter((x) => x.endsWith('.md') && x !== 'INDEX.md'))
  for (const m of fs.readFileSync(path.join(arDir, f), 'utf8').matchAll(/^\|\s*AR-(\d+)\s*\|/gm)) knownAR.add(m[1]);

for (const [n, l] of lenses) {
  const holds = l['Держит'] || '';
  for (const m of holds.matchAll(/\bAR-(\d+)\b/g)) if (!knownAR.has(m[1])) fail(`L-${n}: ссылка на несуществующее AR-${m[1]}`);
  for (const m of holds.matchAll(/\bG-(\d+)\b/g)) if (!knownG.has(m[1])) fail(`L-${n}: ссылка на несуществующую G-${m[1]}`);
}

// ---------- 5. чек-лист эволюционной архитектуры покрыт линзами ----------
const evoIds = new Set();
let evoRows = 0;
for (const line of evoDoc.split('\n')) {
  const m = line.match(/^\|\s*(E-\d+\.\d+)\s*\|(.*)\|\s*$/);
  if (!m) continue;
  evoRows++;
  if (evoIds.has(m[1])) fail(`${m[1]}: дубликат пункта чек-листа`);
  evoIds.add(m[1]);
  const refs = [...m[2].matchAll(/\bL-(\d+)\b/g)].map((x) => Number(x[1]));
  if (!refs.length) fail(`${m[1]}: пункт чек-листа не связан ни с одной линзой`);
  for (const r of refs) if (!lenses.has(r)) fail(`${m[1]}: ссылка на несуществующую линзу L-${r}`);
}

// ---------- 6. линзы-сироты ----------
const referenced = new Set();
for (const m of evoDoc.matchAll(/\bL-(\d+)\b/g)) referenced.add(Number(m[1]));
for (const f of fs.readdirSync(arDir).filter((x) => x.endsWith('.md')))
  for (const m of fs.readFileSync(path.join(arDir, f), 'utf8').matchAll(/\bL-(\d+)\b/g)) referenced.add(Number(m[1]));
for (const [n, l] of lenses)
  if (l.status === 'active' && !referenced.has(n))
    fail(`L-${n} «${l.name}»: active, но не стережёт ни одного решения и ни одного пункта чек-листа (линза-сирота)`);

console.log(`Линзы: ${lenses.size} (максимум L-${max}); пунктов чек-листа: ${evoRows}.`);
const byStatus = {};
for (const l of lenses.values()) byStatus[l.status] = (byStatus[l.status] || 0) + 1;
console.log('  ' + Object.entries(byStatus).map(([k, v]) => `${k}: ${v}`).join(', '));
if (errors.length) {
  console.error(`\n❌ Нарушений протокола линз: ${errors.length}`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('✅ Протокол линз соблюдён.');
