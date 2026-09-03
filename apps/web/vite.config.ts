import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

/**
 * Сборка service worker'а с идентификатором сборки (AR-185).
 *
 * Раньше `sw.js` лежал в `public/` и копировался в `dist` БЕЗ обработки —
 * значит был байт-в-байт одинаков во всех релизах. Браузер ищет обновление
 * воркера сравнением байтов: одинаковые байты = «обновления нет», `install` и
 * `activate` не выполняются никогда, и прод отдавал прошлую оболочку из кеша
 * (дефект 2026-08-31: владелец не увидел релиз ни с телефона, ни с десктопа).
 *
 * Идентификатор берётся из имени входного чанка — оно уже несёт хеш
 * содержимого и меняется тогда и только тогда, когда изменился код приложения.
 */
function swBuild(): Plugin {
  const source = fileURLToPath(new URL("./src/sw-source.js", import.meta.url));
  return {
    name: "schoolium-sw-build",
    apply: "build",
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find(
        (c): c is typeof c & { isEntry: true } => c.type === "chunk" && c.isEntry,
      );
      // Фолбэк на длину бандла не выдумывает версию, а называет то же, что
      // отличает сборки: без входного чанка релиза не бывает.
      const buildId = entry ? entry.fileName.replace(/^.*[/\\]|\.js$/g, "") : `b${Object.keys(bundle).length}`;
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: readFileSync(source, "utf8").replace(/__BUILD_ID__/g, buildId),
      });
    },
  };
}

// Алиасы: @ → src, @edustore/shared → пакет контрактов (как TS-исходник, без сборки).
/** Версия приложения — из корневого package.json (один источник, П-5). */
const APP_VERSION = (JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as { version: string }).version;

export default defineConfig({
  plugins: [react(), swBuild()],
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@edustore/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // dev: проксируем API на NestJS, чтобы фронт ходил на относительный /api
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  preview: {
    port: 5173,
    // preview (PROD-сборка в e2e-смоке) ходит на тот же относительный /api
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
