#!/usr/bin/env node
/**
 * Линт спеки — ворота стадии С4 (docs/method/SPEC-PARAMETERS.md, P1…P7).
 *
 *   node tools/method/spec-lint.mjs [файл|каталог]
 *   node tools/method/spec-lint.mjs --self-test    # проверка самого линтера на фикстуре
 *
 * По умолчанию проверяет specs/<id>/30-spec.md (кроме specs/_TEMPLATE).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

// P1 — словарь размытостей
const WEASEL = [
  'быстро', 'удобн', 'оптимальн', 'и т\\.д\\.', 'и т\\.п\\.', 'при необходимости', 'обычно',
  'желательно', 'по возможности', 'корректно', 'гибк', 'адекватн', 'соответствующ', 'некотор',
  'должен быть удобным', 'интуитивн', 'как-то', 'разумн', 'достаточно быстро', 'минимальн(?:ое)? время',
];
// P2 — безадресные формулировки
const FACELESS = ['должно быть создано', 'создаётся запись', 'выполняется проверка', 'производится расчёт', 'осуществляется'];
// P7 — заявления без свидетельства
const CLAIMS = ['проверено', 'покрыто', 'гарантируется', 'всё учтено', 'полностью реализовано'];

const REQUIRED_SECTIONS = [
  { re: /^#{1,3}\s.*(границ|что не входит)/im, name: 'Границы / что НЕ входит' },
  { re: /^#{1,3}\s.*(контракт|api)/im, name: 'Контракты' },
  { re: /^#{1,3}\s.*(критери|готовност)/im, name: 'Критерии готовности' },
  { re: /^#{1,3}\s.*(открыт|узл|слот)/im, name: 'Открытые узлы' },
];

function lintSpec(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const rel = path.relative(ROOT, file);
  const found = [];
  const add = (p, line, msg) => found.push({ p, line, msg });

  // P1
  const weaselRe = new RegExp(`(${WEASEL.join('|')})`, 'i');
  let weaselCount = 0;
  lines.forEach((l, i) => {
    if (l.trim().startsWith('>') || l.trim().startsWith('<!--')) return;
    const m = l.match(weaselRe);
    if (m) { weaselCount++; add('P1', i + 1, `размытая формулировка «${m[1]}»`); }
  });
  const density = (weaselCount / Math.max(lines.length, 1)) * 100;
  if (density > 2) add('P1', 0, `плотность размытостей ${density.toFixed(1)} на 100 строк (порог 2)`);

  // P2
  const facelessRe = new RegExp(`(${FACELESS.join('|')})`, 'i');
  lines.forEach((l, i) => { const m = l.match(facelessRe); if (m) add('P2', i + 1, `нет субъекта действия: «${m[1]}» — кто делает?`); });

  // P3 — если есть FSM, должна быть матрица полноты
  if (/\bFSM\b|конечн\w* автомат|состояни\w*\s*→/i.test(text)) {
    const hasMatrix = /\|.*состояни\w*.*\|.*(выход|терминал)/i.test(text);
    if (!hasMatrix) add('P3', 0, 'упомянут FSM, но нет матрицы полноты «состояние × (выход, дом, терминал)»');
    lines.forEach((l, i) => {
      const m = l.match(/^\|\s*[^|]+\|(.*)\|\s*$/);
      if (m && /состояни/i.test(text) && /\|\s*(—|\?|TBD|)\s*\|/.test(l) && /^\|\s*[a-zа-я_]/i.test(l))
        add('P3', i + 1, 'пустая ячейка в матрице — дыра полноты');
    });
  }

  // P5
  if (!/этап закрыт|критери\w+ приёмк|определени\w+ готовности/i.test(text))
    add('P5', 0, 'нет критериев приёмки в форме «когда … — этап закрыт»');

  // P6
  if (!/\bAR-\d+\b/.test(text)) add('P6', 0, 'спека не ссылается ни на одно решение реестра (AR-N)');
  if (!/\bG-\d+\b/.test(text)) add('P6', 0, 'спека не называет ворота (G-n), которыми будет доказана');

  // P7
  const claimRe = new RegExp(`(${CLAIMS.join('|')})`, 'i');
  lines.forEach((l, i) => {
    const m = l.match(claimRe);
    if (m && !/(G-\d+|матриц|перечислен|\.mjs|\.md)/i.test(l))
      add('P7', i + 1, `утверждение «${m[1]}» без свидетельства (нужна ссылка на G-проверку, матрицу или прогон)`);
  });
  for (const s of REQUIRED_SECTIONS) if (!s.re.test(text)) add('P7', 0, `нет обязательного раздела: ${s.name}`);

  return { rel, found };
}

function collect(target) {
  const out = [];
  const st = fs.existsSync(target) ? fs.statSync(target) : null;
  if (!st) return out;
  if (st.isFile()) return [target];
  for (const e of fs.readdirSync(target, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === '_TEMPLATE') continue;
      out.push(...collect(path.join(target, e.name)));
    } else if (/^30-spec\.md$/.test(e.name)) out.push(path.join(target, e.name));
  }
  return out;
}

// ---------- self-test ----------
if (process.argv.includes('--self-test')) {
  const fx = path.join(ROOT, 'tools/method/fixtures/bad-spec.md');
  const { found } = lintSpec(fx);
  const expected = ['P1', 'P2', 'P3', 'P5', 'P6', 'P7'];
  const got = new Set(found.map((f) => f.p));
  const missing = expected.filter((p) => !got.has(p));
  if (missing.length) {
    console.error(`❌ Самопроверка линтера: на фикстуре не сработали параметры ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log(`✅ Самопроверка линтера: на фикстуре сработали все параметры (${found.length} находок).`);
  process.exit(0);
}

const target = process.argv[2] || path.join(ROOT, 'specs');
const files = collect(target);
if (!files.length) {
  console.log('Спек для проверки нет (specs/<id>/30-spec.md отсутствуют) — пропуск.');
  process.exit(0);
}
let total = 0;
for (const f of files) {
  const { rel, found } = lintSpec(f);
  total += found.length;
  if (!found.length) { console.log(`✅ ${rel}: параметры P1…P7 в пороге.`); continue; }
  console.error(`❌ ${rel}: находок ${found.length}`);
  for (const x of found) console.error(`  · ${x.p}${x.line ? ` стр.${x.line}` : ''}: ${x.msg}`);
}
process.exit(total ? 1 : 0);
