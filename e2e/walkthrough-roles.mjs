/**
 * ОБХОД РАБОЧЕГО ДНЯ — разведка, а не ворота.
 *
 * Ворота проверяют «стоит ли на экране элемент, объявленный реестром». Это
 * доказало 153 элемента и не поймало, что в журнале нет ни четвертей, ни
 * календаря недели — потому что реестр их и не называл. Дыра была в спеке,
 * ворота честно доказали спеку, а спека описывала не тот экран.
 *
 * Этот скрипт спрашивает другое: **что человек в этой роли делает каждый день
 * и может ли он это здесь сделать**. Он НЕ падает от отсутствия элемента — он
 * записывает, чего нет, и снимает экран. Падение здесь было бы вредно:
 * находки нужны все сразу, а не первая.
 *
 * Школа заводится приближённой к настоящей: не 2 класса по 4 ученика, а
 * параллель с литерами и несколько предметов у одного педагога.
 *
 * Запуск: node e2e/walkthrough-roles.mjs   (нужен Postgres; API/web поднимает сам)
 */
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const DB = process.env.WALK_DATABASE_URL ?? 'postgresql://edustore:edustore@localhost:5432/edustore_walk?schema=public';
const SHOTS = path.join(ROOT, 'e2e', 'screenshots-walkthrough');
const SCHOOL_DAY = process.env.WALK_SCHOOL_DAY ?? '2026-09-14';
const GEN_SEED = process.env.WALK_GEN_SEED ?? '20260915';
const PHONE = '+79990002233';

const { recommendedTerms } = createRequire(import.meta.url)(path.join(ROOT, 'packages/shared/dist/schoolium.js'));

const children = [];
process.on('exit', () => children.forEach((c) => { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* */ } }));
const sh = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
const shOut = (cmd, opts = {}) => execSync(cmd, { cwd: ROOT, encoding: 'utf8', ...opts });
const spawnBg = (cmd, args, opts) => {
  const c = spawn(cmd, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  c.stdout.on('data', (d) => process.env.WALK_VERBOSE && process.stdout.write(d));
  c.stderr.on('data', (d) => process.env.WALK_VERBOSE && process.stdout.write(d));
  children.push(c);
  return c;
};
const waitHttp = async (url, timeoutMs = 120_000) => {
  const t0 = Date.now();
  for (;;) {
    try { await fetch(url); return; }
    catch { if (Date.now() - t0 > timeoutMs) throw new Error(`не дождались ${url}`); await new Promise((r) => setTimeout(r, 700)); }
  }
};

// ─────────────────────────── журнал находок ───────────────────────────

const findings = [];
let shotNo = 0;

/** Может ли человек сделать это здесь. Не падает — записывает. */
const can = async (page, who, task, selector) => {
  const n = await page.locator(selector).count();
  if (n > 0) { console.log(`    ✅ ${who}: ${task}`); return true; }
  console.log(`    ❌ ${who}: ${task} — НЕЧЕМ (${selector})`);
  findings.push({ who, task, selector });
  return false;
};

/** Наблюдение без вердикта: цифра или текст, который надо посмотреть глазами. */
const note = (text) => console.log(`    · ${text}`);

/**
 * Мягкое ожидание. Обход не имеет права падать от того, что экрана нет: это
 * и есть его находка, а падение оставило бы все остальные ненайденными.
 */
const settle = async (page, selector, ms = 15_000) => {
  try { await page.waitForSelector(selector, { timeout: ms }); return true; }
  catch { return false; }
};

const shot = async (page, name) => {
  shotNo += 1;
  const file = path.join(SHOTS, `${String(shotNo).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  📸 ${path.basename(file)}`);
};

// ─────────────────────────── подготовка школы ───────────────────────────

async function main() {
  fs.rmSync(SHOTS, { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });

  const u = new URL(DB);
  const dbName = u.pathname.replace(/^\//, '');
  const admin = `${u.protocol}//${u.username}:${u.password}@${u.host}/postgres`;
  const psql = (sql, url) => shOut(`psql "${url}" -v ON_ERROR_STOP=1 -c ${JSON.stringify(sql)}`);
  console.log(`▶ база ${dbName}`);
  psql(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`, admin);
  psql(`CREATE DATABASE "${dbName}"`, admin);
  sh('npx prisma migrate deploy', { cwd: path.join(ROOT, 'apps/api'), env: { ...process.env, DATABASE_URL: DB } });
  sh('npm run build', { cwd: path.join(ROOT, 'apps/api') });
  sh('npm run build', { cwd: path.join(ROOT, 'apps/web') });

  console.log('▶ bootstrap школы');
  const out = shOut(
    `npx ts-node scripts/school-bootstrap.ts --phone=${PHONE} --school="Гимназия №7" --name="Петрова Анна Сергеевна"`,
    { cwd: path.join(ROOT, 'apps/api'), env: { ...process.env, DATABASE_URL: DB, WEB_ORIGIN: WEB } },
  );
  const link = (out.match(/https?:\/\/\S*\/bootstrap\/[a-f0-9]+/) ?? [])[0];
  if (!link) { console.error('bootstrap не напечатал ссылку'); process.exit(1); }

  spawnBg('node', ['dist/main.js'], {
    cwd: path.join(ROOT, 'apps/api'),
    env: { ...process.env, DATABASE_URL: DB, PORT: '3000', AUTH_MODE: 'production', WEB_ORIGIN: WEB, SCHOOL_TODAY: SCHOOL_DAY, GEN_SEED },
  });
  spawnBg('npx', ['vite', 'preview', '--port', '5173', '--strictPort'], { cwd: path.join(ROOT, 'apps/web') });
  await waitHttp(`${API}/api/v1/me`);
  await waitHttp(WEB);

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
  const mod = await ctx.newPage();
  const api = async (page, method, p, body) => {
    const r = await page.request.fetch(`${API}${p}`, { method, data: body ?? undefined });
    if (!r.ok()) throw new Error(`${method} ${p} → ${r.status()}: ${await r.text()}`);
    return r.json();
  };

  try {
    // ── школа приближённого размера ──
    console.log('\n▶ наполнение: параллель 5-х с литерами А/Б, 3 предмета, 2 педагога');
    await mod.goto(link);
    await mod.waitForSelector('[data-testid="S-10.empty"], [data-testid="S-10.grid.classes"]', { timeout: 30_000 });

    await api(mod, 'POST', '/api/v1/classes/bulk', {
      parallels: 5, letters: ['А', 'Б'], studentsPerClass: 25, groups: null, sexKind: 'boys', sexCount: 13, version: 0,
    });
    const classes = (await api(mod, 'GET', '/api/v1/classes')).classes;
    note(`классов создано: ${classes.length}`);

    // Профили — как в жизни: заполняет секретарь, и не все сразу.
    const target = classes.filter((c) => c.label === '5А' || c.label === '5Б');
    for (const c of target) {
      const roster = await api(mod, 'GET', `/api/v1/classes/${c.id}/students`);
      for (let i = 0; i < roster.length; i += 1) {
        await api(mod, 'PUT', `/api/v1/students/${roster[i].id}`, {
          lastName: FAMILIES[i % FAMILIES.length], firstName: NAMES[i % NAMES.length], sex: i % 2 ? 'f' : 'm',
        });
      }
    }
    note(`профили заполнены в ${target.length} классах по 25 учеников`);

    const subjects = [];
    for (const c of target) {
      for (const name of ['Математика', 'Русский язык', 'История']) {
        subjects.push(await api(mod, 'POST', '/api/v1/subjects', { name, classId: c.id }));
      }
    }
    note(`предметов заведено: ${subjects.length}`);

    // Два педагога: у одного два предмета в двух классах — обычная нагрузка.
    const teachers = [];
    for (const who of ['Смирнова Ольга Ивановна', 'Кузнецов Игорь Петрович']) {
      const card = await api(mod, 'POST', '/api/v1/staff/cards', { role: 'teacher' });
      const act = await api(mod, 'POST', `/api/v1/staff/${card.id}/activation-token`, {});
      const tctx = await browser.newContext({ locale: 'ru-RU' });
      const tp = await tctx.newPage();
      await tp.goto(`${WEB}/join/${act.token}`);
      await tp.waitForSelector('[data-testid="S-03.input.lastName"]');
      const [ln, fn, mn] = who.split(' ');
      await tp.locator('[data-testid="S-03.input.lastName"]').fill(ln);
      await tp.locator('[data-testid="S-03.input.firstName"]').fill(fn);
      await tp.locator('[data-testid="S-03.input.middleName"]').fill(mn);
      await tp.locator('[data-testid="S-03.input.phone"]').fill(`+7999${String(teachers.length).padStart(7, '3')}`);
      await tp.locator('[data-testid="S-03.btn.submit"]').click();
      await tp.waitForSelector('[data-testid="S-04.btn.skip"]', { timeout: 20_000 });
      teachers.push({ who, ctx: tctx, page: tp, cardId: card.id });
    }
    note(`педагогов зарегистрировано: ${teachers.length}`);

    // Привязки: Смирнова — математика в обоих классах и русский в 5А;
    //           Кузнецов — история в обоих и русский в 5Б.
    const plan = [
      [0, 'Математика', '5А'], [0, 'Математика', '5Б'], [0, 'Русский язык', '5А'],
      [1, 'История', '5А'], [1, 'История', '5Б'], [1, 'Русский язык', '5Б'],
    ];
    for (const [ti, name, label] of plan) {
      const cls = target.find((c) => c.label === label);
      const subj = subjects.find((s) => s.name === name && s.classId === cls.id);
      const tok = await api(mod, 'POST', `/api/v1/subjects/${subj.id}/bind-token`, {});
      await api(teachers[ti].page, 'POST', '/api/v1/subjects/scan', { token: tok.token });
      await api(mod, 'POST', `/api/v1/subjects/${subj.id}/teachers`, { token: tok.token, scope: 'class' });
    }
    note(`привязок «педагог × предмет»: ${plan.length}`);

    // Четверти и нагрузка, затем сетка.
    await api(mod, 'PUT', '/api/v1/calendar/terms', { terms: recommendedTerms(SCHOOL_DAY) });
    const load = await api(mod, 'GET', '/api/v1/schedule/load');
    await api(mod, 'PUT', '/api/v1/schedule/load', {
      entries: load.entries.map((e) => ({ bindingId: e.bindingId, hoursPerWeek: e.subjectName === 'Математика' ? 5 : 3 })),
      version: load.version,
    });
    await api(mod, 'PUT', '/api/v1/schedule/priorities', { subjectIds: [], explicitNone: true });
    const st = await api(mod, 'GET', '/api/v1/schedule/load');
    await api(mod, 'PUT', '/api/v1/schedule/day-params', {
      slotsPerDay: 6, lessonMin: 45, breakMin: 10, days: 5, bigBreakAfter: 3, bigBreakMin: 20, version: st.version,
    });
    const preview = await api(mod, 'POST', '/api/v1/schedule/generate', {});
    await api(mod, 'POST', '/api/v1/schedule/confirm', { templateId: preview.templateId, version: preview.version });
    note(`сетка подтверждена, слотов: ${preview.slots.length}`);

    // ══════════════════════════════════════════════════════════════════
    console.log('\n════ РАБОЧИЙ ДЕНЬ ПЕДАГОГА ════');
    // ══════════════════════════════════════════════════════════════════
    const t = teachers[0].page;
    const T = 'педагог';

    console.log('\n▶ 1. Вошёл в систему — куда попал и что видит?');
    await t.goto(`${WEB}/`);
    await settle(t, '.sch-shell, [data-testid="S-00.hero"]');
    const landed = await t.evaluate(() => window.location.pathname);
    const visible = await t.evaluate(() =>
      [...document.querySelectorAll('[data-testid]')].map((e) => e.dataset.testid).slice(0, 12).join(', ') || '(ни одного элемента реестра)');
    note(`стартовый экран педагога: ${landed}`);
    note(`что на нём: ${visible}`);
    await shot(t, 'teacher-01-landing');
    await can(t, T, 'видит СВОИ уроки на сегодня сразу после входа', '[data-testid="S-40.today"], [data-testid="S-50.today"], [data-testid="today.lessons"]');

    console.log('\n▶ 2. Расписание — видит ли педагог СВОИ уроки, а не сетку всей школы?');
    await t.goto(`${WEB}/schedule`);
    await settle(t, '[data-testid="S-40.grid.week"], [data-testid="S-40.empty"]');
    await shot(t, 'teacher-02-schedule');
    await can(t, T, 'может отфильтровать расписание на себя', '[data-testid="S-40.filter.mine"], [data-testid="S-40.select.teacher"]');
    const weekCells = await t.locator('[data-testid="S-40.grid.week"] td').count();
    note(`ячеек в сетке недели, которые видит педагог: ${weekCells} (вся школа)`);

    console.log('\n▶ 3. Журнал — как быстро педагог попадает в СВОЙ класс и предмет?');
    await t.goto(`${WEB}/journal`);
    await settle(t, '[data-testid="S-50.table"], [data-testid="S-50.empty"]');
    await shot(t, 'teacher-03-journal');
    const clsOptions = await t.locator('[data-testid="S-50.select.class"] option').count();
    const subjOptions = await t.locator('[data-testid="S-50.select.subject"] option').count();
    note(`в выборе класса ${clsOptions} вариантов, в выборе предмета ${subjOptions} — педагог ведёт 3 привязки`);
    // Проверяем ФАКТ, а не маркер: маркера в реестре нет, и искать его значило
    // бы выдумывать элемент. Важно, что открылось, а не чем это помечено.
    const openCls = await t.locator('[data-testid="S-50.select.class"] option:checked').innerText().catch(() => '');
    const openSubj = await t.locator('[data-testid="S-50.select.subject"] option:checked').innerText().catch(() => '');
    if (/5[АБ]/.test(openCls) && openSubj && openSubj !== 'предметов у класса нет') {
      console.log(`    ✅ ${T}: журнал открылся на ЕГО классе и предмете — ${openCls} · ${openSubj}`);
    } else {
      console.log(`    ❌ ${T}: журнал открылся на «${openCls} · ${openSubj}» — это не его класс`);
      findings.push({ who: T, task: 'журнал открывается на своём классе и предмете', selector: `открылось: ${openCls} · ${openSubj}` });
    }

    console.log('\n▶ 4. Что педагог делает каждый день в журнале');
    await can(t, T, 'ставит отметку', '[data-testid="S-50.cell.mark"]');
    await can(t, T, 'видит средний за четверть', '[data-testid="S-50.col.average"]');
    await can(t, T, 'видит четвертную, которая выходит', '[data-testid="S-50.col.termGrade"]');
    await can(t, T, 'листает недели календарём', '[data-testid="S-50.weeks"]');
    await can(t, T, 'отмечает отсутствующих всем классом за раз', '[data-testid="S-50.btn.absent"], [data-testid="S-51.absent"]');
    await can(t, T, 'видит домашнее задание урока', '[data-testid="S-51.input.homework"], [data-testid="S-50.homework"]');

    console.log('\n▶ 5. Класс и ученики глазами педагога');
    await t.goto(`${WEB}/classes`);
    await settle(t, '.sch-shell');
    await shot(t, 'teacher-04-classes');
    const cardsSeen = await t.locator('[data-testid="S-10.card.class"]').count();
    note(`классов видно педагогу: ${cardsSeen} из ${classes.length} в школе`);
    await can(t, T, 'видит только свои классы или помечены свои', '[data-testid="S-10.card.class"][data-mine]');

    // ══════════════════════════════════════════════════════════════════
    console.log('\n════ РАБОЧИЙ ДЕНЬ МОДЕРАТОРА / ЗАВУЧА ════');
    // ══════════════════════════════════════════════════════════════════
    const M = 'модератор';

    console.log('\n▶ 1. Контроль: кто из педагогов не заполнил журнал');
    await mod.goto(`${WEB}/admin`);
    await settle(mod, '[data-testid="S-60.nav"]');
    await shot(mod, 'moder-01-admin');
    await can(mod, M, 'видит, кто не заполнил журнал', '[data-testid="S-60.journal.gaps"], [data-testid="S-60.control"]');
    await can(mod, M, 'видит сводку по школе (успеваемость, посещаемость)', '[data-testid="S-60.summary"], [data-testid="S-60.stats"]');

    console.log('\n▶ 2. Замена урока — заболел педагог');
    await mod.goto(`${WEB}/schedule`);
    await settle(mod, '[data-testid="S-40.grid.week"]');
    await shot(mod, 'moder-02-schedule');
    await can(mod, M, 'может назначить замену на конкретный урок', '[data-testid="S-40.btn.substitute"], [data-testid="S-40.cell.substitute"]');
    await can(mod, M, 'может отменить урок (актированный день, карантин)', '[data-testid="S-40.btn.cancelLesson"]');

    console.log('\n▶ 3. Движение контингента — перевод ученика между классами');
    const c5a = target.find((c) => c.label === '5А');
    await mod.goto(`${WEB}/classes/${c5a.id}`);
    await settle(mod, '[data-testid="S-12.table.roster"]');
    await shot(mod, 'moder-03-class');
    await can(mod, M, 'может перевести ученика в другой класс', '[data-testid="S-12.btn.transferStudent"]');
    await can(mod, M, 'видит успеваемость ученика по всем предметам', '[data-testid="S-13.marks"], [data-testid="S-13.performance"]');

    console.log('\n▶ 4. Журнал глазами завуча — проверка чужого класса');
    await mod.goto(`${WEB}/journal`);
    await settle(mod, '[data-testid="S-50.table"], [data-testid="S-50.empty"]');
    await shot(mod, 'moder-04-journal');
    await can(mod, M, 'видит итоги четверти по всему классу', '[data-testid="S-50.summary.term"], [data-testid="S-50.stats"]');

    // ── итог ──
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`НАХОДОК: ${findings.length}`);
    for (const f of findings) console.log(`  · ${f.who}: ${f.task}`);
    console.log(`Скриншотов: ${shotNo} в e2e/screenshots-walkthrough/`);
    fs.writeFileSync(path.join(SHOTS, 'findings.json'), JSON.stringify(findings, null, 2));
    for (const x of teachers) await x.ctx.close();
  } finally {
    await Promise.race([ctx.close().catch(() => undefined), new Promise((r) => setTimeout(r, 10_000))]);
    await Promise.race([browser.close().catch(() => undefined), new Promise((r) => setTimeout(r, 10_000))]);
  }
  process.exit(0);
}

const FAMILIES = ['Абрамов', 'Белова', 'Волков', 'Гусева', 'Дроздов', 'Ершова', 'Жуков', 'Зайцева', 'Ильин', 'Королёва',
  'Лебедев', 'Морозова', 'Новиков', 'Орлова', 'Павлов', 'Рыбакова', 'Соколов', 'Тихонова', 'Уваров', 'Фомина',
  'Хохлов', 'Цветкова', 'Чернов', 'Шилова', 'Юдин'];
const NAMES = ['Иван', 'Анна', 'Пётр', 'Мария', 'Олег', 'Дарья', 'Илья', 'Софья', 'Артём', 'Ева',
  'Никита', 'Полина', 'Егор', 'Алиса', 'Максим', 'Варвара', 'Тимур', 'Ксения', 'Роман', 'Вера',
  'Данил', 'Лидия', 'Кирилл', 'Нина', 'Глеб'];

main().catch((e) => { console.error(e); process.exit(1); });
