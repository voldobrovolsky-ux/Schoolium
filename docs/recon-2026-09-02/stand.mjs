/**
 * Стенд рекогносцировки 1.3.0: три роли, кабинеты, телефон, два устройства, лимит, инцидент.
 * Запуск: node <path>/stand.mjs
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/user/Schoolium';
const require = createRequire(path.join(ROOT, 'package.json'));
const { chromium, devices } = require('playwright');
const OUT = process.env.STAND_OUT;
const SHOTS = path.join(OUT, 'shots');
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const DB = 'postgresql://edustore:edustore@localhost:5432/edustore_recon?schema=public';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FFMPEG = '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux';

const results = [];
const log = (s) => { console.log(s); };
const ok = (name, detail = '') => { results.push({ name, ok: true, detail }); log(`    ✅ ${name}${detail ? ' — ' + detail : ''}`); };
const bad = (name, detail = '') => { results.push({ name, ok: false, detail }); log(`    ❌ ${name}${detail ? ' — ' + detail : ''}`); };
const note = (s) => { results.push({ name: s, note: true }); log(`    · ${s}`); };
const children = [];
const kill = () => children.forEach((c) => { try { process.kill(-c.pid, 'SIGKILL'); } catch {} });
process.on('exit', kill);
const spawnBg = (cmd, args, opts) => {
  const c = spawn(cmd, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  c.stdout.on('data', (d) => fs.appendFileSync(path.join(OUT, 'stand-servers.log'), d));
  c.stderr.on('data', (d) => fs.appendFileSync(path.join(OUT, 'stand-servers.log'), d));
  children.push(c); return c;
};
async function waitHttp(url, ms = 120000) { const t0 = Date.now(); for (;;) { try { await fetch(url); return; } catch { if (Date.now() - t0 > ms) throw new Error('не дождались ' + url); await new Promise((r) => setTimeout(r, 500)); } } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(page, name) { await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false }); log(`    📷 ${name}.png`); }
async function step(name, fn) { log(`▶ ${name}`); try { await fn(); } catch (e) { bad(`${name}: исключение`, String(e.message ?? e).split('\n')[0].slice(0, 300)); } }
const tid = (id) => `[data-testid="${id}"]`;
async function has(page, id, label) { const n = await page.locator(tid(id)).count(); if (n > 0) ok(label ?? id); else bad(label ?? id, 'элемент отсутствует'); return n > 0; }
async function absent(page, id, label) { const n = await page.locator(tid(id)).count(); if (n === 0) ok(label ?? `${id} отсутствует`); else bad(label ?? `${id} отсутствует`, `найдено ${n}`); }
async function api(page, method, url, body) {
  url = url.replace(API, '');
  return page.evaluate(async ({ method, url, body }) => {
    const r = await fetch(url, { method, credentials: 'include', headers: { 'x-schoolium-client': 'browser', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
  }, { method, url, body });
}
async function hscroll(page, label) {
  const r = await page.evaluate(() => ({ sw: document.body.scrollWidth, cw: document.documentElement.clientWidth, dsw: document.documentElement.scrollWidth }));
  if (r.sw <= r.cw && r.dsw <= r.cw) ok(`${label}: body без горизонтального скролла`, `scrollWidth ${r.sw}/${r.dsw}, clientWidth ${r.cw}`);
  else bad(`${label}: body скроллится по горизонтали`, `scrollWidth ${r.sw}/${r.dsw}, clientWidth ${r.cw}`);
}
const ANDROID = devices['Pixel 5'];
function wrapBrowser(b) {
  const orig = b.newContext.bind(b);
  b.newContext = async (opts) => {
    const ctx = await orig(opts);
    await ctx.route('**/*', (route) => { const u = route.request().url(); if (u.startsWith('http://localhost')) return route.continue(); return route.abort(); });
    ctx.setDefaultTimeout(20000);
    return ctx;
  };
  return b;
}
const IPHONE = { ...devices['iPhone 13'], defaultBrowserType: 'chromium' };

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  // ── стенд ──
  log('▶ bootstrap + provision');
  const envApi = { ...process.env, DATABASE_URL: DB, WEB_ORIGIN: WEB };
  const b = execSync(`npx ts-node scripts/school-bootstrap.ts --phone=+79990009999 --school="Школа рекогносцировки" --name="Оператор Платформы" --username=recon_op`, { cwd: path.join(ROOT, 'apps/api'), env: envApi, encoding: 'utf8' });
  fs.writeFileSync(path.join(OUT, 'bootstrap.out.txt'), b);
  const p = execSync(`npx ts-node scripts/school-provision.ts --admin-name="Петров Андрей" --admin-username=recon_admin --moderator-name="Иванова Оксана" --moderator-username=recon_mod --deputy-name="Сидорова Елена" --deputy-username=recon_dep`, { cwd: path.join(ROOT, 'apps/api'), env: envApi, encoding: 'utf8' });
  fs.writeFileSync(path.join(OUT, 'provision.out.txt'), p);
  const users = {};
  let cur = null;
  for (const line of p.split('\n')) {
    const m = line.match(/^— .*\(@(\w+)\)/); if (m) { cur = m[1]; users[cur] = { username: cur }; continue; }
    const pw = line.match(/пароль (\S+)/); if (pw && cur) users[cur].password = pw[1];
    const l = line.match(/(https?:\/\/\S+\/bootstrap\/[a-f0-9]+)/); if (l && cur) users[cur].link = l[1];
  }
  log(JSON.stringify(users, null, 1));
  for (const u of ['recon_admin', 'recon_mod', 'recon_dep']) if (users[u]?.link && users[u]?.password) ok(`provision: ${u} — ссылка 48 ч и креды напечатаны`); else bad(`provision: ${u}`, JSON.stringify(users[u]));
  const ttl = p.match(/ссылка входа \((\d+) ч\)/); if (ttl?.[1] === '48') ok('provision печатает срок 48 ч'); else bad('provision срок', ttl?.[0]);

  log('▶ старт api + web');
  spawnBg('node', ['dist/main.js'], { cwd: path.join(ROOT, 'apps/api'), env: { ...process.env, DATABASE_URL: DB, PORT: '3000', AUTH_MODE: 'production', WEB_ORIGIN: WEB } });
  spawnBg('npx', ['vite', 'preview', '--port', '5173', '--strictPort'], { cwd: path.join(ROOT, 'apps/web') });
  await waitHttp(`${API}/api/v1/me`); await waitHttp(WEB);

  const browser0 = await chromium.launch({ executablePath: CHROME, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const browser = wrapBrowser(browser0);
  const desktop = { viewport: { width: 1440, height: 900 } };
  const A = await (await browser.newContext(desktop)).newPage();  // администратор
  const B = await (await browser.newContext(desktop)).newPage();  // модератор
  const C = await (await browser.newContext(desktop)).newPage();  // завуч
  const consoleErrors = [];
  for (const pg of [A, B, C]) pg.on('pageerror', (e) => consoleErrors.push(String(e.message).slice(0, 200)));

  // ── 3. вход по ссылкам ──
  const landed = {};
  for (const [pg, u, expect] of [[A, 'recon_admin', '/classes'], [B, 'recon_mod', '/classes'], [C, 'recon_dep', '/deputy']]) {
    await step(`вход по ссылке: ${u}`, async () => {
      await pg.goto(users[u].link);
      await pg.waitForFunction(() => !location.pathname.startsWith('/bootstrap'), null, { timeout: 30000 });
      await sleep(700);
      const where = new URL(pg.url()).pathname; landed[u] = where;
      if (where === expect) ok(`${u}: ссылка ведёт на ${expect}`); else bad(`${u}: стартовый экран`, `ожидали ${expect}, получили ${where}`);
      const me = await api(pg, 'GET', `${API}/api/v1/me`);
      fs.writeFileSync(path.join(OUT, `me-${u}.json`), JSON.stringify(me.body, null, 1));
      note(`${u}: roles=${JSON.stringify(me.body?.roles ?? me.body?.membership?.roles)} startScreen=${me.body?.startScreen} activated=${me.body?.activated ?? me.body?.membership?.activatedAt ?? '?'}`);
      await shot(pg, `03-link-${u}`);
    });
  }
  await step('повторное открытие ссылки — TOKEN_USED', async () => {
    const pg = await (await browser.newContext(desktop)).newPage();
    await pg.goto(users.recon_dep.link); await sleep(700); await sleep(1500);
    const txt = (await pg.locator('body').innerText()).slice(0, 600); fs.writeFileSync(path.join(OUT, 'link-reused.txt'), txt);
    if (/использован|уже/i.test(txt)) ok('повторная ссылка отклонена словами', txt.replace(/\s+/g, ' ').slice(0, 120)); else bad('повторная ссылка', txt.replace(/\s+/g, ' ').slice(0, 160));
    await shot(pg, '03-link-reused'); await pg.context().close();
  });

  // ── сайдбар ──
  await step('сайдбар: пункты кабинетов по правам', async () => {
    for (const [pg, u, want] of [[A, 'admin', ['admin', 'moderator', 'deputy']], [B, 'moderator', ['moderator']], [C, 'deputy', ['deputy']]]) {
      await pg.goto(`${WEB}${landed[u === 'admin' ? 'recon_admin' : u === 'moderator' ? 'recon_mod' : 'recon_dep']}`); await pg.waitForSelector(tid('L.sidebar'));
      for (const k of ['admin', 'moderator', 'deputy']) {
        const n = await pg.locator(tid(`L.sidebar.item.${k}`)).count();
        if (want.includes(k) ? n === 1 : n === 0) ok(`${u}: сайдбар ${k} ${want.includes(k) ? 'есть' : 'нет'}`); else bad(`${u}: сайдбар ${k}`, `найдено ${n}`);
      }
    }
  });

  // ── 3. администратор: тур ──
  const adminSections = [
    ['overview', ['S-62.subnav', 'S-62.overview.stats', 'S-62.overview.school', 'S-62.overview.pending', 'S-62.overview.links']],
    ['devices', ['S-62.devices.summary', 'S-62.devices.search', 'S-62.devices.user', 'S-62.devices.session', 'S-62.devices.btn.journal']],
    ['roles', ['S-62.roles.matrix', 'S-62.roles.legend']],
    ['network', ['S-62.network.empty', 'S-62.network.btn.addWifi']],
    ['audit', ['S-62.audit']],
    ['policy', ['S-62.policy.limits', 'S-62.policy.btn.save', 'S-62.policy.incident', 'S-62.policy.btn.incident']],
  ];
  for (const [sec, ids] of adminSections) {
    await step(`админ: /admin/${sec}`, async () => {
      await A.goto(`${WEB}/admin/${sec === 'overview' ? '' : sec}`);
      await A.waitForSelector(tid(ids[0]), { timeout: 20000 }); await sleep(700); await sleep(400);
      for (const id of ids) await has(A, id, `S-62 ${sec}: ${id}`);
      await shot(A, `03-admin-${sec}`);
    });
  }
  await step('админ: устройства — сессии трёх людей', async () => {
    await A.goto(`${WEB}/admin/devices`); await A.waitForSelector(tid('S-62.devices.user'));
    const usersOnMap = await A.locator(tid('S-62.devices.user')).count();
    const sess = await A.locator(tid('S-62.devices.session')).count();
    note(`на карте людей ${usersOnMap}, сессий ${sess}`);
    const order = await A.locator(tid('S-62.devices.user')).allInnerTexts();
    note('порядок: ' + order.map((t) => t.split('\n')[0]).join(' | '));
    const current = await A.locator(`${tid('S-62.devices.session')}:has-text("это устройство"), ${tid('S-62.devices.session')}[data-current="true"]`).count();
    note(`узлов «текущая сессия»: ${current}`);
    const revokeBtns = await A.locator(tid('S-62.devices.btn.revoke')).count();
    note(`кнопок «Завершить»: ${revokeBtns} при ${sess} сессиях`);
  });
  await step('админ: матрица ролей сходится с ROLE_PERMISSIONS', async () => {
    await A.goto(`${WEB}/admin/roles`); await A.waitForSelector(tid('S-62.roles.matrix'));
    const txt = await A.locator(tid('S-62.roles.matrix')).innerText();
    fs.writeFileSync(path.join(OUT, 'roles-matrix.txt'), txt);
    note(`матрица: ${txt.split('\n').length} строк текста`);
  });

  // ── 3. модератор ──
  await step('модератор: /moderator и отказы', async () => {
    await B.goto(`${WEB}/moderator`); await B.waitForSelector(tid('S-60.nav'), { timeout: 20000 }); await has(B, 'S-60.nav'); await has(B, 'S-60.audit'); await shot(B, '03-mod-moderator');
    await B.goto(`${WEB}/admin`); await B.waitForSelector(`${tid('S-62.forbidden')}, ${tid('S-62.subnav')}`, { timeout: 20000 });
    if (await B.locator(tid('S-62.forbidden')).count()) { const t = await B.locator(tid('S-62.forbidden')).innerText(); if (/администратору школы/.test(t)) ok('модератор на /admin: 403 с причиной', t.split('\n')[0]); else bad('модератор на /admin: текст', t.slice(0, 120)); } else bad('модератор на /admin', 'кабинет открылся');
    await shot(B, '03-mod-admin-403');
    await B.goto(`${WEB}/deputy`); await B.waitForSelector(`${tid('S-61.forbidden')}, ${tid('S-61.utc')}`, { timeout: 20000 });
    if (await B.locator(tid('S-61.forbidden')).count()) ok('модератор на /deputy: 403 с причиной', (await B.locator(tid('S-61.forbidden')).innerText()).split('\n')[0]); else bad('модератор на /deputy', 'кабинет открылся');
    await shot(B, '03-mod-deputy-403');
    for (const [u, exp] of [['/api/v1/admin/overview', 403], ['/api/v1/admin/devices', 403], ['/api/v1/deputy', 403], ['/api/v1/moderator', 200]]) {
      const r = await api(B, 'GET', `${API}${u}`); if (r.status === exp) ok(`модератор API ${u} → ${exp}`, r.body?.code ?? ''); else bad(`модератор API ${u}`, `ожидали ${exp}, получили ${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
    }
    const rr = await api(B, 'POST', `${API}/api/v1/admin/sessions/revoke-all`); if (rr.status === 403) ok('модератор POST revoke-all → 403', rr.body?.code); else bad('модератор revoke-all', String(rr.status));
  });

  // ── 3. завуч ──
  await step('завуч: /deputy чек-листы', async () => {
    await C.goto(`${WEB}/deputy`); await C.waitForSelector(tid('S-61.item'), { timeout: 20000 }); await sleep(700); await sleep(300);
    for (const id of ['S-61.head', 'S-61.stats', 'S-61.utc', 'S-61.kpc', 'S-61.btn.schedule', 'S-61.btn.journal']) await has(C, id, `S-61: ${id}`);
    const items = await C.locator(tid('S-61.item')).evaluateAll((els) => els.map((e) => ({ key: e.dataset.key, done: e.dataset.done, text: e.innerText.replace(/\s+/g, ' ').slice(0, 120) })));
    fs.writeFileSync(path.join(OUT, 'deputy-items.json'), JSON.stringify(items, null, 1));
    const keys = items.map((i) => i.key).join(',');
    const want = 'terms,load,skeleton,dayParams,priorities,generated,confirmed,journal,classes,students,subjects,bindings,staff,guardians';
    if (keys === want) ok('S-61: 14 пунктов в порядке реестра'); else bad('S-61: ключи', keys);
    const go = await C.locator(tid('S-61.btn.go')).count(); if (go === 14) ok('S-61: у каждого пункта «Открыть»'); else bad('S-61.btn.go', String(go));
    for (const i of items) note(`  ${i.key} done=${i.done}: ${i.text}`);
    await shot(C, '03-dep-deputy');
    await C.click(tid('S-61.btn.schedule')); await C.waitForURL(/\/schedule/, { timeout: 20000 }); await sleep(700); await sleep(500);
    await shot(C, '03-dep-schedule');
    const load = await C.locator(tid('S-40.btn.load')).count();
    if (load) { await C.click(tid('S-40.btn.load')); await C.waitForSelector(tid('M-22'), { timeout: 20000 }); ok('завуч: M-22 «Нормы часов» открывается'); await shot(C, '03-dep-M22'); await C.keyboard.press('Escape'); }
    else bad('завуч: S-40.btn.load на /schedule', 'кнопки нет; текст: ' + (await C.locator('main, body').first().innerText()).replace(/\s+/g, ' ').slice(0, 200));
    const build = await C.locator(tid('S-40.btn.build')).count(); note(`завуч видит S-40.btn.build (сборка): ${build}`);
    await C.goto(`${WEB}/moderator`); await C.waitForSelector(`${tid('forbidden')}, ${tid('S-60.nav')}`, { timeout: 20000 });
    if (await C.locator(tid('forbidden')).count()) ok('завуч на /moderator: 403 с причиной', (await C.locator(tid('forbidden')).innerText()).split('\n')[0]); else bad('завуч на /moderator', 'кабинет открылся');
    await shot(C, '03-dep-moderator-403');
    await C.goto(`${WEB}/admin`); await C.waitForSelector(`${tid('S-62.forbidden')}, ${tid('S-62.subnav')}`, { timeout: 20000 });
    if (await C.locator(tid('S-62.forbidden')).count()) ok('завуч на /admin: 403'); else bad('завуч на /admin', 'кабинет открылся');
    for (const [u, exp] of [['/api/v1/moderator', 403], ['/api/v1/admin/overview', 403], ['/api/v1/deputy', 200]]) {
      const r = await api(C, 'GET', `${API}${u}`); if (r.status === exp) ok(`завуч API ${u} → ${exp}`, r.body?.code ?? ''); else bad(`завуч API ${u}`, `${r.status}`);
    }
    // журнал и классы на чтение
    await C.goto(`${WEB}/journal`); await sleep(700); await sleep(500); await shot(C, '03-dep-journal');
    await C.goto(`${WEB}/classes`); await sleep(700); await sleep(500);
    const newCls = await C.locator(tid('S-10.btn.newClasses')).count(); note(`завуч на /classes видит «Создать классы»: ${newCls}`); await shot(C, '03-dep-classes');
  });

  // ── 3. S-31: ссылка входа с карточки ──
  let staffList = null;
  await step('админ: S-31 ссылка входа для завуча', async () => {
    const r = await api(A, 'GET', `${API}/api/v1/staff`); staffList = r.body; fs.writeFileSync(path.join(OUT, 'staff.json'), JSON.stringify(r.body, null, 1));
    await A.goto(`${WEB}/staff`); await A.waitForSelector(tid('S-30.card.person'), { timeout: 20000 });
    await A.locator(`${tid('S-30.card.person')}:has-text("Сидорова")`).first().click();
    await A.waitForSelector(tid('S-31.btn.loginLink'), { timeout: 20000 });
    await has(A, 'S-31.activity', 'S-31.activity у админа'); await has(A, 'S-31.btn.loginCode', 'S-31.btn.loginCode');
    await A.click(tid('S-31.btn.loginLink')); await A.waitForSelector(tid('S-31.loginLink'), { timeout: 20000 });
    const t = await A.locator(tid('S-31.loginLink')).innerText(); const link = (t.match(/https?:\/\/\S+\/bootstrap\/[a-f0-9]+/) ?? [])[0];
    if (link) ok('S-31: ссылка выдана', t.replace(/\s+/g, ' ').slice(0, 160)); else bad('S-31: ссылка', t.slice(0, 200));
    users.recon_dep.link2 = link;
    await shot(A, '03-admin-S31-loginLink');
    const act = await A.locator(tid('S-31.activity')).innerText(); note('S-31.activity: ' + act.replace(/\s+/g, ' ').slice(0, 200));
    await A.click(tid('S-31.btn.close')).catch(() => A.keyboard.press('Escape'));
    // модератору кнопки быть не должно
    await B.goto(`${WEB}/staff`); await B.waitForSelector(tid('S-30.card.person'), { timeout: 20000 });
    await B.locator(`${tid('S-30.card.person')}:has-text("Сидорова")`).first().click(); await B.waitForSelector(tid('S-31.btn.loginCode'), { timeout: 20000 });
    await absent(B, 'S-31.btn.loginLink', 'модератор: S-31.btn.loginLink отсутствует'); await has(B, 'S-31.activity', 'модератор: S-31.activity видна (staff.manage)');
    await shot(B, '03-mod-S31'); await B.keyboard.press('Escape');
    const rr = await api(B, 'POST', `${API}/api/v1/staff/${staffList?.find?.((s) => s.username === 'recon_dep')?.id ?? 'x'}/login-link`); if (rr.status === 403) ok('модератор POST login-link → 403', rr.body?.code); else bad('модератор login-link', `${rr.status} ${JSON.stringify(rr.body).slice(0, 100)}`);
  });
  const D = await (await browser.newContext(desktop)).newPage();
  await step('вход завуча по ссылке с карточки (login_link)', async () => {
    await D.goto(users.recon_dep.link2); await D.waitForFunction(() => !location.pathname.startsWith('/bootstrap'), null, { timeout: 30000 }); await sleep(700);
    const where = new URL(D.url()).pathname; if (where === '/deputy') ok('ссылка с карточки ведёт на /deputy'); else bad('ссылка с карточки: экран', where);
    await shot(D, '03-dep-loginlink');
  });

  // ── 4. телефон: вход по коду, меню, S-81, карта ──
  const codeRes = await api(A, 'POST', `${API}/api/v1/staff/${staffList?.find?.((s) => s.username === 'recon_mod')?.id}/login-code`);
  note(`код входа модератора: ${JSON.stringify(codeRes.body)}`);
  const P = await (await browser.newContext({ ...ANDROID, defaultBrowserType: undefined })).newPage(); // телефон модератора
  await step('телефон: S-01 → S-05 вход по коду', async () => {
    await P.goto(`${WEB}/login`); await P.waitForSelector(tid('S-01.link.byCode'), { timeout: 20000 }); await shot(P, '04-phone-S01');
    await P.click(tid('S-01.link.byCode')); await P.waitForSelector(tid('S-05.code'), { timeout: 20000 }); await sleep(300);
    const g = await P.evaluate(() => {
      const cells = [...document.querySelectorAll('[data-testid="S-05.code"] .sch-code-cell, [data-testid="S-05.code"] input')];
      const card = document.querySelector('[data-testid="S-05.code"]').closest('.sch-auth-card, .sch-card, section, main');
      const cr = card.getBoundingClientRect();
      return { card: [cr.left, cr.right], cells: cells.map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.width), Math.round(r.height)]; }) };
    });
    const outside = g.cells.filter((c) => c[0] < g.card[0] - 1 || c[1] > g.card[1] + 1);
    if (g.cells.length === 6 && outside.length === 0 && g.cells.every((c) => c[2] >= 40 && c[2] <= 56 && Math.abs(c[2] - c[3]) <= 1)) ok('S-05: 6 ячеек внутри карточки', JSON.stringify(g)); else bad('S-05: геометрия ячеек', JSON.stringify(g));
    await shot(P, '04-phone-S05');
    await P.locator(`${tid('S-05.code')} input`).first().focus(); await P.keyboard.type(String(codeRes.body.code), { delay: 60 });
    await P.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 20000 }); await sleep(700);
    ok('телефон: вход по коду', new URL(P.url()).pathname); await shot(P, '04-phone-after-code');
    await hscroll(P, 'телефон после входа');
  });
  await step('телефон модератора: меню пользователя M-15', async () => {
    await P.click(tid('L.header.user')); await P.waitForSelector(tid('M-15'), { timeout: 20000 });
    const cab = await P.locator('[data-testid^="M-15.cabinet."]').evaluateAll((els) => els.map((e) => e.dataset.testid));
    note('M-15 модератора: кабинеты ' + JSON.stringify(cab));
    for (const id of ['M-15.settings', 'M-15.devices', 'M-15.logout']) await has(P, id, `M-15: ${id}`);
    await shot(P, '04-phone-M15-moderator'); await P.keyboard.press('Escape');
    const hdr = await P.locator(tid('L.header.admin')).count(); note(`L.header.admin у модератора: ${hdr}`);
  });
  // админ на телефоне — пароль
  const AP = await (await browser.newContext({ ...ANDROID, defaultBrowserType: undefined })).newPage();
  await step('телефон админа: вход по паролю, M-15 с кабинетами, карта устройств', async () => {
    await AP.goto(`${WEB}/login`); await AP.waitForSelector(tid('S-05p.link.open'), { timeout: 20000 }); await AP.click(tid('S-05p.link.open'));
    await AP.fill(tid('S-05p.input.username'), 'recon_admin'); await AP.fill(tid('S-05p.input.password'), users.recon_admin.password); await AP.click(tid('S-05p.btn.submit'));
    await AP.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 20000 }); await sleep(700);
    ok('телефон админа: вход по паролю', new URL(AP.url()).pathname);
    await AP.click(tid('L.header.user')); await AP.waitForSelector(tid('M-15'), { timeout: 20000 });
    const cab = await AP.locator('[data-testid^="M-15.cabinet."]').evaluateAll((els) => els.map((e) => e.dataset.testid + ':' + e.innerText.trim()));
    if (cab.length === 3) ok('M-15 админа: три кабинета', JSON.stringify(cab)); else bad('M-15 админа: кабинеты', JSON.stringify(cab));
    await shot(AP, '04-phone-M15-admin'); await AP.keyboard.press('Escape');
    await AP.click(tid('L.header.admin')); await AP.waitForURL(/\/admin/, { timeout: 20000 }); ok('L.header.admin ведёт в /admin', new URL(AP.url()).pathname);
    await AP.goto(`${WEB}/admin/devices`); await AP.waitForSelector(tid('S-62.devices.user'), { timeout: 20000 }); await sleep(700); await sleep(500);
    await hscroll(AP, '/admin/devices 390');
    const cols = await AP.locator(tid('S-62.devices.user')).evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width)]; }));
    const lefts = new Set(cols.map((c) => c[0]));
    if (lefts.size === 1 && cols.every((c) => c[1] >= 300)) ok('карта устройств в одну колонку', JSON.stringify(cols.slice(0, 4))); else bad('карта устройств: колонки', JSON.stringify(cols));
    const sw = await AP.locator(tid('S-62.devices.session')).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
    note('ширины узлов сессий на 390: ' + JSON.stringify(sw));
    await shot(AP, '04-phone-admin-devices');
    await AP.screenshot({ path: path.join(SHOTS, '04-phone-admin-devices-full.png'), fullPage: true });
    for (const sec of ['', 'roles', 'policy', 'audit', 'network']) { await AP.goto(`${WEB}/admin/${sec}`); await AP.waitForSelector(tid('S-62.subnav'), { timeout: 20000 }); await sleep(700); await sleep(400); await hscroll(AP, `/admin/${sec || 'overview'} 390`); await shot(AP, `04-phone-admin-${sec || 'overview'}`); }
    await AP.goto(`${WEB}/deputy`); await AP.waitForSelector(tid('S-61.item'), { timeout: 20000 }); await sleep(700); await sleep(300); await hscroll(AP, '/deputy 390'); await shot(AP, '04-phone-deputy');
    await AP.goto(`${WEB}/moderator`); await AP.waitForSelector(tid('S-60.nav'), { timeout: 20000 }); await sleep(300); await hscroll(AP, '/moderator 390'); await shot(AP, '04-phone-moderator');
  });
  await step('телефон Android: S-82 и S-81 без системного диалога', async () => {
    await AP.goto(`${WEB}/settings`); await AP.waitForSelector(tid('S-82.nav'), { timeout: 20000 }); await sleep(300);
    for (const id of ['S-82.profile', 'S-82.item.app', 'S-82.item.devices', 'S-82.about']) await has(AP, id, `S-82: ${id}`);
    note('S-82.about: ' + (await AP.locator(tid('S-82.about')).innerText()).replace(/\s+/g, ' '));
    await shot(AP, '04-phone-S82');
    await AP.click(tid('S-82.item.app')); await AP.waitForSelector(tid('S-81.card.android'), { timeout: 20000 }); await sleep(300);
    note('S-81.status: ' + (await AP.locator(tid('S-81.status')).innerText()));
    const stepsOpen = await AP.locator(tid('S-81.steps.android')).count(); note(`Android без диалога: шаги раскрыты сразу = ${stepsOpen}`);
    const btnText = await AP.locator(tid('S-81.btn.android')).innerText(); note('S-81.btn.android: ' + btnText);
    await AP.click(tid('S-81.btn.android')); await sleep(300);
    const after = await AP.locator(tid('S-81.steps.android')).count(); note(`после клика шаги Android: ${after}`);
    await has(AP, 'S-81.card.ios', 'S-81.card.ios на Android'); await absent(AP, 'S-81.qr', 'S-81.qr на телефоне отсутствует'); await has(AP, 'S-81.hint');
    await hscroll(AP, 'S-81 390'); await shot(AP, '04-phone-S81-android-steps');
  });
  await step('телефон Android с beforeinstallprompt: системный диалог', async () => {
    const ctx = await browser.newContext({ ...ANDROID, defaultBrowserType: undefined });
    await ctx.addInitScript(() => {
      window.addEventListener('load', () => {
        const e = new Event('beforeinstallprompt', { cancelable: true });
        e.prompt = () => { window.__prompted = (window.__prompted || 0) + 1; return Promise.resolve(); };
        e.userChoice = Promise.resolve({ outcome: 'accepted' });
        window.dispatchEvent(e);
        window.__dispatched = true;
      });
    });
    const pg = await ctx.newPage();
    await pg.goto(`${WEB}/login`); await pg.waitForSelector(tid('S-05p.link.open'), { timeout: 20000 }); await pg.click(tid('S-05p.link.open'));
    await pg.fill(tid('S-05p.input.username'), 'recon_admin'); await pg.fill(tid('S-05p.input.password'), users.recon_admin.password); await pg.click(tid('S-05p.btn.submit'));
    await pg.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 20000 });
    await pg.goto(`${WEB}/settings/app`); await pg.waitForSelector(tid('S-81.card.android'), { timeout: 20000 }); await sleep(500);
    const btn = await pg.locator(tid('S-81.btn.android')).innerText(); note('кнопка при отложенном событии: ' + btn);
    const stepsBefore = await pg.locator(tid('S-81.steps.android')).count();
    await pg.click(tid('S-81.btn.android')); await sleep(500);
    const prompted = await pg.evaluate(() => window.__prompted);
    if (prompted === 1) ok('S-81.btn.android вызывает системный prompt()', `до клика шаги=${stepsBefore}`); else bad('S-81 prompt()', `prompted=${prompted}, dispatched=${await pg.evaluate(() => window.__dispatched)}`);
    note('после accepted: ' + (await pg.locator(tid('S-81.card.android')).innerText()).replace(/\s+/g, ' ').slice(0, 200));
    await shot(pg, '04-phone-S81-android-prompt'); await ctx.close();
  });
  await step('iPhone: S-81 ветка Safari', async () => {
    const ctx = await browser.newContext({ ...IPHONE }); const pg = await ctx.newPage();
    await pg.goto(`${WEB}/login`); await pg.waitForSelector(tid('S-05p.link.open'), { timeout: 20000 }); await pg.click(tid('S-05p.link.open'));
    await pg.fill(tid('S-05p.input.username'), 'recon_dep'); await pg.fill(tid('S-05p.input.password'), users.recon_dep.password); await pg.click(tid('S-05p.btn.submit'));
    await pg.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 20000 }); await sleep(700);
    note('iPhone завуча после входа паролем: ' + new URL(pg.url()).pathname);
    await pg.goto(`${WEB}/settings/app`); await pg.waitForSelector(tid('S-81.card.ios'), { timeout: 20000 }); await sleep(400);
    const iosOpen = await pg.locator(tid('S-81.steps.ios')).count(); note(`iPhone: шаги iOS раскрыты сразу = ${iosOpen}`);
    if (!iosOpen) { await pg.click(tid('S-81.btn.ios')); await sleep(300); }
    await has(pg, 'S-81.steps.ios', 'iPhone: S-81.steps.ios'); note('iOS шаги: ' + (await pg.locator(tid('S-81.steps.ios')).innerText()).replace(/\s+/g, ' '));
    const order = await pg.locator('[data-testid^="S-81.card."]').evaluateAll((els) => els.map((e) => e.dataset.testid)); note('порядок карточек на iPhone: ' + order.join(','));
    await hscroll(pg, 'iPhone S-81'); await shot(pg, '04-iphone-S81');
    await pg.goto(`${WEB}/deputy`); await pg.waitForSelector(tid('S-61.item'), { timeout: 20000 }); await sleep(300); await hscroll(pg, 'iPhone /deputy'); await shot(pg, '04-iphone-deputy');
    await ctx.close();
  });
  await step('десктоп: S-81 QR и S-82', async () => {
    await A.goto(`${WEB}/settings/app`); await A.waitForSelector(tid('S-81.card.android'), { timeout: 20000 }); await sleep(300);
    await has(A, 'S-81.qr', 'десктоп: S-81.qr'); await shot(A, '04-desktop-S81');
  });

  // ── 5. два устройства: скан QR со страницы входа ──
  let laptopToken = null; let phoneSessionId = null; let laptopSessionId = null;
  const L = await (await browser.newContext(desktop)).newPage();
  await step('ноутбук: /login показывает QR, токен привязки', async () => {
    const resP = L.waitForResponse((r) => r.url().includes('/auth/device-link/token') && r.request().method() === 'POST', { timeout: 20000 });
    await L.goto(`${WEB}/login`); const r = await resP; const j = await r.json(); laptopToken = j.token; note(`токен привязки id=${j.id}`);
    await L.waitForSelector(`${tid('S-01.qr')} svg`, { timeout: 20000 }); await sleep(300);
    await L.locator(tid('S-01.qr')).screenshot({ path: path.join(OUT, 'qr.png') });
    await shot(L, '05-laptop-login-qr');
    ok('ноутбук: S-01.qr отрисован');
  });
  let phoneBrowser = null; let PH = null;
  await step('телефон: скан QR камерой (поддельная камера с кадром QR)', async () => {
    execSync(`${FFMPEG} -y -loglevel error -loop 1 -i ${path.join(OUT, 'qr.png')} -t 4 -r 10 -vf "scale=420:420,pad=640:480:110:30:white,format=yuv420p" ${path.join(OUT, 'qr.y4m')}`);
    phoneBrowser = wrapBrowser(await chromium.launch({ executablePath: CHROME, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${path.join(OUT, 'qr.y4m')}`] }));
    const ctx = await phoneBrowser.newContext({ ...ANDROID, defaultBrowserType: undefined }); PH = await ctx.newPage();
    await PH.goto(`${WEB}/login`); await PH.waitForSelector(tid('S-05p.link.open'), { timeout: 20000 }); await PH.click(tid('S-05p.link.open'));
    await PH.fill(tid('S-05p.input.username'), 'recon_mod'); await PH.fill(tid('S-05p.input.password'), users.recon_mod.password); await PH.click(tid('S-05p.btn.submit'));
    await PH.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 20000 }); await sleep(700);
    const sess = await api(PH, 'GET', `${API}/api/v1/auth/sessions`); fs.writeFileSync(path.join(OUT, 'phone-sessions.json'), JSON.stringify(sess.body, null, 1));
    phoneSessionId = (sess.body?.sessions ?? sess.body)?.find?.((s) => s.current)?.id ?? null; note(`сессия телефона: ${phoneSessionId}`);
    await PH.goto(`${WEB}/settings/devices`); await PH.waitForSelector(tid('S-80.btn.linkDevice'), { timeout: 20000 }); await shot(PH, '05-phone-S80');
    await PH.click(tid('S-80.btn.linkDevice')); await PH.waitForSelector(`${tid('S-80.viewfinder')}, ${tid('S-80.error.denied')}`, { timeout: 20000 });
    await sleep(1500); await shot(PH, '05-phone-viewfinder');
    let scanned = false;
    try { await PH.waitForSelector(tid('S-80.confirm'), { timeout: 25000 }); scanned = true; ok('телефон: QR распознан камерой — S-80.confirm'); } catch { bad('телефон: камера не распознала QR за 25 с (поддельная камера)', 'fallback: /link/<token>'); }
    if (!scanned) { await PH.goto(`${WEB}/link/${laptopToken}`); await PH.waitForSelector(tid('S-80.confirm'), { timeout: 20000 }); note('подтверждение через маршрут /link/:token'); }
    await shot(PH, '05-phone-confirm');
    await PH.locator(`${tid('S-80.confirm')} button`, { hasText: 'Подключить' }).first().click();
    await L.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 30000 }); await sleep(700);
    ok('ноутбук получил сессию после подтверждения', new URL(L.url()).pathname); await shot(L, '05-laptop-after-scan'); await sleep(500); await shot(PH, '05-phone-after-approve');
    const ls = await api(L, 'GET', `${API}/api/v1/auth/sessions`); laptopSessionId = (ls.body?.sessions ?? ls.body)?.find?.((s) => s.current)?.id ?? null; note(`сессия ноутбука: ${laptopSessionId}`);
  });
  const modId = staffList?.find?.((s) => s.username === 'recon_mod')?.userId ?? null;
  await step('карта администратора: ноутбук вложен под телефон', async () => {
    const map = await api(A, 'GET', `${API}/api/v1/admin/devices`); fs.writeFileSync(path.join(OUT, 'admin-devices.json'), JSON.stringify(map.body, null, 1));
    const mod = (map.body?.users ?? []).find((u) => u.username === 'recon_mod' || /Иванова/.test(u.fullName ?? u.displayName ?? ''));
    const sessions = mod?.sessions ?? [];
    for (const s of sessions) note(`  ${s.id.slice(0, 8)} via=${s.via} client=${s.clientKind} parent=${s.parentSessionId?.slice(0, 8) ?? '—'} status=${s.status} ip=${s.ip} new=${s.newNetwork} device=${s.deviceHint ?? s.device}`);
    const lap = sessions.find((s) => s.id === laptopSessionId);
    if (lap && lap.parentSessionId === phoneSessionId && lap.via === 'device_link') ok('API: сессия ноутбука via=device_link, parent = сессия телефона'); else bad('API: родительская сессия ноутбука', JSON.stringify(lap));
    const direct = sessions.filter((s) => s.id !== laptopSessionId && s.status === 'live').every((s) => !s.parentSessionId);
    if (direct) ok('API: прямые входы без родителя'); else bad('API: прямые входы', 'есть parentSessionId');
    await A.goto(`${WEB}/admin/devices`); await A.waitForSelector(tid('S-62.devices.search'), { timeout: 20000 }); await A.fill(tid('S-62.devices.search'), 'recon_mod'); await sleep(500);
    const dom = await A.evaluate((lid) => {
      const n = document.querySelector(`[data-testid="S-62.devices.session"][data-parent]`);
      const lapNode = [...document.querySelectorAll('[data-testid="S-62.devices.session"]')].find((e) => e.dataset.parent);
      if (!lapNode) return { found: false };
      const parentUl = lapNode.closest('ul'); const outer = parentUl?.parentElement?.closest('li');
      const parentNode = outer?.querySelector('[data-testid="S-62.devices.session"]');
      return { found: true, nested: Boolean(outer), parentDataId: parentNode?.dataset.id ?? parentNode?.getAttribute('data-session') ?? null, parentText: parentNode?.innerText.replace(/\s+/g, ' ').slice(0, 100), childText: lapNode.innerText.replace(/\s+/g, ' ').slice(0, 100), depth: (() => { let d = 0; let e = lapNode; while ((e = e.parentElement) && e !== document.body) if (e.matches('ul.sch-adm-tree')) d++; return d; })() };
    }, laptopSessionId);
    if (dom.found && dom.nested && dom.depth >= 2) ok('DOM: узел ноутбука вложен под узел телефона', JSON.stringify(dom)); else bad('DOM: вложенность', JSON.stringify(dom));
    const usersShown = await A.locator(tid('S-62.devices.user')).count(); note(`фильтр «recon_mod»: людей на карте ${usersShown}`);
    await shot(A, '05-admin-map-nested');
    await A.fill(tid('S-62.devices.search'), '');
  });

  // ── 5. лимит сессий 1 для модератора ──
  await step('лимит сессий 1 для роли модератора → второй вход гасит самую давнюю', async () => {
    await A.goto(`${WEB}/admin/policy`); await A.waitForSelector('#limit-moderator', { timeout: 20000 });
    await A.selectOption('#limit-moderator', '1'); await A.click(tid('S-62.policy.btn.save')); await sleep(1000);
    const pol = await api(A, 'GET', `${API}/api/v1/admin/policy`); note('политика: ' + JSON.stringify(pol.body?.sessionLimits));
    if (pol.body?.sessionLimits?.moderator === 1) ok('лимит модератора = 1 сохранён'); else bad('лимит не сохранён', JSON.stringify(pol.body));
    await shot(A, '05-admin-policy-limit');
    const before = await api(A, 'GET', `${API}/api/v1/admin/connections?userId=${modId}`);
    const liveBefore = (before.body?.sessions ?? before.body ?? []).filter((s) => s.status === 'live').length; note(`живых сессий модератора до входа: ${liveBefore}`);
    const N = await (await browser.newContext(desktop)).newPage();
    const lr = await api(await N.goto(`${WEB}/login`).then(() => N), 'POST', `${API}/api/v1/auth/login`, { username: 'recon_mod', password: users.recon_mod.password });
    if (lr.status === 201 || lr.status === 200) ok('новый вход модератора не отклонён', JSON.stringify(lr.body)); else bad('новый вход модератора', `${lr.status} ${JSON.stringify(lr.body)}`);
    await sleep(800);
    const after = await api(A, 'GET', `${API}/api/v1/admin/connections?userId=${modId}`); fs.writeFileSync(path.join(OUT, 'mod-connections-after-limit.json'), JSON.stringify(after.body, null, 1));
    const list = after.body?.sessions ?? after.body ?? [];
    const live = list.filter((s) => s.status === 'live'); const limited = list.filter((s) => s.revokedReason === 'limit');
    if (live.length === 1) ok('после входа живая сессия одна'); else bad('живых сессий после лимита', String(live.length));
    if (limited.length === liveBefore) ok(`погашено с причиной limit: ${limited.length}`); else bad('причина limit', `${limited.length} из ${liveBefore}`);
    // старая сессия B: что видит человек
    const meB = await api(B, 'GET', `${API}/api/v1/me`); note(`старая сессия модератора (B): /me → ${meB.status} ${meB.body?.code ?? ''}`);
    await B.reload(); await sleep(700); await sleep(1000); note('экран B после потери сессии: ' + new URL(B.url()).pathname + ' · ' + (await B.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 160)); await shot(B, '05-mod-after-limit');
    // журнал M-29
    await A.goto(`${WEB}/admin/devices`); await A.waitForSelector(tid('S-62.devices.search'), { timeout: 20000 }); await A.fill(tid('S-62.devices.search'), 'recon_mod'); await sleep(400);
    await A.locator(tid('S-62.devices.btn.journal')).first().click(); await A.waitForSelector(tid('M-29.list'), { timeout: 20000 }); await sleep(300);
    const jt = await A.locator(tid('M-29.list')).innerText(); const cnt = (jt.match(/лимит сессий/g) ?? []).length;
    if (cnt >= 1) ok(`M-29: «лимит сессий» в журнале ${cnt} раз`); else bad('M-29: причина «лимит сессий»', jt.replace(/\s+/g, ' ').slice(0, 300));
    await shot(A, '05-admin-M29-limit'); await A.keyboard.press('Escape');
    await A.goto(`${WEB}/admin/policy`); await A.waitForSelector('#limit-moderator'); await A.selectOption('#limit-moderator', ''); await A.click(tid('S-62.policy.btn.save')); await sleep(800);
  });

  // ── 3. адресное завершение чужой сессии (завуч D) ──
  await step('админ завершает сессию завуча (причина admin)', async () => {
    const depId = staffList?.find?.((s) => s.username === 'recon_dep')?.userId;
    await A.goto(`${WEB}/admin/devices`); await A.waitForSelector(tid('S-62.devices.search'), { timeout: 20000 }); await A.fill(tid('S-62.devices.search'), 'recon_dep'); await sleep(400);
    const n = await A.locator(tid('S-62.devices.btn.revoke')).count(); note(`кнопок «Завершить» у завуча: ${n}`);
    await A.locator(tid('S-62.devices.btn.revoke')).first().click(); await sleep(500);
    if (await A.locator(tid('M-13')).count()) { note('подтверждение M-13'); await A.locator(`${tid('M-13')} button`, { hasText: /Завершить|Подтвердить|Да/ }).first().click(); }
    await sleep(800); await shot(A, '03-admin-revoke-one');
    const conn = await api(A, 'GET', `${API}/api/v1/admin/connections?userId=${depId}`); const list = conn.body?.sessions ?? conn.body ?? [];
    const adm = list.filter((s) => s.revokedReason === 'admin'); if (adm.length === 1) ok('одна сессия завуча погашена с причиной admin'); else bad('причина admin', JSON.stringify(list.map((s) => [s.id.slice(0, 6), s.status, s.revokedReason])));
    const dead = adm[0]?.id; const victim = dead === laptopSessionId ? null : [C, D];
    for (const pg of [C, D]) { const r = await api(pg, 'GET', `${API}/api/v1/me`); note(`сессия завуча ${pg === C ? 'C' : 'D'}: /me → ${r.status} ${r.body?.code ?? ''}`); }
    const revokedPage = (await api(C, 'GET', `${API}/api/v1/me`)).status !== 200 ? C : D;
    await revokedPage.goto(`${WEB}/deputy`); await sleep(700); await sleep(1000);
    note('экран отозванной сессии: ' + new URL(revokedPage.url()).pathname + ' · ' + (await revokedPage.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 160)); await shot(revokedPage, '03-dep-after-revoke');
    const again = await api(A, 'POST', `${API}/api/v1/admin/sessions/${dead}/revoke`); if (again.status >= 400) ok('повторный отзыв отклонён', `${again.status} ${again.body?.code}`); else bad('повторный отзыв', String(again.status));
  });

  // ── 3. инцидент-режим ──
  await step('инцидент-режим', async () => {
    await A.goto(`${WEB}/admin/policy`); await A.waitForSelector(tid('S-62.policy.btn.incident'), { timeout: 20000 }); await sleep(300);
    note('карточка инцидента до: ' + (await A.locator(tid('S-62.policy.incident')).innerText()).replace(/\s+/g, ' ').slice(0, 200));
    const ov = await api(A, 'GET', `${API}/api/v1/admin/overview`); note('overview: ' + JSON.stringify(ov.body).slice(0, 300));
    await A.click(tid('S-62.policy.btn.incident')); await A.waitForSelector(tid('M-28.text'), { timeout: 20000 });
    const t = await A.locator(tid('M-28.text')).innerText(); note('M-28.text: ' + t.replace(/\s+/g, ' ')); await shot(A, '03-admin-M28');
    await A.click(tid('M-28.btn.confirm')); await sleep(1500); await shot(A, '03-admin-incident-result');
    note('карточка инцидента после: ' + (await A.locator(tid('S-62.policy.incident')).innerText()).replace(/\s+/g, ' ').slice(0, 300));
    const meA = await api(A, 'GET', `${API}/api/v1/me`); if (meA.status === 200) ok('сессия администратора жива после инцидента'); else bad('сессия администратора', String(meA.status));
    for (const [pg, n] of [[P, 'телефон модератора (код)'], [AP, 'телефон админа (пароль)'], [L, 'ноутбук (скан)'], [PH, 'телефон-сканер']]) { if (!pg) continue; const r = await api(pg, 'GET', `${API}/api/v1/me`); if (r.status !== 200) ok(`${n}: сессия закрыта инцидентом`, `${r.status} ${r.body?.code ?? ''}`); else bad(`${n}: сессия ЖИВА после инцидента`); }
    const pol = await api(A, 'GET', `${API}/api/v1/admin/policy`); if (pol.body?.incidentAt) ok('политика хранит incidentAt/incidentBy', `${pol.body.incidentAt} ${pol.body.incidentBy ?? ''}`); else bad('incidentAt', JSON.stringify(pol.body));
    const conn = await api(A, 'GET', `${API}/api/v1/admin/connections?userId=${modId}`); const inc = (conn.body?.sessions ?? conn.body ?? []).filter((s) => s.revokedReason === 'incident').length; note(`сессий модератора с причиной incident: ${inc}`);
    await AP.reload().catch(() => {}); await sleep(700).catch(() => {}); await sleep(1000); note('телефон админа после инцидента: ' + new URL(AP.url()).pathname); await shot(AP, '03-phone-after-incident');
  });
  await step('аудит после сценария', async () => {
    const au = await api(A, 'GET', `${API}/api/v1/admin/audit`); fs.writeFileSync(path.join(OUT, 'audit.json'), JSON.stringify(au.body, null, 1));
    const entries = au.body?.entries ?? au.body?.items ?? au.body ?? [];
    const types = {}; for (const e of entries) { const k = e.action ?? e.type ?? e.event; types[k] = (types[k] ?? 0) + 1; }
    note('аудит: ' + JSON.stringify(types));
    for (const k of ['staff.login_link.issued.v1', 'school.policy.set.v1', 'staff.session.revoked.v1']) if (Object.keys(types).some((t) => t.includes(k) || t.includes(k.replace('.v1', '')))) ok(`аудит содержит ${k}`); else bad(`аудит: нет ${k}`, Object.keys(types).join(','));
    const hasIp = JSON.stringify(au.body).includes('"ip"'); if (!hasIp) ok('в аудите нет поля ip (AR-194)'); else bad('в аудите есть ip');
    await A.goto(`${WEB}/admin/audit`); await A.waitForSelector(tid('S-62.audit'), { timeout: 20000 }); await sleep(400); await shot(A, '03-admin-audit-final');
  });
  if (consoleErrors.length) bad('ошибки страницы (pageerror)', consoleErrors.slice(0, 5).join(' | ')); else ok('pageerror на десктопных контекстах: нет');
  await browser.close(); if (phoneBrowser) await phoneBrowser.close();
  fs.writeFileSync(path.join(OUT, 'stand-results.json'), JSON.stringify(results, null, 1));
  const fails = results.filter((r) => r.ok === false).length;
  log(`\nИтог: проверок ${results.filter((r) => 'ok' in r).length}, нарушений ${fails}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
