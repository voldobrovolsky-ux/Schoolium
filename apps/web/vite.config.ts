import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Алиасы: @ → src, @edustore/shared → пакет контрактов (как TS-исходник, без сборки).
export default defineConfig({
  plugins: [react()],
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
