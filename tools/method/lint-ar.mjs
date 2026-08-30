#!/usr/bin/env node
/**
 * Фитнес-функция реестров решений (docs/method/AR-PROTOCOL.md).
 * Проверяет: сквозную нумерацию, диапазоны блоков, статусы, ворота, ссылки.
 *
 * docs/method/AR-PROTOCOL.md исключён из проверки ссылок AR-N: это документ
 * ПРО нумерацию, номера в нём иллюстративные.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const AR_DIR = path.join(ROOT, 'docs/ar');
const errors = [];
const fail = (m) => errors.push(m);

const walk = (dir, acc = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.md')) acc.push(p);
  }
  return acc;
};

const parseRanges = (s) =>
  s.split(',').map((part) => {
    const [a, b] = part.trim().split('-').map(Number);
    return { from: a, to: b ?? a };
  });

// ---------- 1. разбор реестров ----------
const registers = [];
const decisions = new Map(); // n -> {register, status, gate, lenses}

for (const file of fs.readdirSync(AR_DIR).filter((f) => f.endsWith('.md') && f !== 'INDEX.md')) {
  const full = path.join(AR_DIR, file);
  const text = fs.readFileSync(full, 'utf8');
  const head = text.match(/<!--\s*ar-register:\s*id=([\w-]+);\s*ranges=([\d,\s-]+)\s*-->/);
  if (!head) { fail(`${file}: нет машинной шапки <!-- ar-register: id=…; ranges=… -->`); continue; }
  const reg = { id: head[1], file, ranges: parseRanges(head[2]) };
  registers.push(reg);

  for (const line of text.split('\n')) {
    const m = line.match(/^\|\s*AR-(\d+)\s*\|(.*)\|\s*$/);
    if (!m) continue;
    const n = Number(m[1]);
    const cells = m[2].split('|').map((c) => c.trim());
    if (cells.length < 4) { fail(`AR-${n} (${file}): ожидаются колонки Решение|Статус|Ворота|Линзы`); continue; }
    const lenses = cells[cells.length - 1];
    const gate = cells[cells.length - 2];
    const status = cells[cells.length - 3];
    const body = cells.slice(0, cells.length - 3).join('|').trim();
    if (decisions.has(n)) fail(`AR-${n}: дубликат (${decisions.get(n).register} и ${reg.id})`);
    if (!body) fail(`AR-${n} (${file}): пустая формулировка решения`);
    decisions.set(n, { register: reg.id, file, status, gate, lenses });
    if (!reg.ranges.some((r) => n >= r.from && n <= r.to))
      fail(`AR-${n} (${reg.id}): номер вне объявленных диапазонов ${head[2]}`);
  }
}

// ---------- 2. пересечение диапазонов ----------
for (let i = 0; i < registers.length; i++)
  for (let j = i + 1; j < registers.length; j++)
    for (const a of registers[i].ranges)
      for (const b of registers[j].ranges)
        if (a.from <= b.to && b.from <= a.to)
          fail(`Диапазоны пересекаются: ${registers[i].id} [${a.from}-${a.to}] и ${registers[j].id} [${b.from}-${b.to}]`);

// ---------- 3. сквозная нумерация без дыр ----------
const nums = [...decisions.keys()].sort((a, b) => a - b);
const max = nums[nums.length - 1] ?? 0;
for (let n = 1; n <= max; n++) if (!decisions.has(n)) fail(`Дыра в сквозной нумерации: AR-${n} отсутствует во всех реестрах`);

// ---------- 4. индекс ----------
const indexPath = path.join(AR_DIR, 'INDEX.md');
const index = fs.readFileSync(indexPath, 'utf8');
const nextM = index.match(/<!--\s*ar-index:\s*next=(\d+)\s*-->/);
if (!nextM) fail('INDEX.md: нет машинной шапки <!-- ar-index: next=N -->');
else if (Number(nextM[1]) !== max + 1) fail(`INDEX.md: next=${nextM[1]}, а максимум выданных AR-${max} → next должен быть ${max + 1}`);
for (const reg of registers)
  if (!index.includes(`(./${reg.file})`)) fail(`INDEX.md: реестр ${reg.file} не перечислен в индексе`);

// ---------- 5. статусы и ворота ----------
const STATUSES = ['РЕШЕНО', 'дефолт', 'узел', 'заменено', 'отменено'];
for (const [n, d] of decisions) {
  const sm = d.status.match(/^\[([^\]\s,;:]+)/);
  if (!sm) { fail(`AR-${n}: статус «${d.status}» не в формате [СТАТУС…]`); continue; }
  if (!STATUSES.includes(sm[1])) fail(`AR-${n}: неизвестный статус «${sm[1]}» (допустимо: ${STATUSES.join(', ')})`);
  if (sm[1] === 'заменено') {
    const t = d.status.match(/AR-(\d+)/);
    if (!t) fail(`AR-${n}: статус [заменено] без указания AR-N`);
    else if (!decisions.has(Number(t[1]))) fail(`AR-${n}: [заменено AR-${t[1]}] — целевое решение не существует`);
  }
  if (!d.gate) fail(`AR-${n}: пустые ворота`);
  else if (!/G-\d+/.test(d.gate) && !/^(нет|слот):/.test(d.gate))
    fail(`AR-${n}: ворота «${d.gate}» — ожидается G-n либо «нет: <причина>» / «слот: <причина>»`);
  else if (sm[1] === 'РЕШЕНО' && /^нет:\s*$/.test(d.gate))
    fail(`AR-${n}: [РЕШЕНО] без ворот и без причины`);
  if (!/L-\d+/.test(d.lenses)) fail(`AR-${n}: не указана ни одна линза (L-n)`);
}

// ---------- 6. ссылки G-n и L-n ----------
const gchecks = fs.readFileSync(path.join(ROOT, 'docs/G-CHECKS.md'), 'utf8');
const knownG = new Set([...gchecks.matchAll(/\bG-(\d+)\b/g)].map((m) => m[1]));

// ---------- 6a. номер ворот уникален ----------
// Дыра, найденная аудитом обратимости: две ветки завели G-40 на разные проверки,
// слияние оставило обе. Номер ворот — адрес; два адреса одного имени ломают
// каждую ссылку AR-N → G-N.
const gRows = [...gchecks.matchAll(/^\|\s*G-(\d+)\s*\|/gm)].map((m) => m[1]);
const gSeen = new Map();
for (const g of gRows) gSeen.set(g, (gSeen.get(g) || 0) + 1);
for (const [g, n] of gSeen) if (n > 1) fail(`G-CHECKS.md: ворота G-${g} объявлены ${n} раза — номер обязан быть уникальным`);
const lensesDoc = fs.readFileSync(path.join(ROOT, 'docs/method/LENSES.md'), 'utf8');
const knownL = new Set([...lensesDoc.matchAll(/^###\s+L-(\d+)/gm)].map((m) => m[1]));

for (const [n, d] of decisions) {
  for (const g of [...d.gate.matchAll(/\bG-(\d+)\b/g)].map((m) => m[1]))
    if (!knownG.has(g)) fail(`AR-${n}: ворота G-${g} не найдены в docs/G-CHECKS.md`);
  for (const l of [...d.lenses.matchAll(/\bL-(\d+)\b/g)].map((m) => m[1]))
    if (!knownL.has(l)) fail(`AR-${n}: линза L-${l} не найдена в docs/method/LENSES.md`);
}

// ---------- 7. висячие ссылки AR-N по всем docs ----------
const SKIP = new Set([path.join(ROOT, 'docs/method/AR-PROTOCOL.md')]);
for (const file of walk(path.join(ROOT, 'docs'))) {
  if (SKIP.has(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\bAR-(\d+)\b/g))
    if (!decisions.has(Number(m[1])))
      fail(`${path.relative(ROOT, file)}: ссылка на несуществующее решение AR-${m[1]}`);
}

// ---------- вывод ----------
console.log(`АР-реестры: ${registers.length} блоков, ${decisions.size} решений, максимум AR-${max}.`);
for (const reg of registers) {
  const c = [...decisions.values()].filter((d) => d.register === reg.id).length;
  console.log(`  ${reg.id.padEnd(10)} ${String(c).padStart(3)} решений  диапазоны ${reg.ranges.map((r) => (r.from === r.to ? r.from : `${r.from}-${r.to}`)).join(',')}`);
}
if (errors.length) {
  console.error(`\n❌ Нарушений протокола: ${errors.length}`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('✅ Протокол реестров соблюдён.');
