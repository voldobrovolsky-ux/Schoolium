/* Schoolium — service worker. ИСХОДНИК: собирается плагином `swBuild`
   (apps/web/vite.config.ts), который подставляет вместо `__BUILD_ID__` хеш
   входного чанка сборки и кладёт результат в `dist/sw.js`.

   Почему исходник, а не готовый файл в `public/` (AR-185, дефект прода
   2026-08-31): `public/` копируется в `dist` БЕЗ обработки, поэтому прежний
   `sw.js` был байт-в-байт одинаков во всех релизах. Браузер ищет обновление
   воркера сравнением байтов скрипта — одинаковые байты значат «обновления
   нет»: `install`/`activate` не выполнялись НИ РАЗУ с первой установки, а
   стратегия «сначала кеш» отдавала прошлогоднюю оболочку. Владелец обновлял
   страницу и видел старый интерфейс: F5 идёт через тот же обработчик.

   Стратегии — по природе имени URL, а не по вкусу:
   · навигация и `index.html` — NETWORK-FIRST (имя без хеша: отдать её из
     кеша значит поставить на то, что релиза не было). Запрос идёт мимо
     HTTP-кеша браузера (`cache: "reload"`): у index.html нет `Cache-Control`
     в старых образах, и эвристическая свежесть возвращала бы ту же
     протухшую разметку. Кеш остаётся ОФЛАЙН-ФОЛБЭКОМ.
   · `/assets/**` — CACHE-FIRST: имя содержит хеш содержимого, сеть не может
     дать других байтов. Живёт в ОТДЕЛЬНОМ, НЕ версионируемом кеше: чистить
     его при активации нельзя — вкладка, открытая в момент деплоя, попросит
     свой ленивый чанк (сканер QR), а на сервере его уже нет.

   Ответы `/api/` НЕ КЕШИРУЮТСЯ. Журнал — инструмент выставления оценок, а не
   витрина: показать вчерашние отметки как сегодняшние значит соврать учителю о
   том, что он уже поставил, и о том, что ещё нет. Без сети экран честно уходит
   в состояние `error` с кнопкой «Повторить» — оно есть у каждого экрана и
   описано реестром, в отличие от «данных неизвестной свежести». */

const BUILD_ID = "__BUILD_ID__";
/** Оболочка версионируется сборкой: старые копии уходят при активации. */
const SHELL_CACHE = `schoolium-shell-${BUILD_ID}`;
/** Хешированные ассеты общие для всех сборок — их имена уже уникальны. */
const ASSET_CACHE = "schoolium-assets";
const SHELL_PREFIX = "schoolium-shell-";

self.addEventListener("install", (event) => {
  // `cache: "reload"` — оболочка кладётся из СЕТИ, а не из HTTP-кеша браузера:
  // иначе новый воркер положил бы в свежий кеш старую разметку.
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) =>
        Promise.all(
          ["/", "/manifest.webmanifest"].map((u) =>
            fetch(new Request(u, { cache: "reload" }))
              .then((res) => (res.ok ? c.put(u, res) : undefined))
              .catch(() => undefined),
          ),
        ),
      ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          // Уходят ТОЛЬКО оболочки прошлых сборок. Кеш хешированных ассетов
          // переживает активацию: он общий, и его чистка ломает вкладку,
          // открытую в момент деплоя (404 на ленивом чанке сканера).
          .filter((k) => k.startsWith(SHELL_PREFIX) && k !== SHELL_CACHE)
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

/** Положить в кеш только УСПЕШНЫЙ ответ: 404 старого чанка — это HTML-страница
 *  ошибки nginx, и, попав в кеш под именем скрипта, она даёт белый экран. */
const putIfOk = (cacheName, request, response) => {
  if (!response || !response.ok) return Promise.resolve();
  const copy = response.clone();
  return caches.open(cacheName).then((c) => c.put(request, copy));
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // мутации не кешируем

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // шрифты и прочий CDN — дело HTTP-кеша
  if (url.pathname === "/sw.js") return; // воркер обновляет себя сам, мимо кеша

  // API: только сеть. Кеша нет ни как источника, ни как фолбэка — данные
  // журнала и расписания либо свежие, либо их нет, и человек об этом знает.
  if (url.pathname.startsWith("/api/")) return;

  // Навигация и оболочка: СЕТЬ ПЕРВОЙ, кеш — офлайн-фолбэк.
  if (request.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith("/index.html")) {
    event.respondWith(
      fetch(new Request(request.url, { cache: "reload", credentials: "same-origin" }))
        .then((res) => {
          // Ключ всегда «/»: SPA-роуты отдаются одним и тем же index.html, и
          // раздельные записи на /staff, /journal… протухали независимо —
          // роут, по которому никто не перезагружался, застревал навсегда.
          event.waitUntil(putIfOk(SHELL_CACHE, "/", res));
          return res;
        })
        .catch(() => caches.match("/").then((c) => c || Response.error())),
    );
    return;
  }

  // Хешированные ассеты: кеш первым, сеть — при промахе.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            event.waitUntil(putIfOk(ASSET_CACHE, request, res));
            return res;
          }),
      ),
    );
    return;
  }

  // Остальная статика (иконки, манифест): stale-while-revalidate. Запись
  // держится `waitUntil` — иначе браузер вправе усыпить воркер сразу после
  // ответа из кеша, и ревалидация не доезжает НИКОГДА.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          event.waitUntil(putIfOk(SHELL_CACHE, request, res));
          return res;
        })
        .catch(() => cached);
      if (cached) event.waitUntil(network.catch(() => undefined));
      return cached || network;
    }),
  );
});
