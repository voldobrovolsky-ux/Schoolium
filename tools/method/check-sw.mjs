#!/usr/bin/env node
/**
 * G-80 (AR-185): **релиз доезжает до устройства — статическая половина.**
 *
 * Дефект прода 2026-08-31: владелец не увидел задеплоенный пакет ни с
 * телефона, ни с десктопа, и обновление страницы не помогало. Причина —
 * `apps/web/public/sw.js` лежал в `public/`, копировался в `dist` БЕЗ
 * обработки и потому был байт-в-байт одинаков 68 коммитов подряд. Браузер
 * ищет обновление воркера сравнением байтов скрипта: одинаковые байты значат
 * «обновления нет», `install`/`activate` не выполнялись ни разу с первой
 * установки, а стратегия «сначала кеш» отдавала прошлую оболочку.
 *
 * Проверяется то, что регулярками проверяется ЧЕСТНО — факты размещения и
 * заголовков, а не пересказ стратегии:
 *
 *   1. воркер собирается из исходника с плейсхолдером и НЕ живёт в `public/`;
 *   2. сборка подставляет идентификатор — в `dist/sw.js` (если собран)
 *      плейсхолдера уже нет, а имя кеша оболочки версионировано;
 *   3. ответы `/api/` не кешируются — ранний выход на месте;
 *   4. навигация идёт сетью мимо HTTP-кеша (`cache: "reload"`);
 *   5. активация чистит ТОЛЬКО оболочки прошлых сборок: чистка хешированных
 *      ассетов ломает вкладку, открытую в момент деплоя (404 ленивого чанка);
 *   6. nginx не молчит про кеш оболочки, воркера и манифеста, а `/assets/`
 *      отдаёт ОДИН заголовок `Cache-Control`.
 *
 * Поведенческая половина — G-53 (блок «PWA · доставка релиза»): там новая
 * оболочка обязана быть видна с первой обычной перезагрузки поверх уже
 * установленного воркера.
 *
 * Запуск: node tools/method/check-sw.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SW_SRC = path.join(ROOT, 'apps/web/src/sw-source.js');
const SW_PUBLIC = path.join(ROOT, 'apps/web/public/sw.js');
const VITE = path.join(ROOT, 'apps/web/vite.config.ts');
const NGINX = path.join(ROOT, 'apps/web/nginx.conf');
const SW_DIST = path.join(ROOT, 'apps/web/dist/sw.js');
const MAIN = path.join(ROOT, 'apps/web/src/main.tsx');

const errors = [];
const notes = [];
const check = (ok, good, bad) => (ok ? notes.push(good) : errors.push(bad));
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);

// ---------- 1. воркер собирается, а не копируется ----------
const src = read(SW_SRC);
check(src !== null, 'исходник воркера — apps/web/src/sw-source.js', 'нет apps/web/src/sw-source.js: воркеру неоткуда взять идентификатор сборки');
check(
  !fs.existsSync(SW_PUBLIC),
  'в public/ воркера нет — public копируется без обработки, и файл оттуда был бы вечно одинаковым',
  'apps/web/public/sw.js вернулся: файл из public копируется в dist БЕЗ обработки, байты не меняются, браузер не найдёт обновления',
);
if (src) {
  check(
    /__BUILD_ID__/.test(src),
    'исходник несёт плейсхолдер __BUILD_ID__',
    'в sw-source.js нет плейсхолдера __BUILD_ID__ — подставлять нечего, байты воркера перестанут меняться между релизами',
  );
  check(
    /const SHELL_CACHE = `schoolium-shell-\$\{BUILD_ID\}`/.test(src),
    'имя кеша оболочки версионировано идентификатором сборки',
    'имя кеша оболочки не версионировано сборкой — activate не отличит прошлую оболочку от текущей',
  );
  check(
    /pathname\.startsWith\("\/api\/"\)\)\s*return/.test(src),
    'ответы /api/ не кешируются — ранний выход на месте',
    'исчез ранний выход для /api/: журнал начнёт показывать вчерашние отметки как сегодняшние',
  );
  check(
    /request\.mode === "navigate"/.test(src) && /cache: "reload"/.test(src),
    'навигация идёт сетью мимо HTTP-кеша браузера (cache: "reload")',
    'навигация не network-first либо не обходит HTTP-кеш: оболочка без Cache-Control попадёт под эвристическую свежесть и релиз снова застрянет',
  );
  check(
    /startsWith\(SHELL_PREFIX\) && k !== SHELL_CACHE/.test(src),
    'activate чистит только оболочки прошлых сборок, кеш хешированных ассетов не трогает',
    'activate чистит кеши без разбора: вкладка, открытая в момент деплоя, получит 404 на ленивом чанке (сканер QR)',
  );
  check(
    /if \(!response \|\| !response\.ok\) return/.test(src),
    'в кеш кладутся только успешные ответы — 404 старого чанка не станет «скриптом»',
    'в кеш кладётся любой ответ: HTML-страница ошибки под именем бандла даёт белый экран',
  );
}

// ---------- 2. сборка подставляет идентификатор ----------
const vite = read(VITE);
check(
  !!vite && /fileName: "sw\.js"/.test(vite) && /__BUILD_ID__/.test(vite),
  'vite.config.ts собирает sw.js с подстановкой идентификатора сборки',
  'vite.config.ts не эмитит sw.js с подстановкой __BUILD_ID__ — воркер не попадёт в dist или останется без версии',
);
const dist = read(SW_DIST);
if (dist === null) {
  notes.push('dist/sw.js не собран — подстановка проверяется прогоном сборки (CI собирает web перед смоком)');
} else {
  check(
    !/__BUILD_ID__/.test(dist),
    'в собранном dist/sw.js плейсхолдер подставлен',
    'в dist/sw.js остался литерал __BUILD_ID__ — плагин сборки не отработал, и байты воркера снова не будут меняться',
  );
  const m = dist.match(/const BUILD_ID = "([^"]+)"/);
  check(
    !!m && m[1] !== 'v1' && m[1].length > 3,
    `идентификатор сборки в dist/sw.js: ${m ? m[1] : '—'}`,
    'BUILD_ID в dist/sw.js пуст или вырожден — версия не отличит релизы',
  );
}

// ---------- 3. заголовки оболочки ----------
const nginx = read(NGINX);
if (!nginx) errors.push('нет apps/web/nginx.conf — нечем проверить заголовки оболочки');
else {
  for (const loc of ['/index.html', '/sw.js', '/manifest.webmanifest']) {
    const block = nginx.match(new RegExp(`location = ${loc.replace(/[/.]/g, '\\$&')}\\s*\\{[^}]*\\}`));
    check(
      !!block && /no-cache/.test(block[0]),
      `${loc} отдаётся с no-cache`,
      `${loc} без Cache-Control: no-cache — браузер применит эвристическую свежесть и покажет прошлую версию`,
    );
  }
  const assets = nginx.match(/location \/assets\/\s*\{[^}]*\}/);
  check(
    !!assets && /immutable/.test(assets[0]) && !/expires/.test(assets[0]),
    '/assets/ отдаёт ОДИН Cache-Control (immutable), без парного expires',
    '/assets/ отдаёт два Cache-Control (expires + add_header) либо потерял immutable — двойной заголовок на самом чувствительном маршруте',
  );
}

// ---------- 4. регистрация ----------
const main = read(MAIN);
check(
  !!main && /navigator\.serviceWorker\.register\("\/sw\.js"\)/.test(main) && /import\.meta\.env\.PROD/.test(main),
  'воркер регистрируется только в прод-сборке',
  'регистрация воркера потеряна либо перестала быть PROD-only',
);

// ---------- отчёт ----------
console.log(`Контур PWA: проверок ${notes.length + errors.length}.`);
for (const n of notes) console.log(`  ✅ ${n}`);
if (errors.length) {
  console.error(`\n❌ G-80: нарушений ${errors.length}`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('✅ G-80: воркер версионируется сборкой, навигация идёт сетью, оболочка не кешируется — релиз доезжает до устройства.');
