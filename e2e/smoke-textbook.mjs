/**
 * Живой Chromium-смок сквозного потока «учебник → КТП → КПП → содержание уроков»:
 *   owner (pilot) создаёт учителя/завуча + класс/дисциплину и назначает →
 *   учитель входит по QR-токену → методкопилка (контекст из назначения, БЕЗ ручного
 *   выбора класса) → загрузка НАСТОЯЩЕГО PDF → doc.file.enriched (экстракция) →
 *   textbook.parsed → черновик КТП (часы = оценка по картам, бейдж «оценка парсера») →
 *   завуч утверждает КТП → Solver собирает КПП → завуч утверждает КПП →
 *   карточки разложены по урокам → учитель видит их в расписании.
 * Скриншот каждого шага — e2e/screenshots/.
 *
 * Запуск: node e2e/smoke-textbook.mjs   (нужен Postgres; API/web поднимает сам)
 * Env: SMOKE_DATABASE_URL (дефолт postgresql://edustore:edustore@localhost:5432/edustore_smoke),
 *      CHROMIUM_PATH (кастомный бинарь Chromium, иначе браузер Playwright).
 */
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const DB = process.env.SMOKE_DATABASE_URL ?? 'postgresql://edustore:edustore@localhost:5432/edustore_smoke?schema=public';
const OWNER_KEY = process.env.PILOT_OWNER_KEY ?? 'smoke-owner-key';
const SHOTS = path.join(ROOT, 'e2e', 'screenshots');
const STORAGE_DIR = path.join(ROOT, 'e2e', '.smoke-storage');

const children = [];
const kill = () => children.forEach((c) => { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* */ } });
process.on('exit', kill);

const sh = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
const shOut = (cmd, opts = {}) => execSync(cmd, { cwd: ROOT, encoding: 'utf8', ...opts });
const spawnBg = (cmd, args, opts) => {
  const c = spawn(cmd, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  c.stdout.on('data', (d) => process.env.SMOKE_VERBOSE && process.stdout.write(d));
  c.stderr.on('data', (d) => process.stdout.write(d));
  children.push(c);
  return c;
};

/**
 * Порт занят чужим процессом — не «сервер готов», а проверка не того сервера:
 * `waitHttp` принимает любой ответ, и осиротевший процесс прошлого прогона молча
 * подменяет предмет ворот. Падаем сразу и по имени.
 */
async function assertPortFree(url) {
  try { await fetch(url, { signal: AbortSignal.timeout(2000) }); }
  catch { return; }
  console.error(`порт занят: по ${url} уже кто-то отвечает. Смок поднимает свои API и веб — снимите чужой процесс`);
  process.exit(1);
}

async function waitHttp(url, timeoutMs = 120_000) {
  const t0 = Date.now();
  for (;;) {
    try {
      await fetch(url);
      return; // любой HTTP-ответ = процесс жив (403/404 тоже ок)
    } catch {
      if (Date.now() - t0 > timeoutMs) throw new Error(`не дождались ${url}`);
      await new Promise((r) => setTimeout(r, 700));
    }
  }
}

let stepNo = 0;
const shot = async (page, name) => {
  stepNo++;
  const file = path.join(SHOTS, `${String(stepNo).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  📸 ${path.basename(file)}`);
};

const ownerApi = async (method, p, body) => {
  const r = await fetch(`${API}/api/pilot/${p}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-pilot-owner-key': OWNER_KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`pilot ${method} ${p} → ${r.status}: ${await r.text()}`);
  return r.json();
};

// Учебник: 2 главы — 7 и 3 параграфа → оценка часов ceil(7/5)=2 и ceil(3/5)=1 (N=5)
const TEXTBOOK_LINES = [
  'Глава 1. Векторы',
  ...Array.from({ length: 7 }, (_, i) => [`§ ${i + 1}. Параграф ${i + 1}`, `Учебный текст параграфа ${i + 1}: определения, примеры и задачи.`]).flat(),
  'Глава 2. Метод координат',
  ...Array.from({ length: 3 }, (_, i) => [`§ ${i + 8}. Параграф ${i + 8}`, `Учебный текст параграфа ${i + 8}: координаты и вычисления.`]).flat(),
];

async function main() {
  fs.rmSync(SHOTS, { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.rmSync(STORAGE_DIR, { recursive: true, force: true });

  // ── инфраструктура: миграции → API (pilot-qr + local storage) → web (PROD-сборка: /me-гейт) ──
  // ── чистая база: смок наливает свои данные и на своих же остатках падает ──
  // Раньше база только мигрировалась: второй прогон подряд заставал приглашения,
  // назначения и структуру прошлого — и `cabinet-state` отвечал по чужим строкам.
  // Ворота, зелёные ровно один раз, не ворота (диагностика этапа 2, Д10).
  const u = new URL(DB);
  const dbName = u.pathname.replace(/^\//, '');
  const admin = `${u.protocol}//${u.username}:${u.password}@${u.host}/postgres`;
  console.log(`▶ пересоздание базы ${dbName}`);
  const psql = (sql, url) => shOut(`psql "${url}" -v ON_ERROR_STOP=1 -c ${JSON.stringify(sql)}`);
  try {
    psql(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`, admin);
    psql(`CREATE DATABASE "${dbName}"`, admin);
  } catch (e) {
    console.error('не удалось пересоздать базу:', e.message);
    process.exit(1);
  }

  console.log('▶ prisma migrate deploy');
  sh('npx prisma migrate deploy', { cwd: path.join(ROOT, 'apps/api'), env: { ...process.env, DATABASE_URL: DB } });
  // Собираем ВСЕГДА: условная сборка тихо гоняла ворота по прошлому dist.
  console.log('▶ build api');
  sh('npm run build', { cwd: path.join(ROOT, 'apps/api') });
  console.log('▶ build web');
  sh('npm run build', { cwd: path.join(ROOT, 'apps/web') });
  await assertPortFree(`${API}/api/v1/edu/ktp`);
  await assertPortFree(WEB);

  console.log('▶ старт api + web');
  spawnBg('node', ['dist/main.js'], {
    cwd: path.join(ROOT, 'apps/api'),
    env: {
      ...process.env,
      DATABASE_URL: DB,
      PORT: '3000',
      AUTH_MODE: 'pilot-qr',
      PILOT_OWNER_KEY: OWNER_KEY,
      STORAGE_MODE: 'local',
      LOCAL_STORAGE_DIR: STORAGE_DIR,
      WEB_ORIGIN: WEB,
    },
  });
  spawnBg('npx', ['vite', 'preview', '--port', '5173', '--strictPort'], { cwd: path.join(ROOT, 'apps/web') });
  await waitHttp(`${API}/api/v1/edu/ktp`);
  await waitHttp(WEB);

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });

  try {
    // ── owner: структура + приглашения (API), доска owner — в браузере ──
    console.log('▶ owner: класс, дисциплина, приглашения');
    const subject = await ownerApi('POST', 'owner/subjects', { name: 'Математика' });
    const klass = await ownerApi('POST', 'owner/classes', { parallel: 6, letter: 'А' });
    const teacherInvite = await ownerApi('POST', 'owner/staff', { role: 'teacher', displayName: 'Анна Смок' });
    const zavuchInvite = await ownerApi('POST', 'owner/staff', { role: 'zavuch', displayName: 'Вера Завуч' });

    const ownerPage = await ctx.newPage();
    await ownerPage.goto(`${WEB}/?pilot=owner`);
    await ownerPage.fill('input.pilot-input', OWNER_KEY);
    await ownerPage.click('button.pilot-btn');
    await ownerPage.getByText('Анна Смок').first().waitFor({ timeout: 15_000 });
    await shot(ownerPage, 'owner-board');

    // ── учитель: QR-вход → «подготавливаем рабочее место» ──
    console.log('▶ учитель: QR-вход');
    const teacherPage = await ctx.newPage();
    await teacherPage.goto(`${WEB}/?pilot=login&token=${teacherInvite.token}`);
    await teacherPage.fill('input.pilot-input', '+7 999 111-22-33');
    await teacherPage.getByRole('button', { name: 'Войти' }).click();
    await teacherPage.waitForTimeout(1500);
    await shot(teacherPage, 'teacher-preparing');

    // ── owner назначает учителя и завуча на 6А·Математика (TeachingAssignment) ──
    console.log('▶ owner: назначение на класс+дисциплину');
    const staff = await ownerApi('GET', 'owner/staff');
    const teacherId = staff.find((s) => s.displayName === 'Анна Смок').userId;
    await ownerApi('POST', 'owner/assign', { userId: teacherId, classId: klass.id, subjectId: subject.id });

    // учитель дожидается «ready» и попадает в кабинет
    await teacherPage.waitForSelector('.rs-item', { timeout: 40_000 });
    await shot(teacherPage, 'teacher-cabinet');

    // ── методкопилка: контекст из назначения, без ручного выбора класса ──
    console.log('▶ методкопилка: контекст и загрузка PDF');
    await teacherPage.getByRole('button', { name: 'Материалы' }).click();
    const ctxLine = teacherPage.getByTestId('upload-context');
    await ctxLine.waitFor({ timeout: 15_000 });
    const ctxText = await ctxLine.innerText();
    if (!/Загрузка учебника для\s*6А, математика/.test(ctxText.replace(/\s+/g, ' '))) {
      throw new Error(`контекст загрузки неверный: «${ctxText}»`);
    }
    await shot(teacherPage, 'materials-context');

    // настоящий PDF печатаем самим Chromium (текстовый слой → pdf-parse в enrich)
    const pdfPage = await ctx.newPage();
    await pdfPage.setContent(
      `<html><body style="font-family:serif;font-size:14px">${TEXTBOOK_LINES.map((l) => `<p>${l}</p>`).join('')}</body></html>`,
    );
    const pdfPath = path.join(SHOTS, '..', '.textbook-smoke.pdf');
    await pdfPage.pdf({ path: pdfPath, format: 'A4' });
    await pdfPage.close();

    await teacherPage.setInputFiles('input[type=file]', pdfPath);
    await teacherPage.getByText('Глава 1. Векторы').first().waitFor({ timeout: 60_000 });
    await teacherPage.locator('.mt-topic > button').first().click(); // раскрыть карты темы
    await teacherPage.waitForSelector('.mt-cardrow');
    await shot(teacherPage, 'materials-parsed');

    // ── завуч: черновик КТП с пометкой «оценка парсера», утверждение → Solver → КПП ──
    console.log('▶ завуч: черновик КТП → утверждение → КПП');
    const zavuchPage = await ctx.newPage();
    await zavuchPage.goto(`${WEB}/?pilot=login&token=${zavuchInvite.token}`);
    await zavuchPage.fill('input.pilot-input', '+7 999 444-55-66');
    await zavuchPage.getByRole('button', { name: 'Войти' }).click();
    // завучу назначение не обязательно для работы, но гейт «preparing» пилота считает по нему;
    // ждём, пока вход реально завершится (у инвайта появится userId)
    let zavuchId = null;
    for (let i = 0; i < 40 && !zavuchId; i++) {
      zavuchId = (await ownerApi('GET', 'owner/staff')).find((s) => s.displayName === 'Вера Завуч')?.userId ?? null;
      if (!zavuchId) await new Promise((r) => setTimeout(r, 500));
    }
    if (!zavuchId) throw new Error('вход завуча не завершился (userId не появился)');
    await ownerApi('POST', 'owner/assign', { userId: zavuchId, classId: klass.id, subjectId: subject.id });
    await zavuchPage.waitForSelector('.adm-nav__item', { timeout: 40_000 });
    await zavuchPage.getByRole('navigation').getByRole('button', { name: 'КТП и КПП' }).click();
    await zavuchPage.getByText('черновик').first().waitFor({ timeout: 15_000 });
    await zavuchPage.getByText('6А · Математика').first().click(); // раскрыть темы
    await zavuchPage.getByTestId('ktp-topics').waitFor();
    await zavuchPage.getByText('оценка парсера').first().waitFor(); // пометка hoursSource=estimated
    await shot(zavuchPage, 'zavuch-ktp-draft-estimated');

    await zavuchPage.getByRole('button', { name: 'Утвердить', exact: true }).click();
    await zavuchPage.getByText('Solver собрал КПП').waitFor({ timeout: 30_000 });
    await shot(zavuchPage, 'zavuch-ktp-approved-kpp-scheduled');

    await zavuchPage.getByRole('button', { name: 'Утвердить КПП' }).click();
    await zavuchPage.getByText('уроки разблокированы').waitFor({ timeout: 30_000 });
    await shot(zavuchPage, 'zavuch-kpp-approved');

    // ── учитель: расписание с уроками, внутри урока — карточки из парсера ──
    console.log('▶ учитель: расписание и содержание урока');
    await teacherPage.getByRole('button', { name: 'Расписание' }).click();
    await teacherPage.waitForSelector('[data-testid=sch-lesson]', { timeout: 20_000 });
    const lessonCount = await teacherPage.locator('[data-testid=sch-lesson]').count();
    if (lessonCount !== 3) throw new Error(`ожидали 3 урока (2ч+1ч), в расписании ${lessonCount}`);
    await teacherPage.locator('[data-testid=sch-lesson]').first().click();
    await teacherPage.waitForSelector('[data-testid=lesson-card]', { timeout: 20_000 });
    const cardCount = await teacherPage.locator('[data-testid=lesson-card]').count();
    if (cardCount !== 4) throw new Error(`в первом уроке ожидали 4 карточки (⌊7/2⌋+1), получили ${cardCount}`);
    await shot(teacherPage, 'teacher-schedule-lesson-cards');

    console.log(`\n✓ СМОК OK — ${stepNo} скриншотов в e2e/screenshots/`);
  } finally {
    await browser.close();
    kill();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('\n✗ СМОК УПАЛ:', e);
    process.exit(1);
  },
);
