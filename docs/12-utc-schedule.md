---
id: SCHOOLIUM-UTC-SCHEDULE
title: УТЦ — schedule block and the завуч/moderator cabinet
status: Draft
owner: Schoolium Architecture
last_reviewed: 2026-08-27
---

# УТЦ · Schedule block and cabinet

> Decision record: [ADR-0013](decisions/ADR-0013-utc-schedule-cabinet-scope.md).
> Reference model: `src/schoolium/schedule/model/quality.model.mjs`, ported
> byte-for-byte from
> `voldobrovolsky-ux/EduStore@claude/schedule-engine-implementation-utc:specs/schedule-block/model/quality.mjs`
> and re-verified standalone in this repository. Code prompt for a fresh
> implementation session — [`13-utc-code-prompt.md`](13-utc-code-prompt.md).
>
> This document ports the proven specification from EduStore, adapted to
> Schoolium's real stack (Fastify + `pg`, raw-SQL migrations, `vitest`) and to
> the role split the owner set on 2026-08-27: **администратор школы** holds
> global tenant rights; **модератор** holds narrow product roles, schedule
> configuration among them; **завуч** owns academic content and feeds the
> engine, but does not run it.

## 1. Scope

УТЦ is one product surface with two halves that cannot be separated, because
one is the input to the other:

1. **Cabinet inputs** (завуч сеттинги, модератор запускает): annual hours per
   subject×class, subject priority (1…6), pairing level (1…6, derived from
   annual hours — §5.3), methodical day and methodical groups, day skeleton
   (bell schedule).
2. **Schedule engine**: generation, self-check against hard invariants,
   local-search improvement, manual correction, and snapshot export.

Out of scope for this pass (name them, do not invent behaviour for them):
labour norms (обед, окна на отдых, предельная занятость — belong to HR, not
this block), CP-SAT solver, simulated annealing, room scheduling, PDF/XLSX
server rendering, individual lesson swaps after materialization, a
difficulty-weighted subject scale for the week-shape rule.

## 2. Roles and boundary

Extends `WorkspaceRole` in `src/schoolium/workspaces.ts`:

| Role | Change | Rationale |
|---|---|---|
| `admin` | **new** — global, whole-tenant rights | ADR-0013; splits the old "moderator has everything" shape |
| `moderator` | narrowed to product-local roles; schedule configuration is one | ADR-0013 |
| `deputy_academic` (завуч) | **new** — owns academic content: annual plan, priorities, pairing, methodical decisions | not present in `WorkspaceRole` today; this block is the first consumer |

`PERMISSIONS` in `workspaces.ts` gains:

```
admin: [...existing moderator permissions, "workspace:admin"]
moderator: ["schedule:configure", "schedule:generate", "schedule:confirm", "schedule:share"]
deputy_academic: ["curriculum:manage", "schedule:read"]
```

Завуч edits curriculum and annual hours; only модератор triggers generation
and confirms. Both can read the result.

## 3. Data model (new; nothing below exists in Schoolium today)

All tables live in schema `schoolium`, follow the existing convention in
`src/infrastructure/migrate.ts` (raw `CREATE TABLE IF NOT EXISTS`, `uuid`
primary keys, `CHECK` constraints instead of enums), and carry
`workspace_id uuid NOT NULL REFERENCES schoolium.workspace(id)` on every table
— there is no tenant-filtering middleware here yet, so every query in the
service layer must filter by `workspace_id` explicitly.

```sql
CREATE TABLE IF NOT EXISTS schoolium.calendar_term (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES schoolium.workspace(id),
  date_from date NOT NULL,
  date_to date NOT NULL,
  UNIQUE (workspace_id, date_from)
);

CREATE TABLE IF NOT EXISTS schoolium.school_class (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES schoolium.workspace(id),
  label text NOT NULL,
  parallel int NOT NULL CHECK (parallel BETWEEN 1 AND 11),
  group_count int NOT NULL DEFAULT 1 CHECK (group_count >= 1)
);

-- One row per (subject × class): the "subject card" in the cabinet. Priority
-- and pairing are properties of the SUBJECT IN THIS CLASS, not of any one
-- teacher — both stay here even when the subject below is split by group.
CREATE TABLE IF NOT EXISTS schoolium.school_subject (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES schoolium.workspace(id),
  name text NOT NULL,
  class_id uuid NOT NULL REFERENCES schoolium.school_class(id),
  year_hours int NOT NULL CHECK (year_hours > 0),
  priority int NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 6),
  pairing int NOT NULL DEFAULT 5 CHECK (pairing BETWEEN 1 AND 6), -- derived default, §5.3; editable
  UNIQUE (workspace_id, name, class_id)
);

-- One row per (subject × teacher-or-group): the cabinet's central input for
-- WHO teaches it. `scope = 'class'` covers the whole class in one row;
-- `scope = 'group'` needs one row PER GROUP, because groups of the same
-- subject can have DIFFERENT teachers — the exact case the reference model
-- (quality.model.mjs, buildUnits) proves its properties on: "8 параллелей,
-- английский по группам". A UNIQUE on (subject_id, group_no) — NOT on
-- (class_id, subject_id) alone — is what makes that representable; the
-- single-row-per-subject shape tried first here could not express it and
-- was caught by re-checking against EduStore's real schema
-- (`TeacherBinding`, apps/api/prisma/schema.prisma:1307) before any code
-- was written against it.
CREATE TABLE IF NOT EXISTS schoolium.teacher_binding (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES schoolium.workspace(id),
  subject_id uuid NOT NULL REFERENCES schoolium.school_subject(id),
  teacher_identity_id uuid,              -- NULL = uncovered (COVER_MODE candidate, §5.5)
  scope text NOT NULL CHECK (scope IN ('class', 'group')),
  group_no int,                          -- NULL when scope = 'class'; 1..N when 'group'
  hours_per_week int NOT NULL CHECK (hours_per_week > 0), -- may differ from year_hours/weeks if this group's load differs
  methodical_day int,                    -- 0..4, nullable — per teacher, not per subject
  UNIQUE (workspace_id, subject_id, scope, group_no)
);

CREATE TABLE IF NOT EXISTS schoolium.day_skeleton (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES schoolium.workspace(id),
  name text NOT NULL,
  days int[] NOT NULL,                   -- 0=Monday
  parallels int[] NOT NULL DEFAULT '{}', -- empty = whole school
  start_time text NOT NULL,              -- 'HH:MM'
  lesson_min int NOT NULL,
  break_min int NOT NULL,
  big_break_after int NOT NULL,
  big_break_min int NOT NULL,
  positions int NOT NULL
);

CREATE TABLE IF NOT EXISTS schoolium.schedule_template (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES schoolium.workspace(id),
  status text NOT NULL CHECK (status IN ('draft', 'repaired', 'confirmed', 'stale')),
  seed bigint NOT NULL,
  penalty int,
  penalty_floor int,
  version int NOT NULL DEFAULT 1,
  generated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);

CREATE TABLE IF NOT EXISTS schoolium.schedule_slot (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES schoolium.workspace(id),
  template_id uuid NOT NULL REFERENCES schoolium.schedule_template(id) ON DELETE CASCADE,
  day_no int NOT NULL,
  slot_no int NOT NULL,
  class_id uuid NOT NULL REFERENCES schoolium.school_class(id),
  group_no int NOT NULL DEFAULT 0,
  subject_id uuid NOT NULL REFERENCES schoolium.school_subject(id),
  teacher_identity_id uuid,
  origin text NOT NULL DEFAULT 'generated' CHECK (origin IN ('generated', 'repaired', 'manual')),
  UNIQUE (workspace_id, template_id, day_no, slot_no, class_id, group_no)
);

-- §5.4: hour debt is one value, three causes.
CREATE TABLE IF NOT EXISTS schoolium.hour_debt (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES schoolium.workspace(id),
  class_id uuid NOT NULL REFERENCES schoolium.school_class(id),
  subject_id uuid NOT NULL REFERENCES schoolium.school_subject(id),
  on_date date NOT NULL,
  reason text NOT NULL CHECK (reason IN ('holiday', 'manual', 'teacher_left')),
  debt_hours int NOT NULL
);

-- §5.5: cover mode, four weeks from deactivation.
CREATE TABLE IF NOT EXISTS schoolium.cover_mode (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES schoolium.workspace(id),
  class_id uuid NOT NULL REFERENCES schoolium.school_class(id),
  subject_id uuid NOT NULL REFERENCES schoolium.school_subject(id),
  former_teacher_identity_id uuid NOT NULL,
  since timestamptz NOT NULL DEFAULT now(),
  weeks_total int NOT NULL DEFAULT 4
);
```

## 4. The invariant/quality contract (unchanged math, new home)

The mathematical core is not re-derived: it is proven on the EduStore side
(97 gate assertions there, `model/quality.mjs` green on Q1…Q12) and ported
as-is. What changes is only the language it is embedded in.

- **Hard invariants I-1…I-8** (admissibility: no double-booking, no gaps in a
  class day, SanPiN caps, atomic paired-group units) — port
  `invariants()`/`unitsFromSlots()` from the EduStore source
  (`apps/api/src/schoolium/schedule/quality.ts`) into
  `src/schoolium/schedule/quality.ts` here, TypeScript unchanged in substance,
  only the import graph changes (no NestJS DI, no Prisma types — plain
  functions over the `schedule_slot` rows read via `pg`).
- **Seven comfort rules and their weights** — `prio: 8, subjectSpread: 6,
  dayBalance: 5, stability: 4, teacherBalance: 3, groupEdge: 2, firstLast: 2`.
  An eighth rule, "teacher gap", was tried and removed on the EduStore side
  (owner: labour norms are HR's, not schedule's) — **do not reintroduce it**.
- **Analytic lower bound** `Π_LB` and the **ceiling** shown next to the
  aggregate — a bare percentage without a ceiling cannot be read (this is the
  lesson from the EduStore owner's *«то есть качество продукта 50% от
  эталонного?»* question). Always show both.
- **Local-search repair**: greedy generation to first admissible grid, then
  strict-decrease local search to a local minimum. Measured on the EduStore
  reference school (8 classes, 112 hours): `Π` 2080 → 1128 in 25 moves,
  `Π_LB = 632`, aggregate 75.3% → 85.9% at a 95.8% ceiling.

## 5. Three mechanics ported from AR-144…AR-148

### 5.1 The annual plan is law for generation (AR-144)

Automatic generation **never** reports a divergence from the annual plan —
if a weekly layout does not fit the annual hours, that is a reason not to
emit the grid, not a warning. The only place a divergence is ever named is
after a **manual** edit, and the text says so explicitly.

### 5.2 Hours are made up, never silently lost (AR-145)

One value for all three cases: `debt = planned_on_date − held_on_date`.
Negative = ahead, zero = even, positive = owed. Instead of "a lesson
vanished", the system names a concrete day and slot next week where the hour
is added (`hour_debt` table, reason column carries why).

### 5.3 Pairing level is derived from annual hours (AR-147)

```js
// h = weekly hours (year_hours / weeks), d = teaching days per week
const forcedDays = Math.max(0, h - d);
const share = (2 * forcedDays) / h;           // fraction of hours forced into pairs
const want = 1 - share;
// pick the level whose tolerance (1:0, 2:0.2, 3:0.4, 4:0.6, 5:0.8) is closest to `want`
```

At 5 teaching days: 1…5 h/week → level 5, 6 h → 4, 7 h → 3, 8…9 h → 2, ≥10 h
→ 1. Level 6 ("forbidden") is **never derived** — hand-set only, or from the
1st-grade rule. The derived value is a default the завуч can override, not a
lock.

### 5.4 Cover mode: four weeks after a teacher leaves (AR-146)

When a teacher's `WorkspaceMembership` is deactivated (not deleted — a
teacher with taught history is never deleted), their subject is pulled from
the grid, freed slots are filled by the class's remaining subjects through
the same search that builds the grid (no gaps, `I-5` holds), and debt
accrues with reason `teacher_left`. Four weeks (`cover_mode.weeks_total`) is
the named window to find a replacement; past it, the system names the
accumulated debt and hands the school a choice — assign a teacher or change
the plan — **it never decides for the school**.

## 6. Cabinet parameter registry (16 parameters, 5 steps — unchanged from EduStore)

Ported without renumbering from EduStore `specs/schedule-block/35-parameters.md`.
Five steps: **Нагрузка** (annual→weekly hours, read-only derivation),
**Приоритет предмета** (1…6, repeatable, weight `32/16/8/4/2/1`),
**Спаренность** (derived, §5.3), **Педагоги: методическая работа**
(methodical day, methodical groups), **Глубина поиска** (Быстрый/Стандартный/
Тщательный — variant counts 5/30/200, never seconds shown to the user).

Vocabulary discipline carries over unchanged: no "штраф", "вес", "маркер",
"инверсия", "свёртка", "агрегат", "локальный", "релаксация", "эвристика",
"окрестность" in anything a human reads — screens, refusal texts, or this
document's own prose above the code blocks.

## 7. No `NO_SOLUTION`

Every refusal has an address, a name, and either an arithmetic explanation
(computed before search) or a suggested action (a relaxation-diagnosis pass
that drops requirements one at a time and reports which removal made the grid
buildable — *"Расписание собирается, если перенести методический день Марии
Ивановны со вторника на четверг. Перенести?"*).

## 8. API surface (Fastify, follows `workspaces.ts` conventions)

| Route | Method | Permission | Notes |
|---|---|---|---|
| `/workspaces/:id/curriculum` | `PUT` | `curriculum:manage` | завуч sets annual hours, priority, pairing per subject×class |
| `/workspaces/:id/schedule/generate` | `POST` | `schedule:generate` | модератор only |
| `/workspaces/:id/schedule/preview` | `GET` | `schedule:read` | |
| `/workspaces/:id/schedule/confirm` | `POST` | `schedule:confirm` | |
| `/workspaces/:id/schedule/quality` | `GET` | `schedule:read` | aggregate + ceiling + seven rules |
| `/workspaces/:id/schedule/move` | `POST` | `schedule:configure` | manual correction, `MOVE_DEGRADES` needs `confirm: true` |
| `/workspaces/:id/schedule/debt` | `GET` | `schedule:read` | §5.2 |
| `/workspaces/:id/schedule/cover-mode` | `GET` | `schedule:read` | §5.4 |
| `/workspaces/:id/schedule/share` | `POST` | `schedule:share` | signed link, admin or moderator only |

## 9. Fitness functions (`test/utc/*.test.ts` — the equivalent of EduStore's G-checks)

| ID | Rule |
|---|---|
| FF-U1 | `invariants()` never lets a grid with a broken `I-1…I-8` reach the database |
| FF-U2 | Automatic generation never emits a `plan divergence` refusal — only a manual edit can |
| FF-U3 | `pairingFromLevel` is monotone in weekly hours and never derives level 6 |
| FF-U4 | Deactivating a teacher with taught history starts cover mode, not deletion |
| FF-U5 | Every refusal text carries an address and a concrete number, never a placeholder |
| FF-U6 | No screen or refusal text contains a JARGON substring (§6 list) |
| FF-U7 | `admin` and `moderator` are distinct permission sets; `schedule:generate` is absent from `deputy_academic` |

These are acceptance gates for the code prompt in
[`13-utc-code-prompt.md`](13-utc-code-prompt.md) — write them as `vitest`
files under `test/utc/`, run with `npm test`.
