#!/usr/bin/env node
// G-37: контраст пар «текст × фон» дизайн-токенов — WCAG 2.1, перечислением.
// Текст ≥ 4.5:1; крупный текст и UI-компоненты ≥ 3.0:1. Падение = красный CI.
import fs from 'node:fs';
const T = JSON.parse(fs.readFileSync('docs/design/tokens.json','utf8')).color;
const lum = (hex)=>{ const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
  .map(c=> c<=0.03928 ? c/12.92 : ((c+0.055)/1.055)**2.4); return 0.2126*r+0.7152*g+0.0722*b; };
const ratio=(a,b)=>{const[l1,l2]=[lum(a),lum(b)].sort((x,y)=>y-x);return (l1+0.05)/(l2+0.05);};
const pairs = [
  ['основной текст на белом', T.ink.primary, T.surface.page, 4.5],
  ['вторичный текст на белом', T.ink.secondary, T.surface.page, 4.5],
  ['основной текст на канве', T.ink.primary, T.surface.canvas, 4.5],
  ['белый на violet-700 (primary-кнопка)', T.ink['on-violet'], T.brand['violet-700'], 4.5],
  ['белый на pink-600 (accent-кнопка)', T.ink['on-pink'], T.brand['pink-600'], 3.0],
  ['violet-700 как текст-ссылка на белом', T.brand['violet-700'], T.surface.page, 4.5],
  ['pink-700 как текст на белом', T.brand['pink-700'], T.surface.page, 4.5],
  ['violet-600 как крупный/UI на белом', T.brand['violet-600'], T.surface.page, 3.0],
  ['текст на violet-050 (заливка секций)', T.ink.primary, T.brand['violet-050'], 4.5],
  ['маркер мальчика: текст на заливке', T.sex['boy-ink'], T.sex['boy-bg'], 4.5],
  ['маркер девочки: текст на заливке', T.sex['girl-ink'], T.sex['girl-bg'], 4.5],
  ['отметка 5', T.mark['m5-ink'], T.mark['m5-bg'], 4.5],
  ['отметка 4', T.mark['m4-ink'], T.mark['m4-bg'], 4.5],
  ['отметка 3', T.mark['m3-ink'], T.mark['m3-bg'], 4.5],
  ['отметка 2', T.mark['m2-ink'], T.mark['m2-bg'], 4.5],
  ['отметка «н»', T.mark['n-ink'], T.mark['n-bg'], 4.5],
  ['отметка «б»', T.mark['b-ink'], T.mark['b-bg'], 4.5],
  ['danger-текст на белом', T.state.danger, T.surface.page, 4.5],
  ['warning-текст на белом', T.state.warning, T.surface.page, 4.5],
  ['success-текст на белом', T.state.success, T.surface.page, 4.5],
  ['фокус-рамка на белом (UI)', T.border.focus, T.surface.page, 3.0],
];
// Различимость пар, которые нельзя путать (ΔE-прокси: контраст между собой ≥ 1.15)
const distinct = [
  ['девочка-заливка vs pink-100 бренда', T.sex['girl-bg'], T.brand['pink-100']],
  ['отметка «б» vs маркер мальчика (текст)', T.mark['b-ink'], T.sex['boy-ink']],
];
let fails=0;
for (const [name,a,b,min] of pairs){
  const r=ratio(a,b); const okk=r>=min;
  console.log(`  ${okk?'✅':'❌'} ${name}: ${r.toFixed(2)}:1 (порог ${min})`);
  if(!okk) fails++;
}
console.log('  примечание: пары различимости —');
for (const [name,a,b] of distinct){
  console.log(`    · ${name}: ${ratio(a,b).toFixed(2)}:1 (информативно; различаются формой/контекстом, не только цветом)`);
}

// ─── Токены имеют смысл только там, где нет обхода (AR-42) ───
// Литеральный цвет в компоненте выводит пиксель из-под этой проверки: он не
// участвует ни в одной паре выше и меняется мимо `tokens.json`. Поэтому вторая
// половина ворот — перечисление по исходникам контура: цвет объявляется в
// `tokens.css` (он ГЕНЕРИРУЕТСЯ из токенов) и нигде больше.
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const scan = (dir) => {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...scan(p));
    else if (/\.(tsx?|css)$/.test(e.name) && e.name !== 'tokens.css') out.push(p);
  }
  return out;
};
const SCH = 'apps/web/src/schoolium';
let literals = 0;
if (fs.existsSync(SCH)) {
  for (const file of scan(SCH)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const line of src.split('\n')) {
      // `#` в пути, в якоре и в комментарии-ссылке цветом не является.
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      for (const m of line.match(HEX) ?? []) {
        console.error(`  ❌ литеральный цвет ${m} в ${file}: цвет объявляется токеном, а не в компоненте (AR-42)`);
        literals++;
      }
    }
  }
  console.log(`  ✅ литеральных цветов в компонентах Schoolium: ${literals} (проверено файлов: ${scan(SCH).length})`);
}

if (fails || literals){ console.error(`❌ G-37: ${fails} пар ниже порога WCAG, литеральных цветов ${literals}`); process.exit(1); }
console.log('✅ G-37: все пары токенов проходят WCAG 2.1 (текст ≥4.5, UI ≥3.0), литеральных цветов в компонентах нет.');
