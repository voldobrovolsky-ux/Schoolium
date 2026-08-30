# Парсер учебников (Phase 1) — статус и решения

Замыкает вход в верх пайплайна движка: `doc.file.enriched → textbook.parsed → КТП`.
Поверх Документохранилища (`DocModule`) и событийного kernel. Модуль `modules/textbook`.

## Контур
```
учитель → edu/materials/upload-init → :fileId/commit   (docs/-контур, S3-абстракция)
        → Material{fileId, disciplineId} + textbook.uploaded
хранилище (async, OCR один раз) → doc.file.enriched{fileId, textExtract, tags}
парсер (подписка) → резолв Material по fileId → разбор textExtract → TextbookTopic/Card
        → textbook.parsed{materialId, fileId, cards[], topics[]}
```

## Решения
- **OCR — один раз, в хранилище.** Парсер НЕ гоняет Vision повторно: подписан на `doc.file.enriched`
  и переиспользует `textExtract` (из payload события; фолбэк — строка `File.textExtract`).
- **Владение разбором.** `cards[]/topics[]` — кабинетная (педагогическая) сущность, НЕ файловая.
  Таблицы `Material / TextbookTopic / TextbookCard` живут в этом модуле (движок/кабинеты), ссылка на
  учебник — по `fileId`. В Документохранилище новых сущностей не заведено (оно — писатель файлов).
- **`textbook.parsed` несёт `fileId`, не `s3Key`.** `materialId` резолвится из шага загрузки.
- **Идемпотентность.** Повторный `doc.file.enriched` по уже разобранному материалу — no-op
  (проверка наличия тем/карт). Событие-сироту (файл без Material) парсер тихо игнорирует — не ошибка.
- **Деградация.** Пустой `textExtract` / файл не обогащён (`state != enriched`) → парсер не
  запускается, материал остаётся без тем/карт до реального `doc.file.enriched`. Не падаем, по пустому
  тексту не гадаем.
- **Tenant-scoped.** Все три таблицы в `TENANT_COLUMN` (`workspaceId`) — под tenant-guard.

## Провайдеры разбора (`ParserProvider`)
Разбор — за абстракцией `ParserProvider.parse(textExtract, {className, subject})`
(`parser-provider.ts`), выбор — настройка воркспейса (`WorkspaceSettings.parserProvider`,
админ-раздел «Парсер учебников», дефолт `regexp`):
- **`RegexpParserProvider`** — детерминированное правило по структурным маркерам: темы
  `^(Глава|Тема|Раздел)\s+\d+`, карты `^§\s*\d+`. 0 ИИ, дефолт.
- **`LlmParserProvider`** — внешний OpenAI-совместимый эндпоинт; `endpointUrl`/`apiKey`/`modelName`
  из настроек воркспейса (ключ шифруется AES-256-GCM, в GET — только маска `sk-***`). Контракт
  ответа задокументирован в `llm-parser.provider.ts`: `topics[{title, order, sourcePage?}]` +
  `cards[{topicTitle, content, order, sourcePage?}]` — связь карт с темами по `topicTitle`,
  не по внутренним id.
- **Fallback.** llm упал (нет ключа / сеть / невалидный JSON) → лог + разбор `regexp`,
  загрузка НЕ роняется.

## Автогенерация КТП (`textbook.parsed → ktp.generated`)
Подписчик в движке (`engine.handlers`, движок — единственный писатель КТП): по `materialId`
резолвит `(disciplineId, classId)` из `Material` (класс приходит из `TeachingAssignment`
загружавшего учителя — методкопилка не спрашивает класс руками) и в одной транзакции:
- нет КТП → создаёт `draft`; есть `approved` → создаёт НОВУЮ draft-версию (утверждённая — рабочая,
  не трогается); есть `draft` → дополняет;
- темы ищутся по `title` (повторная загрузка того же учебника дублей не плодит), новые — в конец
  (`order = max+1`); карты прикрепляются к темам КТП (`TextbookCard.ktpTopicId`);
- `fgosHours = max(1, ceil(карт/N))`, `N` — `KTP_CARDS_PER_HOUR` (дефолт 5); тема без карт — 1 ч;
  каждая сгенерированная тема помечена `hoursSource='estimated'` (в UI завуча — бейдж «оценка
  парсера»); ручная правка темы (`POST edu/ktp/topics/:id`) флаг снимает;
- эмитится `ktp.generated`.

## Карточки → уроки (`kpp.approved → LessonContent`)
После утверждения КПП карты каждой темы раскладываются по её урокам равномерно: `⌊C/L⌋` на урок,
остаток — по одной в первые уроки; порядок карт — как у парсера. Связь — `LessonContent{kppLessonId,
cardId, order}`; повторный `kpp.approved` пересобирает без дублей. Учитель видит карточки в
расписании внутри урока (`GET edu/lessons/:id → contents[]`).

## Проверка
- `npm --workspace apps/api run parser:check` — e2e: обогащение→разбор→`textbook.parsed`
  (fileId не s3Key, темы/карты не пустые), идемпотентность, не-учебник→молчит, пустой текст→
  деградация, tenant-изоляция новых таблиц (13/13).
- `npm --workspace apps/api run flow:check` — сквозной поток без браузера (25 проверок):
  авто-контекст загрузки из назначения, живой docs/-контур на `STORAGE_MODE=local`, генерация/
  дополнение/версионирование КТП, оценка часов, раскладка карт по урокам, fallback llm→regexp,
  шифрование ключа.
- `node e2e/smoke-textbook.mjs` — живой Chromium-смок (пилотный QR-вход, настоящий PDF,
  скриншоты каждого шага в `e2e/screenshots/`); гоняется в CI (job `flow-smoke`).
- `npm --workspace apps/api run tenant:check` — изоляция тенанта без регрессий (6/6).

## Замечания
- REST `edu/materials/upload-init|commit` работает поверх doc-абстракции; `upload-init` принимает
  `assignmentId` (только СВОЁ назначение; одно назначение — резолвится автоматически, без поля).
  Продакшен — S3 (`S3CompatibleProvider`); dev/CI/пилот — `STORAGE_MODE=local` (`LocalFsProvider`:
  диск + одноразовые PUT/GET-токены, семантика presigned URL сохранена). Без обоих — 503.
- Обогащение (`doc.service.enrich`) теперь извлекает текстовый слой само: PDF — `pdf-parse`,
  `text/*` — как есть; сканы без слоя → `textExtract=null` (деградация). Тяжёлый Vision-OCR —
  по-прежнему внешний стаб.
- **RBAC-гейт (§5.1):** оба роута загрузки помечены `@RequirePermission('materials.textbook.upload')`;
  право — в пакете роли `teacher`. Не-учитель (ученик/родитель/завуч/методист) → 403 на границе guard
  (до сервиса/тенанта). Чтение разбора (`GET :fileId/parsed`) открыто (tenant-изоляция).
