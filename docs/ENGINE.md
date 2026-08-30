# Образовательный движок (Phase 1) — статус и решения

Реализация по `EduStore_Движок_ТЗ` / `Архстандарт §7-§8` / `Техспека §2,§4` поверх Phase-0 kernel.

## Что сделано — движок ЗАКРЫТ (контур замкнут)
- **Пайплайн §7** (спина): `КТП.approve → Solver → КПП.scheduled → КПП.approve → гейт урока`.
  Два ритма РАЗДЕЛЬНЫ: `Timetable` (геометрия) + `Kpp` (план), мост `KppMapping`.
- **Solver §3** (детерминированный, 0 ИИ): раскладывает уроки тем КТП по слотам Timetable
  с учётом `fgosHours`; `409 INSUFFICIENT_SLOTS` при нехватке; `409 KPP_IN_USE` против деструктива.
- **Lesson FSM**: гейт `start` только при `kpp.approved` (иначе `409 LESSON_LOCKED`);
  `idle→running(t0)→done`; сигналы `lesson.started/phase.changed`.
- **ИОМ-аккумулятор §4**: mastery по `arCode`, `0.6·летучка+0.25·темы+0.15·присутствие`,
  `confidence=min(1,n/3)`, cold-start=unknown. Сигналы `attendance/topic.completed/assessment.checked`.
- **Петля летучки §5**: `BriefTest` FSM (generated→checked→done), гейт §3 (печать id→code,
  ингест ИОМ code→id), Tesseract-стаб (0 ИИ), `assessment.checked(code)` → ИОМ. Сканы НЕ в docs/.
- **Журнал §3**: `JournalCell` пишется ТОЛЬКО через `grade.posted` (явное действие, реальный id);
  `assessment.checked` в журнал НЕ пишет (§8). Летучка→done при выставлении оценки.
- **Персонализация §6**: `analytics/class` (atRisk низкий score+confidence / topicsReview),
  `ktp.shift.proposed` (предложение, БЕЗ авто-применения) → ждёт `ktp.approved`.
- **Тезис «предлагает→решает» enforced**: Solver→завуч, летучка→учитель, сдвиг→человек.
- **Контракты завуча/методиста** (входные слоты): AssessmentPolicy/OrgStandards/FgosHours (завуч),
  TimingProfile (методист) — GET/PUT с событиями, RBAC-разделение. Solver читает FgosHours+
  OrgStandards; журнал отдаёт `{cells, policy}`.
- **События** `edustore.*` на kernel-outbox; `/api/v1/edu/*`; RBAC-гейтинг по каталогу §5.1.

Критерии готовности Движок §9 закрыты (Solver/два ритма/ИОМ/петля-решение/0-ИИ-летучка).
Расширяемость 6 режимов — ModeNode/StateEdge на том же графе (структурно поддержано).

## Архитектурные решения (исходя из общей концепции кода)
- **PK = cuid**, не ULID (спека Техспека §0 просит ULID). Консистентно с kernel и всеми Phase-0
  таблицами; функционально эквивалентно для FK. Подтверждено владельцем. Обратимо.
- **Колонки camelCase** (Prisma), не snake_case (как в Техспеке). Консистентно с 20 Phase-0
  таблицами; переключение на snake_case — через `@map`, если потребуется.
- **Генерация КПП event-driven** (`ktp.approved` → `EngineHandlers` → Solver), как kernel-каскады
  (outbox). Исход виден в ответе `approve` (поле `kpp`). В распределённом будущем (NATS) консьюмер
  переедет без смены контракта.
- **Демо-разделение**: 8А·Алгебра — Phase-0 демо журнала (засеянные уроки+оценки); 9В·Геометрия —
  демо движка (уроки только из пайплайна, без дублей).

## Намеренные стабы v1 (помечены в коде)
- Solver учитывает только `fgosHours`; полные OrgStandards (спарки/физминутки/порядок) — стаб.
- Дата урока — термовая база `TERM_START + seq` (реальный календарь слот→дата по неделям — позже).
- ИОМ-затухание 60 дней — стаб (нужны per-signal timestamps).
- `topic.completed` обновляет mastery всем ученикам класса (экспозиция темы); индивидуальная
  «темы»-доля по присутствию — уточнение.

## RBAC route-gating (закрыто аудитом)
Каталог прав (§5.1) теперь **РЕАЛЬНО гейтит**: `PermissionGuard` (APP_GUARD после AuthGuard) +
`@RequirePermission(code)`. На мутациях движка: `approve` КТП/КПП → `planning.*.approve` (завуч),
`conduct` (start/phase/complete/attendance/topic-*) → `lesson.conduct` (учитель). Reads открыты
(tenant-изоляция). DEV: `x-florus-role`/`x-florus-subrole` переопределяют роль для тестов.
Разделение обязанностей enforced: учитель не утвердит, завуч не проведёт. Legacy `/api/<module>`
покроется при ребилде кабинетов (паттерн готов).

## Известные дыры (закрыть отдельными инкрементами)
- **REST-версионирование**: движок на `/api/v1/edu` (по спеке §2); legacy Phase-0 кабинеты — на
  `/api/<module>`. Унификация при ребилде кабинетов под `Кабинеты_ТЗ` (edu/-префикс).
- **TimingProfile → Lesson FSM** и **полное применение OrgStandards в Solver** (спарки/физминутки/
  порядок) — слоты заведены и читаются (FgosHours валидируется, lessonLengthMin доступен),
  но тайминг-пороги/констрейнты в FSM/Solver ещё не применяются.
- **ContentFilters/Methodics** (методист, `standards.updated` content/template, `GET edu/methodics`) —
  ещё не реализованы (Кабинеты_ТЗ).
- **ai-query** (`analytics/ai-query`, гейт id→code на ИИ-границе §3 «граница 2») — отдельный
  слот (нужен LLM); срез ИОМ/analytics сейчас только для UI учителя (реальные имена).
- `Workspace.sector` (§3.7) заведён, но ветвление 152-ФЗ §6.5 пока не читает.
