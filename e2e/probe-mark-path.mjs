/**
 * ДИАГНОСТИЧЕСКИЙ ЗОНД (не ворота): проходит ли UI-путь «ячейка журнала → `S-52`
 * → чип → сервер» и «шапка даты → `S-51` → тема».
 *
 * Зачем отдельный файл. Ворота G-53 этот путь НЕ проходят: смок поднимает пустую
 * школу «сегодня», учебный год начинается 1 сентября, поэтому каждая колонка
 * журнала — будущий урок (`future: isoDay(date) > today()`), а `openMark`
 * на будущем уроке показывает тост `LESSON_NOT_HELD` и слой не открывает.
 * Экраны `S-51` и `S-52` в браузере не рендерятся ни разу, и после зелёного
 * прогона G-53 в базе ноль строк `Mark` и ноль `LessonTopic`.
 *
 * Зонд снимает ровно это одно отличие: после старта API (то есть после
 * скользящей материализации, иначе она вернёт даты в будущее) сдвигает даты
 * колонок журнала в прошлое и повторяет тот же путь руками пользователя.
 *
 * Зонд ПОРТИТ базу, к которой подключается, — только для отладочной базы.
 * Ворота из него не делать: правка дат в обход контракта — не поведение продукта.
 *
 * Запуск (после прогона `npm --workspace apps/web run smoke:onboarding`):
 *   PROBE_DATABASE_URL=postgresql://…/edustore_onboarding \
 *   CHROMIUM_PATH=/path/to/chrome node e2e/probe-mark-path.mjs
 */
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const DB = process.env.PROBE_DATABASE_URL ?? 'postgresql://edustore:edustore@localhost:5432/edustore_onboarding?schema=public';
const PHONE = process.env.PROBE_PHONE ?? '+79990001122';
const PSQL = process.env.PROBE_PSQL ?? 'PGPASSWORD=edustore psql -h 127.0.0.1 -U edustore -d edustore_onboarding';
const SHOTS = path.join(ROOT, 'e2e', 'screenshots-probe');

const children = [];
process.on('exit', () => children.forEach((c) => { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* */ } }));
const spawnBg = (cmd, args, opts) => {
  const c = spawn(cmd, args, { detached: true, stdio: 'ignore', ...opts });
  children.push(c);
  return c;
};
const waitHttp = async (url, ms = 90_000) => {
  const t0 = Date.now();
  for (;;) {
    try { await fetch(url); return; }
    catch {
      if (Date.now() - t0 > ms) throw new Error(`не дождались ${url}`);
      await new Promise((r) => setTimeout(r, 700));
    }
  }
};

let bad = 0;
const ok = (cond, msg) => { if (cond) console.log('    ✅ ' + msg); else { console.error('    ❌ ' + msg); bad++; } };

// Вход — перевыпуск одноразовой bootstrap-ссылки того же модератора (AR-93).
const out = execSync(`npx ts-node scripts/school-bootstrap.ts --phone=${PHONE} --relink`, {
  cwd: path.join(ROOT, 'apps/api'), encoding: 'utf8', env: { ...process.env, DATABASE_URL: DB, WEB_ORIGIN: WEB },
});
const token = (out.match(/bootstrap\/([a-f0-9]+)/) ?? [])[1];
if (!token) { console.error('bootstrap не напечатал ссылку:\n' + out); process.exit(1); }

spawnBg('node', ['dist/main.js'], {
  cwd: path.join(ROOT, 'apps/api'),
  env: { ...process.env, DATABASE_URL: DB, PORT: '3000', AUTH_MODE: 'production', WEB_ORIGIN: WEB },
});
spawnBg('npx', ['vite', 'preview', '--port', '5173', '--strictPort'], { cwd: path.join(ROOT, 'apps/web') });
await waitHttp(`${API}/api/v1/me`);
await waitHttp(WEB);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
const page = await ctx.newPage();

await page.goto(`${WEB}/bootstrap/${token}`);
await page.waitForSelector('[data-testid="S-10.grid.classes"], [data-testid="S-10.empty"]', { timeout: 40_000 });

// Единственное отличие от мира G-53: уроки уже прошли.
execSync(`${PSQL} -c "update \\"JournalColumn\\" set date = date - interval '60 days';"`, { stdio: 'inherit' });

await page.goto(`${WEB}/journal`);
await page.waitForSelector('[data-testid="S-50.table"]', { timeout: 40_000 });
console.log('    · колонок «будущий урок» после сдвига дат:', await page.locator('[data-testid="S-50.col.future"]').count());

// ── S-52 · выбор отметки ──
await page.locator('[data-testid="S-50.cell.mark"]').first().click();
const opened = await page.waitForSelector('[data-testid="S-52.chip.m5"]', { timeout: 8000 }).then(() => 1).catch(() => 0);
ok(opened, 'клик по ячейке открывает поповер S-52');
if (opened) {
  const order = await page.locator('[data-testid^="S-52.chip."]').evaluateAll((n) => n.map((x) => x.getAttribute('data-testid')));
  const want = ['S-52.chip.m5', 'S-52.chip.m4', 'S-52.chip.m3', 'S-52.chip.m2', 'S-52.chip.n', 'S-52.chip.b'];
  ok(JSON.stringify(order) === JSON.stringify(want), 'шесть чипов в порядке 5 4 3 2 н б (AR-79): ' + order.join(' '));
  ok((await page.locator('[data-testid="S-52.btn.clear"]').count()) > 0, 'кнопка «Убрать отметку» есть');
  await page.screenshot({ path: path.join(SHOTS, '01-S-52-popover.png') });
  await page.locator('[data-testid="S-52.chip.m5"]').click();
  await page.waitForTimeout(2000);
  ok((await page.locator('[data-testid="S-50.cell.mark"]').first().innerText()).includes('5'), 'отметка 5 отрисована в ячейке');
  ok((await page.locator('[data-testid="S-50.col.average"]').first().innerText()).trim().startsWith('5'), 'S-50.col.average пересчитан (AR-115)');
  await page.reload();
  await page.waitForSelector('[data-testid="S-50.table"]', { timeout: 30_000 });
  ok((await page.locator('[data-testid="S-50.cell.mark"]').first().innerText()).includes('5'), 'отметка пережила перезагрузку — записана на сервере');
  await page.screenshot({ path: path.join(SHOTS, '02-S-50-mark-saved.png') });
}

// ── S-51 · тема урока ──
await page.locator('[data-testid="S-50.colhead.date"]').first().click();
const topic = await page.waitForSelector('[data-testid="S-51.input.topic"]', { timeout: 8000 }).then(() => 1).catch(() => 0);
ok(topic, 'клик по шапке даты открывает поповер S-51');
if (topic) {
  ok((await page.locator('[data-testid="S-51.meta"]').count()) > 0, 'S-51.meta присутствует');
  await page.locator('[data-testid="S-51.input.topic"]').fill('Диагностическая тема');
  await page.locator('[data-testid="S-51.btn.save"]').click();
  await page.waitForTimeout(2000);
  await page.reload();
  await page.waitForSelector('[data-testid="S-50.table"]', { timeout: 30_000 });
  await page.locator('[data-testid="S-50.colhead.date"]').first().click();
  await page.waitForSelector('[data-testid="S-51.input.topic"]', { timeout: 8000 });
  ok((await page.locator('[data-testid="S-51.input.topic"]').inputValue()) === 'Диагностическая тема', 'тема урока сохранена на сервере');
  await page.screenshot({ path: path.join(SHOTS, '03-S-51-topic.png') });
  await page.keyboard.press('Escape');
}

// ── S-80 · элементы, которых смок не касается ──
await page.goto(`${WEB}/settings/devices`);
await page.waitForSelector('[data-testid="S-80.list.sessions"]', { timeout: 20_000 });
ok((await page.locator('[data-testid="S-80.btn.linkDevice"]').count()) > 0, 'S-80.btn.linkDevice присутствует');
ok((await page.locator('[data-testid="S-80.btn.endSession"]').count()) > 0, 'S-80.btn.endSession присутствует');

console.log(`\n${bad === 0 ? '✅' : '❌'} зонд UI-пути отметки: нарушений ${bad}`);
await ctx.close();
await browser.close();
process.exit(bad ? 1 : 0);
