/**
 * G-16 (AR-23) — линт каталога событий: единый канон имени + версия, перечислением.
 * 1. Собирает ВСЕ строковые литералы из *contract*.ts (реестры событий доменов) с ≥3 точками
 *    и проверяет каждый на канон `<домен>.<агрегат>.<глаголПрош>.v<N>` (EVENT_TYPE_RE).
 * 2. Запрещает легаси-префикс `edustore.` во всём src/ (старые имена не возвращаются).
 * 3. Проверяет subscribe-паттерны: сегменты канона либо wildcard `*`/`>`.
 * Не требует БД. Запуск: npm run events:check
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EVENT_TYPE_RE } from '../src/common/events/domain-event';

const SRC = path.join(__dirname, '..', 'src');
const failures: string[] = [];
let checked = 0;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const PATTERN_RE = /^([a-z][a-z0-9_]*|\*|>)(\.([a-z][a-z0-9_]*|\*|>))*$/;
const files = walk(SRC);

for (const f of files) {
  const rel = path.relative(SRC, f);
  const text = fs.readFileSync(f, 'utf8');

  // 2: легаси-префикс запрещён везде (кроме URL)
  for (const [i, line] of text.split('\n').entries()) {
    if (/['"`]edustore\./.test(line) && !line.includes('://')) {
      failures.push(`${rel}:${i + 1} — легаси-имя события с префиксом "edustore." (канон AR-23)`);
    }
  }

  // 1: реестры событий — каждый литерал вида x.y.z(.w) обязан быть каноничным
  if (/contract\.ts$/.test(rel) || /events?\.ts$/.test(path.basename(rel))) {
    for (const m of text.matchAll(/'([a-z0-9_.*>-]+\.[a-z0-9_.*>-]+\.[a-z0-9_.*>-]+[a-z0-9_.*>-]*)'/g)) {
      const lit = m[1];
      if (lit.includes('*') || lit.includes('>')) {
        if (!PATTERN_RE.test(lit)) failures.push(`${rel} — subscribe-паттерн "${lit}" вне канона`);
      } else {
        checked++;
        if (!EVENT_TYPE_RE.test(lit)) failures.push(`${rel} — событие "${lit}" вне канона <домен>.<агрегат>.<глаголПрош>.v<N>`);
      }
    }
  }
}

console.log(`Проверено литералов событий: ${checked}; файлов: ${files.length}.`);
if (failures.length) {
  console.log('\n✗ НАРУШЕНИЯ КАНОНА СОБЫТИЙ:');
  for (const f of failures) console.log(`  ✗ ${f}`);
}
console.log(`\n${failures.length === 0 ? '✓ КАНОН СОБЫТИЙ СОБЛЮДЁН' : '✗ ЕСТЬ НАРУШЕНИЯ'} — checked=${checked} fail=${failures.length}`);
process.exit(failures.length === 0 ? 0 : 1);
