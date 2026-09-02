import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = '/home/user/Schoolium';
const require = createRequire(path.join(ROOT, 'package.json'));
const { chromium, devices } = require('playwright');
const OUT = process.env.STAND_OUT; const SHOTS = path.join(OUT, 'shots');
const WEB = 'http://localhost:5173'; const DB = 'postgresql://edustore:edustore@localhost:5432/edustore_recon?schema=public';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const users = JSON.parse(fs.readFileSync(path.join(OUT, 'users.json'), 'utf8'));
const results = []; const ok = (n, d = '') => { results.push({ n, ok: true, d }); console.log(`    ✅ ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d = '') => { results.push({ n, ok: false, d }); console.log(`    ❌ ${n}${d ? ' — ' + d : ''}`); };
const note = (s) => console.log(`    · ${s}`);
const children = []; process.on('exit', () => children.forEach((c) => { try { process.kill(-c.pid, 'SIGKILL'); } catch {} }));
const spawnBg = (cmd, args, opts) => { const c = spawn(cmd, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], ...opts }); c.stdout.on('data', (d) => fs.appendFileSync(path.join(OUT, 'stand2-servers.log'), d)); c.stderr.on('data', (d) => fs.appendFileSync(path.join(OUT, 'stand2-servers.log'), d)); children.push(c); return c; };
async function waitHttp(url, ms = 120000) { const t0 = Date.now(); for (;;) { try { await fetch(url); return; } catch { if (Date.now() - t0 > ms) throw new Error('не дождались ' + url); await new Promise((r) => setTimeout(r, 500)); } } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tid = (id) => `[data-testid="${id}"]`;
async function shot(page, name) { await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); console.log(`    📷 ${name}.png`); }
async function api(page, method, url, body) { return page.evaluate(async ({ method, url, body }) => { const r = await fetch(url, { method, credentials: 'include', headers: { 'x-schoolium-client': 'browser', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, body: j }; }, { method, url, body }); }
function wrap(b) { const o = b.newContext.bind(b); b.newContext = async (opts) => { const ctx = await o(opts); await ctx.route('**/*', (r) => r.request().url().startsWith('http://localhost') ? r.continue() : r.abort()); ctx.setDefaultTimeout(20000); return ctx; }; return b; }
async function loginPw(pg, u) { await pg.goto(`${WEB}/login`); await pg.waitForSelector(tid('S-05p.link.open')); await pg.click(tid('S-05p.link.open')); await pg.fill(tid('S-05p.input.username'), u); await pg.fill(tid('S-05p.input.password'), users[u].password); await pg.click(tid('S-05p.btn.submit')); await pg.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 20000 }); await sleep(700); }
const ANDROID = { ...devices['Pixel 5'], defaultBrowserType: undefined };

async function main() {
  spawnBg('node', ['dist/main.js'], { cwd: path.join(ROOT, 'apps/api'), env: { ...process.env, DATABASE_URL: DB, PORT: '3000', AUTH_MODE: 'production', WEB_ORIGIN: WEB } });
  spawnBg('npx', ['vite', 'preview', '--port', '5173', '--strictPort'], { cwd: path.join(ROOT, 'apps/web') });
  await waitHttp('http://localhost:3000/api/v1/me'); await waitHttp(WEB);
  const browser = wrap(await chromium.launch({ executablePath: CHROME }));
  const desktop = { viewport: { width: 1440, height: 900 } };
  const L = await (await browser.newContext(desktop)).newPage();
  let token = null;
  console.log('▶ ноутбук: /login, QR');
  const resP = L.waitForResponse((r) => r.url().includes('/auth/device-link/token') && r.request().method() === 'POST');
  await L.goto(`${WEB}/login`); const j = await (await resP).json(); token = j.token;
  await L.waitForSelector(`${tid('S-01.qr')} svg`); await sleep(500);
  const jpg = await L.locator(tid('S-01.qr')).screenshot({ type: 'jpeg', quality: 95 });
  // mjpeg для поддельной камеры Chromium: те же JPEG-кадры подряд
  fs.writeFileSync(path.join(OUT, 'qr.mjpeg'), Buffer.concat(Array(60).fill(jpg)));
  note(`QR-кадр ${jpg.length} байт`);
  console.log('▶ телефон модератора с камерой, в которую подставлен кадр QR');
  const pb = wrap(await chromium.launch({ executablePath: CHROME, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${path.join(OUT, 'qr.mjpeg')}`] }));
  const PH = await (await pb.newContext(ANDROID)).newPage();
  await loginPw(PH, 'recon_mod');
  const s1 = await api(PH, 'GET', '/api/v1/auth/sessions'); fs.writeFileSync(path.join(OUT, 'phone-sessions.json'), JSON.stringify(s1.body, null, 1));
  const phoneSid = (s1.body?.sessions ?? s1.body).find((s) => s.current)?.id; note(`сессия телефона ${phoneSid}`);
  await PH.goto(`${WEB}/settings/devices`); await PH.waitForSelector(tid('S-80.btn.linkDevice')); await shot(PH, '05-phone-S80');
  await PH.click(tid('S-80.btn.linkDevice')); await PH.waitForSelector(`${tid('S-80.viewfinder')}, ${tid('S-80.error.denied')}`); await sleep(1200); await shot(PH, '05-phone-viewfinder');
  let scanned = false;
  try { await PH.waitForSelector(tid('S-80.confirm'), { timeout: 30000 }); scanned = true; ok('камера распознала QR со страницы входа ноутбука — S-80.confirm'); }
  catch { bad('камера не распознала QR за 30 с', 'переход на маршрут /link/:token как запасной'); await PH.goto(`${WEB}/link/${token}`); await PH.waitForSelector(tid('S-80.confirm')); }
  note('S-80.confirm: ' + (await PH.locator(tid('S-80.confirm')).innerText()).replace(/\s+/g, ' '));
  await shot(PH, '05-phone-confirm');
  await PH.locator(`${tid('S-80.confirm')} button`, { hasText: 'Подключить' }).first().click();
  await L.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 30000 }); await sleep(700);
  ok('ноутбук получил сессию после подтверждения на телефоне', new URL(L.url()).pathname); await shot(L, '05-laptop-after-scan'); await sleep(700); await shot(PH, '05-phone-after-approve');
  const s2 = await api(L, 'GET', '/api/v1/auth/sessions'); const lapSid = (s2.body?.sessions ?? s2.body).find((s) => s.current)?.id; note(`сессия ноутбука ${lapSid}`);
  note('S-80 телефона после привязки: ' + (await PH.locator(tid('S-80.list.sessions')).innerText().catch(() => '—')).replace(/\s+/g, ' ').slice(0, 300));
  console.log('▶ администратор: карта');
  const A = await (await browser.newContext(desktop)).newPage(); await loginPw(A, 'recon_admin');
  const map = await api(A, 'GET', '/api/v1/admin/devices'); fs.writeFileSync(path.join(OUT, 'admin-devices2.json'), JSON.stringify(map.body, null, 1));
  const mod = (map.body?.users ?? []).find((u) => u.username === 'recon_mod'); const sessions = mod?.sessions ?? [];
  for (const s of sessions) note(`  ${s.id.slice(0, 8)} via=${s.via} client=${s.clientKind} parent=${s.parentSessionId?.slice(0, 8) ?? '—'} status=${s.status} new=${s.newNetwork} ${s.deviceHint ?? s.device ?? ''}`);
  const lap = sessions.find((s) => s.id === lapSid);
  if (lap && lap.parentSessionId === phoneSid && lap.via === 'device_link') ok('API: ноутбук via=device_link, parent = сессия телефона'); else bad('API: parent ноутбука', JSON.stringify(lap));
  if (sessions.filter((s) => s.status === 'active' && s.id !== lapSid).every((s) => !s.parentSessionId)) ok('API: прямые входы без родителя'); else bad('API: прямые входы с родителем');
  await A.goto(`${WEB}/admin/devices`); await A.waitForSelector(tid('S-62.devices.search')); await A.fill(tid('S-62.devices.search'), 'recon_mod'); await sleep(600);
  const dom = await A.evaluate(() => {
    const lap = [...document.querySelectorAll('[data-testid="S-62.devices.session"]')].find((e) => e.dataset.parent);
    if (!lap) return { found: false };
    let depth = 0; let e = lap; while ((e = e.parentElement) && e !== document.body) if (e.matches('ul.sch-adm-tree')) depth++;
    const outerLi = lap.closest('ul')?.parentElement?.closest('li'); const parent = outerLi?.querySelector('[data-testid="S-62.devices.session"]');
    const lapRect = lap.getBoundingClientRect(); const pRect = parent?.getBoundingClientRect();
    return { found: true, depth, indent: pRect ? Math.round(lapRect.left - pRect.left) : null, parentText: parent?.innerText.replace(/\s+/g, ' ').slice(0, 90), childText: lap.innerText.replace(/\s+/g, ' ').slice(0, 90) };
  });
  if (dom.found && dom.depth >= 2) ok('DOM: узел ноутбука вложен под узел телефона', JSON.stringify(dom)); else bad('DOM: вложенность', JSON.stringify(dom));
  await shot(A, '05-admin-map-nested');
  // телефон 390: тот же фильтр
  const AP = await (await browser.newContext(ANDROID)).newPage(); await loginPw(AP, 'recon_admin');
  await AP.goto(`${WEB}/admin/devices`); await AP.waitForSelector(tid('S-62.devices.search')); await AP.fill(tid('S-62.devices.search'), 'recon_mod'); await sleep(600);
  const r = await AP.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })); if (r.sw <= r.cw) ok('390: карта с вложенным узлом без горизонтального скролла', JSON.stringify(r)); else bad('390: горизонтальный скролл на вложенном узле', JSON.stringify(r));
  await AP.screenshot({ path: path.join(SHOTS, '05-phone-admin-map-nested.png'), fullPage: true }); console.log('    📷 05-phone-admin-map-nested.png');
  // M-29 журнал: канал скана
  await A.locator(tid('S-62.devices.btn.journal')).first().click(); await A.waitForSelector(tid('M-29.list')); await sleep(300);
  note('M-29 модератора: ' + (await A.locator(tid('M-29.list')).innerText()).replace(/\s+/g, ' ').slice(0, 600)); await shot(A, '05-admin-M29-mod');
  // аудит
  const au = await api(A, 'GET', '/api/v1/admin/audit'); fs.writeFileSync(path.join(OUT, 'audit2.json'), JSON.stringify(au.body, null, 1));
  const entries = Array.isArray(au.body) ? au.body : (au.body?.entries ?? au.body?.items ?? []);
  const types = {}; for (const e of entries) { const k = e.action ?? e.type ?? e.event; types[k] = (types[k] ?? 0) + 1; } note('аудит: ' + JSON.stringify(types));
  await browser.close(); await pb.close();
  fs.writeFileSync(path.join(OUT, 'stand2-results.json'), JSON.stringify(results, null, 1));
  console.log(`Итог: проверок ${results.length}, нарушений ${results.filter((r) => !r.ok).length}`); process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
