/**
 * Снимки экранов для сравнения «до/после» пакета «Дизайн 1.4.0»
 * (`docs/design/1.4.0/`): девять экранов реестра плюс карточка сотрудника
 * `M-06` и меню пользователя `M-15` — в двух раскладках `75-adaptive.md` §1
 * (1440×900 и 390×844).
 *
 * Это НЕ ворота: скрипт ничего не утверждает, он документирует внешний вид.
 * Ворота внешнего вида — G-53/G-55 (смок) и G-37/G-83 (токены и иконки).
 *
 * Школа берётся из базы, которую оставил смок `smoke-onboarding.mjs`
 * (`edustore_onboarding`): классы, предметы, персонал, сетка и отметки уже
 * есть, а пустая школа показала бы одни пустые состояния. Вход — перевыпуском
 * ссылки модератора смока (`school-bootstrap.ts --relink`, AR-195: ссылка
 * многоразовая, оба контекста входят по одной).
 *
 * Сборка НЕ выполняется: снимок «до» делается с `dist`, собранного смоком до
 * правок, снимок «после» — после явной `npm --workspace apps/web run build`.
 * Иначе «до» и «после» нельзя было бы отличить по времени сборки.
 *
 * Запуск: node e2e/design-shots.mjs --out=docs/design/1.4.0/before
 * Env: SMOKE_DATABASE_URL, CHROMIUM_PATH, SHOTS_LAYOUT=desktop|mobile (по умолчанию обе).
 */
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const DB = process.env.SMOKE_DATABASE_URL ?? 'postgresql://edustore:edustore@localhost:5432/edustore_onboarding?schema=public';
const PHONE = '+79990001122';
const SCHOOL_DAY = process.env.SMOKE_SCHOOL_DAY ?? '2026-09-14';
const GEN_SEED = process.env.SMOKE_GEN_SEED ?? '20260915';
const OUT = path.resolve(ROOT, (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=docs/design/1.4.0/shots').slice(6));
const LAYOUTS = (process.env.SHOTS_LAYOUT ? [process.env.SHOTS_LAYOUT] : ['desktop', 'mobile']).map((name) =>
  name === 'mobile'
    ? { name, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
    : { name, viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
);

/** Экраны из задания шага 6: три кабинета, журнал, расписание, классы, предметы, персонал, настройки. */
const SCREENS = [
  ['01-S-10-classes', '/classes'],
  ['02-S-20-subjects', '/subjects'],
  ['03-S-30-staff', '/staff'],
  ['04-S-40-schedule', '/schedule'],
  ['05-S-50-journal', '/journal'],
  ['06-S-60-moderator', '/moderator'],
  ['07-S-62-admin', '/admin'],
  ['08-S-61-deputy', '/deputy'],
  ['09-S-82-settings', '/settings'],
];

const children = [];
const kill = () => children.forEach((c) => { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* */ } });
process.on('exit', kill);
const spawnBg = (cmd, args, opts) => {
  const c = spawn(cmd, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  c.stdout.on('data', (d) => process.env.SHOTS_VERBOSE && process.stdout.write(d));
  c.stderr.on('data', (d) => process.env.SHOTS_VERBOSE && process.stdout.write(d));
  children.push(c);
  return c;
};
async function waitHttp(url, timeoutMs = 120_000) {
  const t0 = Date.now();
  for (;;) {
    try { await fetch(url); return; }
    catch { if (Date.now() - t0 > timeoutMs) throw new Error(`не дождались ${url}`); await new Promise((r) => setTimeout(r, 700)); }
  }
}
async function assertPortFree(url) {
  try { await fetch(url, { signal: AbortSignal.timeout(2000) }); }
  catch { return; }
  console.error(`порт занят: по ${url} уже кто-то отвечает — снимите чужой процесс`);
  process.exit(1);
}

/** Экран «устоялся»: скелетонов нет, сеть тихая, шрифты дорисованы. */
async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForSelector('[data-testid="state.loading"]', { state: 'detached', timeout: 15_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
  await page.waitForTimeout(250);
}

async function main() {
  if (!fs.existsSync(path.join(ROOT, 'apps/web/dist/index.html'))) { console.error('нет apps/web/dist — соберите веб или прогоните смок'); process.exit(1); }
  if (!fs.existsSync(path.join(ROOT, 'apps/api/dist/main.js'))) { console.error('нет apps/api/dist — соберите API или прогоните смок'); process.exit(1); }

  console.log('▶ ссылка входа модератора смока (relink)');
  const out = execSync(`npx ts-node scripts/school-bootstrap.ts --phone=${PHONE} --relink`, {
    cwd: path.join(ROOT, 'apps/api'), encoding: 'utf8', env: { ...process.env, DATABASE_URL: DB, WEB_ORIGIN: WEB },
  });
  const link = (out.match(/https?:\/\/\S*\/bootstrap\/[a-f0-9]+/) ?? [])[0];
  if (!link) { console.error('relink не напечатал ссылку:\n' + out); process.exit(1); }

  await assertPortFree(`${API}/api/v1/me`);
  await assertPortFree(WEB);
  console.log('▶ старт api + web (без сборки)');
  spawnBg('node', ['dist/main.js'], {
    cwd: path.join(ROOT, 'apps/api'),
    env: { ...process.env, DATABASE_URL: DB, PORT: '3000', AUTH_MODE: 'production', WEB_ORIGIN: WEB, SCHOOL_TODAY: SCHOOL_DAY, GEN_SEED: GEN_SEED },
  });
  spawnBg('npx', ['vite', 'preview', '--port', '5173', '--strictPort'], { cwd: path.join(ROOT, 'apps/web') });
  await waitHttp(`${API}/api/v1/me`);
  await waitHttp(WEB);

  // Шрифты Inter/Manrope едут с Google Fonts: в агентной среде наружу только
  // прокси, и без него снимок отрисуется системным шрифтом — не тем, что
  // видит владелец. Прокси подставляется, когда он объявлен окружением.
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    proxy: proxy ? { server: proxy, bypass: '<-loopback>,localhost,127.0.0.1' } : undefined,
  });

  try {
    for (const layout of LAYOUTS) {
      const dir = path.join(OUT, layout.name);
      fs.mkdirSync(dir, { recursive: true });
      const ctx = await browser.newContext({
        viewport: layout.viewport, isMobile: layout.isMobile, hasTouch: layout.hasTouch,
        deviceScaleFactor: layout.deviceScaleFactor, locale: 'ru-RU', ignoreHTTPSErrors: !!proxy,
      });
      const page = await ctx.newPage();
      const shot = async (name) => {
        const file = path.join(dir, `${name}.jpg`);
        await page.screenshot({ path: file, type: 'jpeg', quality: 82 });
        console.log(`  📸 ${layout.name}/${path.basename(file)}`);
      };
      console.log(`▶ раскладка ${layout.name} ${layout.viewport.width}×${layout.viewport.height}`);
      await page.goto(link);
      try {
        await page.waitForSelector('[data-testid="L.sidebar"], [data-testid="L.tabbar"]', { timeout: 30_000 });
      } catch (e) {
        // Отладка отказа входа: адрес, заголовок и снимок — иначе таймаут ничего не называет.
        const dbg = path.join(dir, 'debug-login.jpg');
        await page.screenshot({ path: dbg, type: 'jpeg', quality: 70 }).catch(() => undefined);
        console.error(`вход не привёл к оболочке: url=${page.url()} · testids=${await page.evaluate(() => [...document.querySelectorAll('[data-testid]')].map((n) => n.getAttribute('data-testid')).slice(0, 12).join(' '))} · снимок ${path.relative(ROOT, dbg)}`);
        throw e;
      }
      for (const [name, route] of SCREENS) {
        await page.goto(`${WEB}${route}`);
        await page.waitForSelector('[data-testid="L.sidebar"], [data-testid="L.tabbar"]');
        await settle(page);
        await shot(name);
      }
      // M-06 — карточка сотрудника (шаг 5 пакета).
      await page.goto(`${WEB}/staff`);
      await settle(page);
      const card = page.locator('[data-testid="S-30.card.person"]').first();
      if (await card.count()) {
        await card.click();
        await page.waitForSelector('[data-testid="M-06"]');
        await settle(page);
        await shot('10-M-06-staff-card');
        await page.keyboard.press('Escape');
        await page.waitForSelector('[data-testid="M-06"]', { state: 'detached' }).catch(() => undefined);
      }
      // M-15 — меню пользователя (шаг 4 пакета).
      await page.locator(`[data-testid="${layout.isMobile ? 'L.header.user' : 'L.sidebar.user'}"]`).click();
      await page.waitForSelector('[data-testid="M-15"]');
      await page.waitForTimeout(250);
      await shot('11-M-15-user-menu');
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-testid="M-15"]', { state: 'detached' }).catch(() => undefined);
      // Свёрнутый сайдбар с подсказкой пункта (шаг 4 пакета) — только десктоп.
      if (!layout.isMobile) {
        await page.locator('[data-testid="L.sidebar.collapse"]').click();
        await page.locator('[data-testid="L.sidebar.item.staff"]').hover();
        await page.waitForTimeout(500);
        await shot('12-L-sidebar-collapsed');
        await page.locator('[data-testid="L.sidebar.collapse"]').click();
      }
      await ctx.close();
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
  console.log(`✅ снимки в ${path.relative(ROOT, OUT)}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
