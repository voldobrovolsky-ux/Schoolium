# Schoolium — памятка для Claude

## ⚠️ Перед любой работой с сервером/деплоем — обязательно прочитать
**[docs/PROD-STATUS.md](docs/PROD-STATUS.md)** — там прод-сервер (IP, домен),
единственный рабочий канал деплоя (GitHub Actions, не SSH напрямую из
агентной среды), факт, что в базе уже реальные данные учеников, и что
никогда нельзя выполнять на этом сервере.

## Что это за проект
**Schoolium** — ERP для школ (журнал, расписание, дневник). Репозиторий —
монорепо: `apps/api` (NestJS+Prisma+PostgreSQL), `apps/web` (React+Vite),
`services/asr` (голосовой ввод, вытесняемый контур). Подробнее — README.md
и `docs/PRODUCT-LOGIC.md`.

## Ключевые документы
- [docs/PROD-STATUS.md](docs/PROD-STATUS.md) — прод-стенд: сервер, деплой, текущее состояние (читать первым, если задача касается сервера).
- [docs/DEPLOY.md](docs/DEPLOY.md) — общий раннбук деплоя на VPS (шаги, troubleshooting).
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — модульность, как добавить новый раздел.
- [docs/AR-REGISTRY.md](docs/AR-REGISTRY.md) / [docs/ar/INDEX.md](docs/ar/INDEX.md) — реестры архитектурных решений.
- [docs/method/README.md](docs/method/README.md) — конвейер «задача → спека».

## Деплой в двух словах
Единственный канал — GitHub Actions workflow `.github/workflows/deploy-school.yml`
(`workflow_dispatch`, action=`deploy`/`bootstrap`/`import`/`status`). Агентная
среда не имеет прямого SSH до VPS — только этот workflow, у которого есть
секреты. Правки кода → коммит → пуш → триггер workflow → чтение логов
прогона. Подробности и текущий статус — в `docs/PROD-STATUS.md`.
