#!/usr/bin/env node
/**
 * G-40: набор инструкций агентов против конвейера.
 *  — каждая стадия конвейера имеет агента;
 *  — каждая инструкция содержит обязательные разделы;
 *  — каждая инструкция перечислена в README и наоборот;
 *  — все ссылки на файлы репозитория существуют.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'docs/method/agents');
if (!fs.existsSync(DIR)) { console.log('Инструкций агентов нет — пропуск.'); process.exit(0); }

const errors = [];
const fail = (m) => errors.push(m);
const REQUIRED = ['Роль', 'Вход', 'Что делает', 'Выход', 'Ворота', 'Запреты', 'Типовые ошибки', 'Передача'];

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
const readme = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');

// ---------- 1. разделы и заголовок ----------
const agents = new Map();
for (const f of files) {
  const text = fs.readFileSync(path.join(DIR, f), 'utf8');
  const head = text.match(/^#\s+(А-\d+)\s+·\s+(.+)$/m);
  if (!head) { fail(`${f}: заголовок не в формате «# А-N · Имя»`); continue; }
  if (agents.has(head[1])) fail(`${head[1]}: дубликат агента (${agents.get(head[1]).file} и ${f})`);
  agents.set(head[1], { file: f, name: head[2].trim(), text });
  for (const sec of REQUIRED)
    if (!new RegExp(`^##\\s+${sec}`, 'm').test(text)) fail(`${f} (${head[1]}): нет обязательного раздела «${sec}»`);
  if (!readme.includes(`(./${f})`)) fail(`${f}: не перечислен в README агентов`);
}

// ---------- 2. README не ссылается на несуществующее ----------
for (const m of readme.matchAll(/\(\.\/([\w.-]+\.md)\)/g))
  if (!fs.existsSync(path.join(DIR, m[1]))) fail(`README ссылается на отсутствующий файл ${m[1]}`);

// ---------- 3. покрытие стадий конвейера ----------
const pipeline = fs.readFileSync(path.join(ROOT, 'docs/method/PIPELINE.md'), 'utf8');
const stages = [...pipeline.matchAll(/^##\s+(С\d)\.\s/gm)].map((m) => m[1]);
const covered = new Set();
for (const a of agents.values()) for (const m of a.text.matchAll(/С(\d)(?!\d)/g)) covered.add('С' + m[1]);
for (const s of stages) if (!covered.has(s)) fail(`стадия конвейера ${s} не закреплена ни за одним агентом`);
if (stages.length < 5) fail('стадии конвейера не разобраны из PIPELINE.md');

// ---------- 4. ссылки на файлы репозитория существуют ----------
for (const [id, a] of agents)
  for (const m of a.text.matchAll(/`((?:docs|tools|specs|e2e)\/[\w./-]+)`/g)) {
    const rel = m[1];
    if (rel.includes('<') || rel.includes('*')) continue;
    if (!fs.existsSync(path.join(ROOT, rel))) fail(`${a.file} (${id}): ссылка на несуществующий путь ${rel}`);
  }

console.log(`Агенты: ${agents.size}; стадий конвейера: ${stages.length}; обязательных разделов: ${REQUIRED.length}.`);
if (errors.length) {
  console.error(`\n❌ Нарушений в инструкциях агентов: ${errors.length}`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('✅ G-40: каждая стадия конвейера закреплена за агентом, инструкции полны, ссылки разрешаются.');
