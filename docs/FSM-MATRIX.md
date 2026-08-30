# EduStore — FSM-матрицы полноты

> Дата: 2026-07-28, состояние **main** (`cfe3a09`). Каждый конечный автомат системы — строкой на состояние:
> `состояние → (входы, выходы, дом-экран, терминал?)`. Пустая ячейка или «—» с
> пометкой ⚠ = дыра, видимая перечислением, а не чтением кода. Ссылки АР-N —
> на блочные реестры [docs/ar/](./ar/INDEX.md). Дыры сведены в конец документа.

## 1. `Ktp` (календарно-тематический план) — `KtpStatus`

| Состояние | Вход | Выход | Дом-экран | Терминал? |
|---|---|---|---|---|
| `draft` | автогенерация из `textbook.parsed` (`ktp.generated`, часы `hoursSource='estimated'`); дополнение при повторной загрузке; ручная правка темы `POST edu/ktp/topics/:id` (снимает флаг оценки); ⚠ ручное создание КТП без учебника не определено (AR-38) | `approve` → `approved` (завуч, `planning.ktp.approve`) | KtpApprovalScreen (завуч, бейдж «оценка парсера») | нет |
| `approved` | `approve` + событие `edustore.ktp.approved` → триггерит Solver | повторный `textbook.parsed` → НОВАЯ draft-версия (утверждённая не трогается); ⚠ прямой возврат approved→draft не определён | KtpApprovalScreen | да (де-факто) |

## 2. `Kpp` (календарно-поурочный план) — `KppStatus`

| Состояние | Вход | Выход | Дом-экран | Терминал? |
|---|---|---|---|---|
| `scheduled` | Solver `generateKpp` (по `ktp.approved`); отказы: `NO_APPROVED_KTP`, `NO_TIMETABLE`, `INSUFFICIENT_SLOTS`, `KPP_IN_USE` | `approve` → `approved` (завуч); пересборка Solver'ом (сносит КПП+уроки, только пока все уроки idle) | KtpApprovalScreen | нет |
| `approved` | `approve` + `edustore.kpp.approved` → открывает гейт `lesson.start` | ⚠ отзыв утверждения не определён; пересборка заблокирована `KPP_IN_USE` при не-idle уроках | KtpApprovalScreen | да (де-факто) |

## 3. `Lesson` — `LessonState` (+ `phase` внутри running)

| Состояние | Вход | Выход | Дом-экран | Терминал? |
|---|---|---|---|---|
| `idle` | создаётся Solver'ом (mode=auto) | `start` → `running` — гейт `kpp.approved`, иначе `409 LESSON_LOCKED`; право `lesson.conduct` | ПП («метро»), Летучка (выбор урока) | нет |
| `running` | `start` (t0, teacherId, событие `lesson.started`) | `setPhase` (цикл внутри, `lesson.phase.changed`); `complete` → `done` | ПП / Летучка | нет |
| `done` | `complete` — ⚠ БЕЗ события | ⚠ выхода нет (отмена/повторное проведение не определены) | ПП | да |

Сопутствующие сигналы running: `attendance.marked`, `topic.progressed`, `topic.completed` → ИОМ.
⚠ `TimingProfile` (методист) заведён и читается, но пороги фаз в FSM не применяются (ENGINE.md, стаб).

## 4. `BriefTest` (летучка) — FSM `generated → checked → done`

| Состояние | Вход | Выход | Дом-экран | Терминал? |
|---|---|---|---|---|
| `generated` | `print` (коды-псевдонимы, `brieftest.generated`) | `check` → `checked` (`assessment.checked` по кодам → ИОМ; в журнал НЕ пишет — АР-26, инвариант §8) | BriefTestScreen шаг 1–2 (учитель) | нет |
| `checked` | `check` | выставление оценки учителем (`grade.posted`) → `done` | BriefTestScreen шаг 3–4 | нет |
| `done` | `grade.posted` (journal.service закрывает) | выхода нет | ⚠ дома нет: экран истории летучек отсутствует | да |

## 5. `Ack` объявления (Communitoria) — `sent → delivered → read → acknowledged` (+ вычисляемое `overdue`)

| Состояние | Вход | Выход | Дом-экран | Терминал? |
|---|---|---|---|---|
| `sent` | публикация объявления (audience → required-set) | `delivered` → `read` → `acknowledged` (события `.ack.recorded`) | ⚠ экрана реестра ack на фронте нет (только API `/acks`) | нет |
| `delivered` / `read` | продвижение FSM | следующий шаг; `overdue` вычисляется при чтении реестра по `ackDeadline` (не хранится) | — ⚠ | нет |
| `acknowledged` | ack адресата | выхода нет | — ⚠ | да |
| (выбытие адресата) | уход из школы (нет `Membership`) | строка вычищается из required-set (reconcile, не вечный overdue) | — | да (снятие) |

## 6. `File` (Документохранилище) — две оси: `state` × `status`

`state` (техническая):

| Состояние | Вход | Выход | Дом-экран | Терминал? |
|---|---|---|---|---|
| `pending` | `upload-url` (presign) | `commit` (HEAD-валидация; нет объекта → `409 NO_OBJECT`); orphan-GC через 15 мин → удаление | MaterialsScreen (прогресс) | нет |
| `raw` | `commit` (`doc.file.created`) | `enrich` → `enriched` (PDF — `pdf-parse`, `text/*` — как есть; скан без слоя → `textExtract=null`, деградация — AR-39) | MaterialsScreen (значок состояния) | нет |
| `enriched` | `enrich` (`doc.file.enriched` → парсер учебников) | выхода нет (повторный enrich идемпотентен) | MaterialsScreen (темы/карты) | да |

`status` (документооборот, только scope=школа): `draft → review → official → archived`.

| Состояние | Выход | Терминал? |
|---|---|---|
| `draft` | → `review` → `official`; удаление разрешено | нет |
| `review` | → `official` / назад в `draft` | нет |
| `official` | → `archived`; **удаление запрещено**; ⚠ форк official→draft — слот, не реализован | нет |
| `archived` | ⚠ выхода нет (восстановление не определено) | да |

Плюс `deletedAt` (trash → purge) — ортогональная ось мягкого удаления.

## 7. `OutboxEvent` — `OutboxStatus`

| Состояние | Вход | Выход | Дом | Терминал? |
|---|---|---|---|---|
| `PENDING` | `enqueue` в транзакции домена | publish (inline drain / воркер 2с) → `PUBLISHED`; ошибка → attempts++ | ⚠ операторского экрана DLQ нет (только БД) | нет |
| `PUBLISHED` | publish | выхода нет | — | да |
| `FAILED` (DLQ) | attempts ≥ 8 | ⚠ ручного replay нет — ни API, ни скрипта | ⚠ | да (тупик) |

## 8. `PilotInvite` (временный контур, AR-15)

| Состояние | Вход | Выход | Дом-экран | Терминал? |
|---|---|---|---|---|
| создан (token, TTL 7 дней) | owner «добавить сотрудника» | QR-вход → `used` (userId заполнен, User/Membership/Teacher созданы); истечение TTL → мёртвый токен | PilotOwner (QR) | нет |
| `used` | `POST /pilot/login` | выхода нет (одноразовость) | PilotLogin → кабинет | да |
| истёкший | TTL | ⚠ повторная выдача = новый инвайт; экрана «переиздать» нет | PilotOwner | да |

Сопутствующий FSM `cabinet-state`: `preparing` (не назначен) → `ready` (назначен) — поллится фронтом.

## 9. Device flow киоска (`oidc-device`) — состояния **в памяти процесса** (осознанно, single-instance)

| Состояние | Вход | Выход | Дом-экран | Терминал? |
|---|---|---|---|---|
| authorize (код выдан) | `POST /authorize` (purpose=login\|kiosk) | poll → approved / истечение TTL | KioskLogin / DeviceBind (QR) | нет |
| approved | подтверждение с телефона (`/bind`) | login: `flor_sid`; kiosk: `Device`+deviceToken | BindConfirm → кабинет | да |
| expired | TTL | новый authorize | KioskLogin (перегенерация QR) | да |
| ⚠ рестарт API | — | все активные потоки теряются (in-memory) — принятый трейдофф v1 | — | — |

## 10. Голосовой ввод (фронт, `VoiceOverlay`/`MVoice` — два дубля одного FSM, АР-43)

| Состояние | Вход | Выход | Терминал? |
|---|---|---|---|
| `recording` | кнопка микрофона (getUserMedia; отказ → сообщение «вручную») | «Готово» → `processing` | нет |
| `processing` | stop → `POST /voice/grade` | candidates=1 → `confirm`; >1 → `disambig`; 0 или нет grade → `error`; 503 → `error` («сервис недоступен») | нет |
| `disambig` | несколько кандидатов | выбор → `confirm`; отмена → закрытие | нет |
| `confirm` | кандидат выбран | подтверждение → `POST /journal/grade (source=VOICE)` → закрытие; отмена → закрытие | да |
| `error` | сбой/пусто | повтор → `recording`; закрытие | да |
| ⚠ | `confidence` из ответа не участвует в переходах (AR-42) | | |

## 11. Матрицы поведения enum-таксономий

### `FlorRole × subRole → кабинет × источник экранов`

| Роль | Кабинет (`resolveCabinet`) | Экраны реальные | Пакет прав |
|---|---|---|---|
| `teacher` | AppShell (учитель) | журнал, ПП, летучка, материалы, расписание | teacher |
| `staff`+`zavuch` | MinimalCabinet | Дисциплины, Учителя (распределение), КТП и КПП | zavuch |
| `staff`+`methodist` | MinimalCabinet | Дисциплины; остальное — заглушки | methodist |
| `staff`+`psychologist` | MinimalCabinet | ⚠ все секции — заглушки (права `psych.*` в каталоге есть) | psychologist |
| `parent` | MinimalCabinet | ⚠ заглушки (права `diary/grades.child.view` есть) | parent |
| `student` | MinimalCabinet | ⚠ заглушки | student |
| `admin` | AdminApp | Классы и подгруппы, Сеть устройств | — (tenancy-роль, вне каталога — АР-16) |
| `owner` | MinimalCabinet | ⚠ заглушки; вход зависит от AR-34 (тенант без школы) | — (tenancy) |

### `Channel.kind` (8 значений) → поведение

| kind | Кто создаёт | Инвариант миноров | Особое |
|---|---|---|---|
| `class`, `subject`, `shmo`, `school`, `parents`, `students` | `comm.channel.manage` (teacher/zavuch/methodist) | `minorPresent` ⇒ external отклоняется (двусторонне) | объявления: только `comm.announcement.post` (завуч) |
| `external` | то же | ⚠ сочетание external-канал + минор отклоняется на добавлении | — |
| `dm` | ⚠ **эндпоинта создания DM нет** — инвариант `assertPrivateDmAllowed` реализован, но не вызывается ни одним роутом (живёт только в G-2) | по ребру `parenthood` | — |

### `ConsentPurpose` → где гейтится

| purpose | Гейт в коде |
|---|---|
| `predictive_profiling` | **Реализовано (AR-29, G-13)**: `analytics/class` исключает ученика из atRisk с явной пометкой (`profilingConsent.withoutConsent`); `GET iom/:studentId` → `403 NO_PROFILING_CONSENT`; отзыв = append `granted=false`; сигналы копятся независимо |
| `media` | слот: гейт публикаций — в Репутационном параметре (его поверхности ещё нет) |
| `data_processing`, `comms` | слот: заводится по мере появления поверхностей (рассылки/обработка) |

### `GradeSource` / `LessonMode`

| Значение | Поведение |
|---|---|
| `MANUAL` / `VOICE` | различаются только меткой; VOICE обязателен визуальный confirm (АР-18) |
| `auto` | уроки из Solver; `hybrid`/`manual` — ⚠ значения заведены, ветвления в коде нет |

## Сводка дыр (вход для дизайн-спеки)

Закрыто реализацией 2026-07-28: ~~`ConsentPurpose` не гейтится~~ (predictive_profiling —
G-13; media/comms — слоты поверхностей); ~~авторинг Timetable отсутствует~~ (экран завуча
«Сетка расписания» + `TIMETABLE_IN_USE`, G-15); снятие оценки получило событие
`journal.grade.removed.v1` (аудит); двойной журнал устранён (AR-4, G-12).

Остаются (кандидаты в следующие инкременты / дизайн-спеку):
1. Нет обратных переходов: `Ktp.approved` (прямой возврат), `Kpp.approved`, `Lesson.done`, `File.archived` — отмена/возврат не определены.
2. `Lesson.complete` не эмитит событие — конец урока невидим для каскадов.
3. DLQ (`OutboxEvent.FAILED`) — тупик без replay и без операторского экрана (G-17).
4. `BriefTest.done` и Ack-реестр — нет дома на экране.
5. `Channel.dm` — инвариант есть, эндпоинта нет.
6. `LessonMode.hybrid|manual` — мёртвые значения enum.
7. Скан без текстового слоя → `textExtract=null` → материал без тем/карт; Vision-OCR — слот (AR-39).
8. Устройственные потоки in-memory — теряются на рестарте (принято для v1).
9. Ручное создание КТП без учебника не определено (остаток AR-38).
