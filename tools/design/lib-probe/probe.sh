#!/usr/bin/env bash
# Зонд AR-197: собирает шесть вариантов и печатает размер бандла (raw и gzip -9).
# Запуск из этой папки: npm install && npm run probe
# База сравнения — `base`: то же приложение без библиотеки (React-пол).
set -euo pipefail
cd "$(dirname "$0")"
rm -rf dist
for v in base themes primitives prim-select prim-dialog; do
  npx vite build "$v" --config vite.config.ts --outDir "../dist/$v" --emptyOutDir --logLevel error
done
npx vite build shadcn --config vite.tw.config.ts --outDir ../dist/shadcn --emptyOutDir --logLevel error
printf "%-12s %-5s %9s %9s\n" вариант тип raw gzip
for v in base themes shadcn primitives prim-select prim-dialog; do
  for f in dist/$v/assets/*; do
    ext="${f##*.}"
    printf "%-12s %-5s %9d %9d\n" "$v" "$ext" "$(stat -c%s "$f")" "$(gzip -9c "$f" | wc -c)"
  done
done
