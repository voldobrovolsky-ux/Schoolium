# Зонд выбора библиотеки компонентов (AR-197)

Шесть одинаковых по смыслу приложений на стеке Schoolium (React 18.3.1, Vite 5.4.21,
TypeScript 5.6): кнопка, поле, выпадающий список, бейдж, модалка, поповер.

| Папка | Что внутри |
|---|---|
| `base` | без библиотеки — React-пол, точка отсчёта |
| `themes` | `@radix-ui/themes` 3.3.0 + `styles.css` |
| `shadcn` | Radix Primitives + Tailwind 4 + `cva`/`clsx`/`tailwind-merge`, компоненты в стиле shadcn/ui |
| `primitives` | Radix Primitives (`Dialog`, `Popover`, `Toast`, `Tooltip`) + свой CSS на переменных |
| `prim-select` | один `@radix-ui/react-select` — цена кастомного селекта |
| `prim-dialog` | один `@radix-ui/react-dialog` — цена одного слоя |

Запуск: `npm install && npm run probe`. Результаты и выводы — `docs/design/1.4.0/library-choice.md`.
Зонд не является частью приложения и не входит в workspaces монорепо.
