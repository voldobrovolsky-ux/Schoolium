# EduStore — Система параметров: архитектура

> Ответ на ТЗ «Система параметров EduStore». Параметр = самостоятельный
> операционный слой (домен) с собственной моделью, который порождает и потребляет
> события и каскадно воздействует на другие параметры. 13 параметров = «ОС школы».
>
> Эталон глубины — документ УМК. Здесь — как заставить это **реально работать**.

Оглавление: [1 Паттерны](#1-паттерны-исследование) · [2 Доменные модели](#2-доменные-модели-13-параметров) ·
[3 Event bus](#3-архитектура-event-bus-nats) · [4 Код](#4-архитектура-в-коде-nestjs-modulith) ·
[5 Приоритет](#5-приоритет-реализации) · [6 Риски](#6-риски-и-слепые-зоны)

---

## 1. Паттерны (исследование)

**Главный выбор: choreography по умолчанию, orchestration для сложных процессов.**

| Паттерн | Когда применять у нас | Подводный камень |
|---|---|---|
| **Choreography** (параметры реагируют на факты-события, без дирижёра) | Простые реактивные каскады («ученик зачислен → журнал/питание/канал») | «Всё триггерит всё» → нечитаемость; лечится дисциплиной контрактов + трейсингом |
| **Orchestration / Process Manager** (один компонент ведёт многошаговый процесс, хранит состояние) | Сложные бизнес-процессы с шагами и компенсацией: **создание мероприятия**, «учитель заболел → замена», «конец года» | Центральная связность; держать оркестратор **внутри своего параметра** (Мероприятия владеют сагой мероприятия) |
| **Saga** (распределённая транзакция через компенсации, без 2PC) | Где нужен «всё-или-ничего» через домены (мероприятие: бронь зала + транспорт + выплаты — откат при отказе) | Компенсации проектировать заранее; не у всех действий есть откат |
| **Transactional Outbox** | **Всегда** при публикации события: атомарная запись в БД + событие | Без него — потеря событий или фантомные события при сбое |
| **Idempotent consumer (Inbox)** | **Всегда** на стороне потребителя: лог обработанных событий | At-least-once без dedup = двойные приказы/выплаты |
| **Event-Carried State Transfer** (толстые события с данными) | Для большинства каскадов: получатель действует без обратного запроса | НЕ нести чувствительные ПД в payload (152-ФЗ) — см. §6 |
| **Event Notification** (тонкое событие + обратный запрос за данными) | Высокий fan-out и/или чувствительные данные (медпоказания, соцстатус) | Дополнительная связность по чтению; зато ПД под контролем доступа |
| **Event Sourcing + CQRS** | **Точечно**: Юридика/Бухгалтерия, история ИОМ/ИКМ (нужен неизменяемый аудит) | Глобально — оверкилл; вводит сложность проекций/версий |

**Таксономия событий (Fowler):** по умолчанию Event-Carried State Transfer для слабой
связности; для ПД-чувствительных доменов — Event Notification (тонкое событие, данные
читаются по правам). Это ключевое решение под 152-ФЗ.

**Как это решают реальные системы (исследование аналогов):**

| Система | Механизм | Чему учит / антипаттерн |
|---|---|---|
| **Ellucian Ethos** (Banner/Colleague, university ERP) | Hub-and-spoke: BEP → RabbitMQ → Ethos; **change-notifications** на **канонической модели EEDM**; приложения `authoritative`/`subscribing`; consume **поллингом** с `lastProcessedID` (replay/идемпотентность), часто «тонкое событие → GET свежего ресурса по GUID» | Канонический контракт + явное владение ресурсом + подписка-фильтр убивают N×N. **Реальный антипаттерн:** генерация GUID включила все триггеры таблиц → шторм workflow-писем. Урок: «ограничь, что событию позволено триггерить». |
| **PowerSchool SIS** | В основном **pull**: delta-поллинг `getDataSubscriptionChanges($dataversion)` — источник истины; webhook «Event Subscription URL» — лишь подсказка | Delta как source of truth, webhook — hint→сверка. **Разрывать write-back петли:** помечать свои записи, dedup по id, не давать входящему событию напрямую триггерить запись в ту же таблицу. |
| **openIMIS** (health financing) | In-process **service signals** (`register_service_signal`/`bind_service_signal`, BEFORE/AFTER); mutation-signals validate/before/after | ⚠ **Главный урок-предостережение:** обработчики идут **в транзакции продюсера** и при ошибке **откатывают исходную операцию**. → У нас побочные эффекты НЕ в транзакции источника: источник коммитит, реакция асинхронна (outbox). |
| **FIWARE Orion** (smart-city context broker) | NGSI pub/sub с **фильтрами** (`attrs`, `q`-выражение, `alterationTypes`: create/update/change/delete), **`throttling`**, **`oneshot`**, само-петля по `Fiware-Correlator` | Богатый арсенал против каскад-хаоса: фильтр на подписке + троттлинг + one-shot + correlator-loop-protection. Ложится на наш depth-guard + correlationId. |
| **DHIS2** | **Event Hooks** → targets webhook/JMS/Kafka; `source.path` сужает до типа/ID | Best-effort доставка; сужать scope, буферизовать очередью, чтобы медленный потребитель не давил продюсера. |
| **X-Road / OpenG2P** | X-Road — синхронный mediated RPC (нет eventing); OpenG2P — Celery/Redis task-queues | Адресный вызов без шины = нет реактивности/fan-out; для каскадов нужна именно шина. |

**Пять сквозных рычагов «не дать всему триггерить всё»** (повторяются во ВСЕХ системах):
1. **Узко именовать события** (per service/phase — openIMIS; per entity-type — DHIS2).
2. **Фильтровать на подписке** (FIWARE `attrs`/`q`/`alterationTypes`) — не «подписка на всё».
3. **Opt-in на каждого потребителя**, никогда не неявный subscribe-to-all.
4. **Rate-limit / dedup / loop-guard** (FIWARE `throttling`/`oneshot`/correlator; Ethos `lastProcessedID`).
5. **Развязка буфером** (очередь/брокер), чтобы упавший потребитель не откатывал и не блокировал
   продюсера — **ключевая поправка к openIMIS**, где обработчик в tx продюсера.

Эти пять рычагов — основа §3 (naming, depth-guard, идемпотентность, outbox-развязка).
Общий вывод аналогов: **синхронные цепочки вызовов через домены — антипаттерн**; спасают
асинхронная шина + канонические контракты + идемпотентность + ограничение глубины/фильтрация.

---

## 2. Доменные модели (13 параметров)

Формат: **Сущности** · **Emits** (исходящие) · **Consumes** (входящие) · **Связи**.
Имена событий — `<param>.<aggregate>.<verbPast>.v1` (см. §3).

### Операционные

**УМК** — ядро образовательного процесса (эталон-документ).
- Сущности: `Curriculum(РП)`, `Unit/Topic`, `KTPEntry`, `AssessmentConfig(ФОС)`, `AIPromptSet`, `MethodologyDoc`, `DistributionModel`(базовая/авторская/форк/маркетплейс).
- Emits: `umk.curriculum.published.v1`, `umk.ktp.updated.v1`, `umk.material.generated.v1`, `umk.program.at_risk.v1` (отставание от плана).
- Consumes: `journal.grade.recorded.v1` (прогресс программы), `staff.absence.opened.v1` (сдвиг КТП), `events.day.blocked.v1` (день мероприятия → коррекция КТП).
- Связи: журнал (часть поверхности УМК), Кадровый, Мероприятия, ИОМ, Репутационный.

**Кадровый** — профиль сотрудника: нагрузка, квалификация, аттестация, отпуска, замены.
- Сущности: `Employee`, `Qualification`, `Attestation`, `WorkloadAssignment`(нагрузка), `Leave/Absence`, `Substitution`.
- Emits: `staff.absence.opened.v1`, `staff.substitution.assigned.v1`, `staff.workload.changed.v1`, `staff.attestation.due.v1`.
- Consumes: `umk.material.generated.v1` (КПД), `events.responsible.requested.v1` (назначить ответственного по нагрузке), `corp.order.issued.v1`.
- Связи: Пространственный (нагрузка↔кабинеты), Расписание, ИКМ, Корпоративный, Мероприятия.

**Контингентный** — учёт учеников: зачисление/отчисление/переводы, льготы, соцстатус, **медограничения**.
- Сущности: `Enrollment`, `StudentStatusChange`, `Benefit`(льгота), `SocialFlag`, `MedicalRestriction`(⚠ спецкатегория ПД), `Consent`(согласия фото/видео/обработка).
- Emits: `contingent.student.enrolled.v1`, `contingent.student.transferred.v1`, `contingent.student.withdrawn.v1`, `contingent.consent.collected.v1`. (Чувствительное — **тонкими** событиями.)
- Consumes: `events.created.v1` (собрать согласия), `nutrition.benefit.required.v1`.
- Связи: почти со всеми — это «кто». Журнал, Питание, Communitoria, ИОМ, Безопасностный.

### Прогностические

**ИОМ** — индивидуальный маршрут ученика (агрегатор).
- Сущности: `LearningRoute`, `Milestone`, `Strength/Gap`, `Achievement`, `RiskSignal`.
- Emits: `iom.risk.detected.v1` (объяснимый сигнал), `iom.milestone.reached.v1`.
- Consumes: `journal.grade.recorded.v1`, `umk.brief_test.scored.v1`, `psych.observation.added.v1`, `events.participation.recorded.v1`, `contingent.student.*`.
- Связи: Журнал/УМК, психолог (кабинет), Мероприятия, Родитель (отчёты), Communitoria.

**ИКМ** — карьерный маршрут педагога.
- Сущности: `CareerRoute`, `CourseCompletion`, `AttestationStep`, `LessonKPI`, `PortfolioItem`.
- Emits: `ikm.portfolio.updated.v1`, `ikm.attestation.progressed.v1`.
- Consumes: `staff.attestation.due.v1`, `umk.material.generated.v1` (КПД уроков), `events.conducted.v1` (мероприятие → портфолио).
- Связи: Кадровый, УМК, Мероприятия.

### Интерактивные

**Мероприятия** — самый сложный параметр (внешние API + ИИ-детект событий + большой каскад).
- Сущности: `Event`, `EventTemplate`, `CertificateTemplate`(грамоты/дипломы), `PartnerSource`(API сайтов-партнёров), `EventRole`(ведущие/ответственные), `EventReport`.
- Emits: `events.created.v1`, `events.responsible.requested.v1`, `events.certificates.generated.v1`, `events.day.blocked.v1`, `events.conducted.v1`, `events.participation.recorded.v1`.
- Consumes: `staff.substitution.assigned.v1`, `space.room.booked.v1`, `corp.order.issued.v1`, `contingent.consent.collected.v1`.
- Связи: **со всеми** (см. эталон-каскад в ТЗ). Оркестрирует сагу мероприятия.

**Репутационный** — внешние коммуникации: сайт, соцсети, рейтинги, автоконтент.
- Сущности: `Channel`(сайт/соцсеть), `Publication`, `ContentTemplate`, `RatingSnapshot`.
- Emits: `reputation.publication.drafted.v1`, `reputation.publication.published.v1`.
- Consumes: `events.conducted.v1` (анонс/итоги), `iom.milestone.reached.v1` (с согласия).
- Связи: Мероприятия, Контингентный (согласия!), Communitoria.

### Корпоративные

**Юридика + Бухгалтерия** — приказы, договоры, выплаты, премии, бюджет, отчётность (высокая ответственность).
- Сущности: `Order`(приказ), `Contract`, `Payout`, `Bonus`, `Budget`, `Report`, `ApprovalRoute`.
- Emits: `corp.order.issued.v1`, `corp.payout.planned.v1`, `corp.approval.requested.v1`, `corp.approval.completed.v1`.
- Consumes: `events.created.v1` (приказы/премии), `staff.substitution.assigned.v1` (оплата замены), `property.purchase.requested.v1`.
- Связи: Кадровый, Мероприятия, Имущественный, Питательный. **Точка для event-sourcing** (аудит).

**Имущественный** — МТС: инвентаризация, закупки, списание, привязка к пространству.
- Сущности: `Asset`, `InventoryRecord`, `PurchaseRequest`, `WriteOff`, `AssetLocation`.
- Emits: `property.purchase.requested.v1`, `property.asset.assigned.v1`, `property.asset.written_off.v1`.
- Consumes: `space.room.created.v1`, `corp.approval.completed.v1`, `events.created.v1` (оборудование под событие).
- Связи: Пространственный, Корпоративный, Мероприятия.

**Питательный** — меню, заявки, льготники, оплата, СЭС-отчётность.
- Сущности: `Menu`, `MealOrder`, `BenefitEater`(льготник), `Payment`, `SanReport`.
- Emits: `nutrition.order.created.v1`, `nutrition.benefit.required.v1`, `nutrition.san_report.generated.v1`.
- Consumes: `contingent.student.enrolled.v1` (новый едок), `events.day.blocked.v1` (выезд → коррекция заявок), `contingent.benefit.*`.
- Связи: Контингентный, Корпоративный, Безопасностный (СЭС), Мероприятия.

**Безопасностный** — пожарная безопасность, охрана, контроль доступа, СЭС.
- Сущности: `AccessRule`, `SafetyDrill`, `MedicalClearance`(медзопуск), `Incident`, `SanInspection`.
- Emits: `safety.clearance.required.v1`, `safety.incident.opened.v1`.
- Consumes: `events.created.v1` (медзопуск/инструктаж), `contingent.student.enrolled.v1` (доступ).
- Связи: Контингентный, Мероприятия, Пространственный, Питательный.

### Коммуникативный

**Communitoria** — мессенджер Flōr Group: каналы классов, уведомления, коммуникация ролей.
- Сущности: `Channel`, `Membership`, `Message`, `NotificationPref`.
- Emits: `communitoria.member.added.v1`, `communitoria.message.posted.v1`.
- Consumes: **очень многое** — это канал доставки каскадов: `contingent.student.enrolled.v1`, `events.created.v1`, `journal.assignment.published.v1`, `iom.risk.detected.v1` (только психологу/родителю по правам).
- Связи: со всеми (доставка). Анти-коррупционный коннектор + graceful degradation (см. аудит).

### Пространственный

**Кабинеты + инфраструктура** — какой кабинет свободен, где оборудование, бронирование.
- Сущности: `Room`, `Booking`, `EquipmentSlot`, `ResponsiblePerson`.
- Emits: `space.room.booked.v1`, `space.room.released.v1`, `space.conflict.detected.v1`, `space.room.created.v1`.
- Consumes: `events.created.v1` (бронь зала/автобуса), `staff.workload.changed.v1` (кабинеты под нагрузку), расписание.
- Связи: Кадровый, Расписание (УМК/КТП), Мероприятия, Имущественный.

> **Foundational** (без них не работают каскады — это «кто/где/чем»):
> Контингентный, Кадровый, Пространственный, Communitoria, Корпоративный.

---

## 3. Архитектура event bus (NATS)

### Naming convention
Subject (JetStream): **`<param>.<aggregate>.<verbPast>.v<N>`**, например
`contingent.student.enrolled.v1`, `events.certificates.generated.v1`.
- Tenant (`organizationId`) — **в envelope, не в subject** (иначе взрыв subject-ов;
  фильтрация по тенанту — на потребителе + RLS).
- Версия в subject (`.v1`) — несовместимое изменение = `.v2`, старый потребитель жив.
- Потребители подписываются по wildcard: `contingent.>` (весь домен), `*.*.enrolled.v1`.

### Envelope (единый конверт события)
```json
{
  "id": "01J...ULID",                // = идемпотентный ключ (Nats-Msg-Id)
  "type": "contingent.student.enrolled.v1",
  "occurredAt": "2026-06-16T09:15:00Z",
  "organizationId": "org_123",       // тенант
  "correlationId": "01J...",         // весь каскад (один id на всю цепочку)
  "causationId": "01J...",           // событие/команда-причина (предыдущее звено)
  "depth": 0,                        // защита от петель: reject при depth > MAX
  "actor": "teacher-anna|system",
  "payload": { ... }                 // тонкое для ПД-чувствительных, иначе ECST
}
```

### Streams / consumers (JetStream)
- **Stream на доменную группу** (не 13 мелких и не 1 гигант): `OPERATIONAL`
  (`umk.>,staff.>,contingent.>`), `EVENTS`, `CORP`, `FACILITIES`
  (`space.>,property.>,nutrition.>,safety.>`), `COMMS`, `PREDICTIVE` (`iom.>,ikm.>`).
- **Durable consumer на каждую пару (параметр-потребитель × stream)** —
  независимые курсоры, изоляция отставаний/сбоев.
- **Exactly-once-ish:** publish с `Nats-Msg-Id = event.id` → dedup-окно стрима;
  + idempotent inbox на потребителе (двойная защита).
- **Доставка:** `AckExplicit`, `max_deliver = N`, при исчерпании → **DLQ subject**
  `dlq.<stream>`; ретраи с экспоненциальным backoff (`nak` с delay).

### Transactional Outbox (надёжность публикации)
```
BEGIN tx
  <доменная запись>                         // напр. INSERT Enrollment
  INSERT outbox_event(envelope)             // та же транзакция → атомарно
COMMIT
— отдельный диспетчер: poll outbox(PENDING) → publish(NATS, Msg-Id=id) → mark PUBLISHED
  (at-least-once; потеря исключена — событие зафиксировано вместе с данными)
```
CDC (Debezium) — апгрейд позже; на старте достаточно polling-publisher.

### Idempotency (inbox)
```
processed_event(event_id, consumer) PK
— handler: если (event_id, consumer) есть → skip; иначе run + INSERT в той же tx
```

### Partial failure в каскаде
- **Choreography изолирует:** падение одного потребителя не валит остальных
  (каждый — свой consumer/курсор). Упавшее → ретраи → DLQ → алерт.
- **Saga для «всё-или-ничего»** (мероприятие): шаги с **компенсациями**
  (`space.room.released`, `corp.payout.cancelled`); состояние саги — в БД параметра-оркестратора.
- **Stuck-recovery:** незавершённые саги/outbox дренируются фоновым reconciler-ом;
  ничего не теряется (outbox + saga state — источник истины).

### Защита от петель (A→B→A)
1. **`depth` + MAX_CASCADE_DEPTH** (напр. 12): шина отвергает событие глубже лимита → алерт.
2. **`causationId`/`correlationId`:** трейс всей цепочки; цикл виден и обрывается.
3. **Идемпотентность:** повторное событие не порождает повторную реакцию.
4. **Дисциплина «событие = факт, не команда»:** параметр реагирует на ЧУЖИЕ факты,
   но не дёргает чужой домен напрямую; решение «реагировать ли» — внутри потребителя.
5. **Команды отдельно от событий:** просьба «назначь ответственного» = `*.requested.v1`
   (адресная команда-событие), ответ = факт `*.assigned.v1` — поток однонаправлен.

### Контракты — версионирование и документация
- Схемы событий — **JSON Schema** в `packages/shared` (+ генерация TS-типов), реестр схем.
- **AsyncAPI**-спека на весь bus (кто что emit/consume) — живая карта каскадов.
- Обратная совместимость: только добавление полей в рамках `vN`; ломающее → `vN+1`.

---

## 4. Архитектура в коде (NestJS modulith)

```
apps/api/src/
├── common/                         # SHARED KERNEL (общее у всех параметров)
│   ├── identity/                   # florus_user_id, org/tenant, RBAC/ABAC
│   ├── events/                     # DomainEvent envelope, EventBus (in-proc|NATS), naming, depth-guard
│   ├── outbox/                     # OutboxService(enqueue в tx) + Dispatcher + ProcessedEvent(idempotency)
│   ├── cascade/                    # базовый Process Manager / Saga + reconciler
│   └── prisma/
├── parameters/                     # 13 ПАРАМЕТРОВ — по одному модулю
│   ├── umk/                        # (поверхность уже есть: журнал/ПП в modules/)
│   ├── contingent/  ├─ domain/  ├─ events/(контракты)  ├─ handlers/(подписки)  ├─ *.service.ts  ├─ *.controller.ts  ├─ *.module.ts
│   ├── staff/  ├── space/  ├── comms/  ├── corp/  ├── nutrition/
│   ├── safety/  ├── property/  ├── events-param/  ├── reputation/  ├── iom/  ├── ikm/
└── app.module.ts                   # импортирует common + parameters/*
```

**Правила (как в ADR-0001):**
- Параметры общаются **только событиями**. Прямые импорты сервисов и **FK между
  параметрами запрещены** — ссылки по `id`, данные — через события/read-model.
- Каждый параметр **владеет своей схемой** (Prisma multi-schema или префикс таблиц).
- Подписки: в `onModuleInit` параметр регистрирует обработчики в `EventBus`
  (обёрнутые идемпотентностью + depth-guard). Публикация: `OutboxService.enqueue(tx, event)`.
- **Shared kernel** не зависит от параметров; параметры зависят только от kernel.
- Новый параметр = папка `parameters/<name>` + строка в `app.module.ts` (как реестр разделов на фронте).

---

## 5. Приоритет реализации

**Фаза 0 — фундамент (есть частично):** shared kernel (identity/org/RBAC) + **event bus +
outbox + idempotency + depth-guard** + Communitoria-коннектор. Без этого каскады невозможны.

**Блокирующий анализ (что от чего зависит):**
- **Контингентный, Кадровый, Пространственный** — «кто/где»: их потребляют почти все.
  Строить первыми после фундамента.
- **Communitoria** — канал доставки большинства каскадов (уведомления).
- **Корпоративный (Юр+Бух)** — подпись/приказы/выплаты: ворота для Мероприятий и закупок.
- **УМК** — уже есть поверхность (журнал/ПП); достроить РП/КТП/ФОС/AI-слой.

**Минимальный набор для рабочей школы (MVP «ОС»):**
УМК + Контингентный + Кадровый + Журнал(УМК) + Communitoria + Пространственный-lite (бронь/кабинеты).
→ Покрывает каскад «новый ученик», «учитель заболел», ежедневный учебный цикл.

**Затем:** Питательный → Мероприятия (+ Корпоративный) → ИОМ → Безопасностный →
Имущественный → ИКМ → Репутационный.

**Последовательность сборки:** `event backbone → contingent → staff → space → comms →
corp → events → nutrition → iom → safety → property → ikm → reputation`.

---

## 6. Риски и слепые зоны

### 152-ФЗ (первоклассное ограничение, не «потом»)
- **Спецкатегория ПД** в Контингентном (`MedicalRestriction`, соцстатус) и сигналы ИОМ —
  это здоровье/чувствительное **о детях**. Нельзя нести в payload толстых событий.
  → **Тонкие события (Event Notification)** для таких доменов: событие несёт только id
  и тип, данные читаются по правам (психолог/мед — да, учитель — нет).
- **Каскадные согласия:** фото/видео (Мероприятия→Контингентный→Репутационный) — публикация
  только при `consent.collected`. Репутационный обязан проверять согласие перед `published`.
- **Право на удаление каскадно:** удаление ученика должно пройти по всем параметрам
  (или обезличить, кроме обязательной отчётности) — спроектировать `*.erasure.requested` сагу.
- **Аудит каждого кросс-параметрового потока ПД** (correlationId в audit-log). Данные — в РФ.

### Петли каскадов (конкретные)
- **Расписание↔Кадровый↔Пространственный:** смена нагрузки → пересчёт расписания → смена
  брони → … Лечится depth-guard + «событие-факт, не команда» + идемпотентностью.
- **Журнал→ИОМ→Communitoria→(?)→Журнал:** риск, если уведомление триггерит запись. Запрет:
  Communitoria только доставляет, ничего не пишет обратно в учебные домены.
- Общая защита: depth/TTL, correlation-трейс, идемпотентность, разделение команд и событий (§3).

### Что реально сложно (и почему)
1. **Мероприятия** — внешние API партнёров (часто без API → парсинг/коннекторы) + ИИ-детект
   событий + сага на ~15 доменов. Самый сложный параметр; строить как оркестратор с компенсациями.
2. **Юридика+Бухгалтерия** — юридическая корректность приказов и точность выплат/бюджета;
   высокая ответственность, нужен event-sourcing-аудит и human-approval (не автопилот).
3. **Безопасностный** (СЭС/пожарная/медзопуск) — регуляторика и жизнебезопасность; ошибки дороги.
4. **AI-слой УМК** — генерация в нормативном (ФГОС) контексте: галлюцинации недопустимы;
   нужен человек-в-контуре (методист утверждает) + проверяемость.
5. **Авторасписание (CSP)** — NP-трудная (см. аудит): solver-ассистент, не автопилот.

### Системный риск — «всё триггерит всё»
Видение «каждое действие → автокаскад через всю организацию» легко делает систему
**ненаблюдаемой и неуправляемой**. Митигаторы (обязательны):
- **Human-in-the-loop для высоких ставок** (деньги/юр/безопасность): ИИ **предлагает**
  каскад, человек **утверждает** (ТЗ это уже подразумевает — «утвердил план ИИ»). Сохранить.
- **Наблюдаемость каскадов:** распределённый трейс по `correlationId` (видеть всю цепочку).
- **Kill-switch на каскад/параметр** + **dry-run/preview** («что произойдёт, если...»).
- **Идемпотентность + depth-guard + DLQ** — чтобы сбой/петля не множились.

---

*Версия 1.0 · дополняется выводами research по аналогам.*
