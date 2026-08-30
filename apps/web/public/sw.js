/* Schoolium — service worker.
   Стратегия: app-shell precache + stale-while-revalidate для СТАТИКИ.

   Ответы `/api/` НЕ КЕШИРУЮТСЯ. Журнал — инструмент выставления оценок, а не
   витрина: показать вчерашние отметки как сегодняшние значит соврать учителю о
   том, что он уже поставил, и о том, что ещё нет. Без сети экран честно уходит
   в состояние `error` с кнопкой «Повторить» — оно есть у каждого экрана и
   описано реестром, в отличие от «данных неизвестной свежести». */
const SHELL_CACHE = "schoolium-shell-v1";
const SHELL_ASSETS = ["/", "/index.html", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE)
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // мутации не кешируем

  const url = new URL(request.url);

  // API: только сеть. Кеша нет ни как источника, ни как фолбэка — данные
  // журнала и расписания либо свежие, либо их нет, и человек об этом знает.
  if (url.pathname.startsWith("/api/")) return;

  // Статика/навигация: stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
