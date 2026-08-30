/**
 * Токены → CSS-переменные (AR-80, требование этапа 2).
 *
 * `docs/design/tokens.json` — единственный источник цвета, размера, радиуса и
 * тени. Компонент, написавший `#6427C9` руками, выводит себя из-под проверки
 * контраста G-37: та доказывает пары ТОКЕНОВ, и литеральный hex делает её
 * доказательством ни о чём. Поэтому переменные не пишутся руками, а
 * генерируются, и сгенерированный файл проверяется на актуальность.
 *
 *   node tools/design/tokens-to-css.mjs           # сгенерировать
 *   node tools/design/tokens-to-css.mjs --check   # упасть, если файл отстал
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'docs/design/tokens.json');
const OUT = join(ROOT, 'apps/web/src/schoolium/tokens.css');

const t = JSON.parse(readFileSync(SRC, 'utf8'));
const lines = [];

const push = (name, value) => lines.push(`  --${name}: ${value};`);

for (const [group, entries] of Object.entries(t.color)) {
  lines.push(`  /* color.${group} */`);
  for (const [key, value] of Object.entries(entries)) push(`c-${group}-${key}`, value);
}
lines.push('  /* font */');
push('font-family', t.font.family);
push('font-display', t.font['family-display']);
for (const [k, v] of Object.entries(t.font.size)) push(`fs-${k}`, `${v}px`);
for (const [k, v] of Object.entries(t.font.weight)) push(`fw-${k}`, String(v));
lines.push('  /* space */');
t.space.scale.forEach((v) => push(`sp-${v}`, `${v}px`));
lines.push('  /* radius */');
for (const [k, v] of Object.entries(t.radius)) push(`r-${k}`, `${v}px`);
lines.push('  /* shadow */');
for (const [k, v] of Object.entries(t.shadow)) push(`sh-${k}`, v);
lines.push('  /* tap */');
push('tap-min', `${t.tap.minTargetPx}px`);

const css = `/*
 * СГЕНЕРИРОВАННЫЙ ФАЙЛ — НЕ ПРАВИТЬ РУКАМИ.
 * Источник: docs/design/tokens.json · генератор: tools/design/tokens-to-css.mjs
 * Правка цвета/размера/радиуса/тени делается в токенах, иначе проверка контраста
 * G-37 перестаёт что-либо доказывать.
 */
:root {
${lines.join('\n')}
}
`;

if (process.argv.includes('--check')) {
  const actual = readFileSync(OUT, 'utf8');
  if (actual !== css) {
    console.error('✗ apps/web/src/schoolium/tokens.css отстал от docs/design/tokens.json');
    console.error('  почините: node tools/design/tokens-to-css.mjs');
    process.exit(1);
  }
  console.log(`✓ CSS-переменные соответствуют токенам (${lines.filter((l) => l.startsWith('  --')).length} переменных)`);
} else {
  writeFileSync(OUT, css);
  console.log(`✓ ${OUT} — ${lines.filter((l) => l.startsWith('  --')).length} переменных из ${SRC}`);
}
