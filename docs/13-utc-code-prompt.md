---
id: SCHOOLIUM-UTC-CODE-PROMPT
title: Code prompt — build УТЦ (schedule block + cabinet)
status: Draft
owner: Schoolium Architecture
last_reviewed: 2026-08-27
---

# Code prompt — УТЦ

> Copy this whole file into a fresh Claude Code window on
> `voldobrovolsky-ux/schoolium`, branch `feat/utc-schedule-cabinet`.
>
> ```bash
> git fetch origin feat/utc-schedule-cabinet
> git checkout feat/utc-schedule-cabinet
> ls docs/12-utc-schedule.md docs/decisions/ADR-0013-utc-schedule-cabinet-scope.md \
>    src/schoolium/schedule/model/quality.model.mjs
> ```
>
> If any of those three paths is missing, you are on the wrong branch — do
> not recreate them from memory, switch branches first.

## What you are building

The schedule block (УТЦ) and the cabinet slice that feeds it, inside
Schoolium — the actual school ERP. This is **not** a port of NestJS/Prisma
code: Schoolium runs Fastify + `pg` + `vitest`, no ORM, no DI container.
Follow the existing shape of `src/schoolium/workspaces.ts` and
`src/schoolium/app.ts` — a plain service class holding logic, a thin Fastify
layer translating HTTP to it, raw SQL for persistence.

## Read first, in this order

1. [`12-utc-schedule.md`](12-utc-schedule.md) — the full specification: scope,
   roles, schema, the ported math contract, the three AR-144…AR-148
   mechanics, the parameter registry, the API surface, the fitness functions.
2. [`decisions/ADR-0013-utc-schedule-cabinet-scope.md`](decisions/ADR-0013-utc-schedule-cabinet-scope.md)
   — why this lives here and not on EduStore.
3. `src/schoolium/schedule/model/quality.model.mjs` — run it
   (`node src/schoolium/schedule/model/quality.model.mjs`) before touching
   anything. It must print `✅ Q1…Q12 — зелёные.` This is your ground truth
   for the math: penalties, invariants, the lower bound, local search. Do not
   re-derive the formulas — port the logic from this file into TypeScript.
4. `src/schoolium/workspaces.ts` and `test/schoolium-workspaces.test.ts` —
   the only existing precedent for how a service/route/test triad looks here.
5. `src/infrastructure/migrate.ts` — the only precedent for schema. Note it
   defines tables but `WorkspaceService` itself is **still in-memory** — your
   work is the first domain code in this repo to actually read/write
   Postgres. Do not copy the in-memory pattern; use `pg` directly.
6. `docs/risks.md` — confirms N1…N8 do not block this work (identity
   delivery/confirmation/deletion concerns, none of which this domain
   touches beyond an opaque `identityId`).

## Order of work

### Stage 1 — schema and role split

- Add the eight `CREATE TABLE IF NOT EXISTS` statements from
  `12-utc-schedule.md` §3 to the `migrations` array in
  `src/infrastructure/migrate.ts`, in dependency order (calendar_term and
  school_class/school_subject before teacher_assignment, before
  schedule_template/schedule_slot, before hour_debt/cover_mode).
- Extend `WorkspaceRole` in `workspaces.ts` with `admin` and
  `deputy_academic`; update `PERMISSIONS` per §2. **Do not remove existing
  roles or their permissions** — `super_admin`, `director`, `psychologist`,
  `teacher`, `parent`, `student` all stay as they are.
- `npm test` must stay green — the existing `schoolium-workspaces.test.ts`
  exercises the role/permission map directly; a mis-keyed `PERMISSIONS`
  object breaks it immediately.

### Stage 2 — cabinet: curriculum and annual hours

- A `CurriculumService` (new file, `src/schoolium/schedule/curriculum.ts`)
  over `pg`: CRUD on `teacher_assignment` scoped by `workspace_id`, deriving
  `pairing` from `year_hours` via the formula in §5.3 when not explicitly
  set by hand (track "hand-set" with a boolean column if you need it — name
  the decision in your report if you add one, this is a small addition to
  the schema in §3, not a deviation from it).
- Route `PUT /workspaces/:id/curriculum`, permission `curriculum:manage`.
- Test: FF-U3 (monotone, level 6 never derived) and FF-U7 (permission
  separation) as `vitest` files under `test/utc/`.

### Stage 3 — engine core: port the math

- Port `invariants()`, `unitsFromSlots()`, `penalties()`, `lowerBound()`,
  `repair()` from `quality.model.mjs` into
  `src/schoolium/schedule/quality.ts` as TypeScript, operating on
  `schedule_slot` rows shaped like the model's `SlotRow`. Keep the seven
  weights **exactly** as named in §4 — do not add an eighth rule, do not
  change a weight without a property-based justification in your report.
- Generation: greedy placement to first admissible grid (reuse the model's
  `generate()` logic, adapted for the real schema — subjects/classes/teacher
  assignments come from `teacher_assignment`, not a synthetic fixture), then
  `repair()` runs before the template is ever written to
  `schedule_template`/`schedule_slot`. **Order matters**: check invariants,
  then improve, then write — never write an unchecked grid.
- Route `POST /workspaces/:id/schedule/generate`, permission
  `schedule:generate`.
- Test: FF-U1 (no broken grid reaches the database) — corrupt an admissible
  grid five ways (one per relevant invariant) and confirm each is caught,
  the same technique as the EduStore gate G-57.

### Stage 4 — plan-is-law and hour debt (AR-144, AR-145)

- Automatic generation never writes a "plan diverges" message — enforce this
  as FF-U2: assert the refusal vocabulary of the generate path contains no
  divergence text, ever, regardless of input.
- `hour_debt` writes: on a missed lesson (holiday from `calendar_term` gaps,
  or a manual edit), compute `debt = planned − held` and insert a row naming
  the reason. A follow-up ticket, not this stage, wires the make-up-slot
  suggestion to the actual calendar; for this stage it is enough that the
  value and the reason are recorded correctly and the route
  `GET /workspaces/:id/schedule/debt` reads it back.

### Stage 5 — cover mode (AR-146)

- Listen for a `WorkspaceMembership` status change to `revoked` for a role
  holding a `teacher_assignment` row with taught history (a
  `schedule_slot.origin` referencing them, or — simplest for this stage — any
  row in `teacher_assignment` with that `teacher_identity_id`). On that
  transition: insert a `cover_mode` row, null out `teacher_assignment.teacher_identity_id`
  for that subject×class, and re-run the fill-the-freed-slots pass (same
  search as generation, restricted to that class's remaining subjects).
- Route `GET /workspaces/:id/schedule/cover-mode`.
- Test: FF-U4.

### Stage 6 — manual correction, quality readout, share

- `POST /workspaces/:id/schedule/move` — mirrors EduStore's `MOVE_REJECTED` /
  `MOVE_DEGRADES` contract from `12-utc-schedule.md` §4: a move breaking a
  hard invariant is rejected outright; a move that degrades `Π` requires
  `confirm: true` in the body and names which of the seven rules got worse
  and by how much.
- `GET /workspaces/:id/schedule/quality` — aggregate, ceiling from
  `lowerBound()`, all seven rules by name. Never show a percentage without
  the ceiling next to it (§4 — this was a direct correction of a real
  misreading on the EduStore side, do not reintroduce it).
- `POST /workspaces/:id/schedule/share` — signed link (HMAC over the
  snapshot, scope, target, expiry — port `signSnapshot`/`scopeSlots` logic
  from the EduStore source if you have read access to it, otherwise write it
  fresh against the same contract described in `12-utc-schedule.md` §8).

## Vocabulary discipline (FF-U6)

No occurrence, anywhere a human reads text (route response bodies meant for
screens, refusal messages, this document's own prose), of: "штраф", "вес",
"маркер", "инверсия", "свёртка", "агрегат", "локальный", "релаксация",
"эвристика", "окрестность". Inside code (variable/function names) these are
fine. Write a small `test/utc/vocabulary.test.ts` that greps your own new
source files for these substrings in string literals and fails if found —
this is FF-U6.

## What you do not do

Labour norms (обед, окна на отдых, предельная занятость), CP-SAT or
simulated-annealing solvers, room scheduling, server-rendered PDF/XLSX,
individual lesson swaps after materialization (there is no "materialization"
concept yet in this repository — journal/lesson-instance tracking is a later
block, not this one), a difficulty-weighted subject scale, dark mode.

## Report format

After each stage:

```
Stage: <1..6> — <name>
Changed: <exact paths>
Tests: npm test — <pass/fail count>
Open: <what's left and why>
Next: <stage>
```

Do not call a stage done with a red `npm test`. If N1…N8 or another IDP risk
turns out to actually block something in this domain (it should not — say
so explicitly and stop rather than inventing behaviour for it, per
`docs/risks.md`'s own rule: *"No implementation may invent behaviour for
these items."*
