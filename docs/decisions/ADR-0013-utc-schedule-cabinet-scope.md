---
id: ADR-0013
title: УТЦ (schedule block) and the завуч/moderator cabinet live in Schoolium
status: Accepted
date: 2026-08-27
owner: Schoolium Architecture
---

## Context

Schedule generation, quality scoring, manual correction, and the annual-plan
inputs it depends on (годовые часы, приоритет, спаренность, скелет дня) were
first built out on the `EduStore` repository, under
`voldobrovolsky-ux/EduStore@claude/schedule-engine-implementation-utc`. That
work produced a proven specification and a partially wired NestJS+Prisma
implementation.

`EduStore` is the marketplace/billing platform, not the school ERP — see its
own `docs/PRODUCT-LOGIC.md`. **Schoolium is the ERP.** School-domain features,
schedule included, belong here, not on the marketplace repository.

Schoolium today has no domain model beyond `Workspace` /
`WorkspaceMembership` (`src/schoolium/workspaces.ts`) — no classes, subjects,
teachers, or calendar. The schedule engine cannot be transplanted as-is: it
must be rebuilt against this repository's actual stack (Fastify + `pg`,
migrations as raw SQL in `src/infrastructure/migrate.ts`, tests in `vitest`
under `test/`), not copied from the NestJS+Prisma source.

## Considered options

1. Leave schedule generation on EduStore and have Schoolium call it as an
   external service.
2. Wait until Schoolium's IDP integration (N1…N8 in `risks.md`) is fully
   resolved before starting any product-domain work here.
3. Build УТЦ (the schedule block) directly in Schoolium now, scoped to
   include the minimal завуч/moderator cabinet inputs it depends on, using
   the EduStore work as a proven specification rather than as code to paste in.

## Decision

**Option 3.** УТЦ is the schedule block **plus** the cabinet slice that feeds
it: annual hours per subject×class, priority, pairing, methodical-day
settings, and the day skeleton. The product owner's words: *«части кабинета
будут частью УТЦ»* — the cabinet is not a separate module bolted on later,
it is the input surface of this same block.

Role split (owner's decision, 2026-08-27): **администратор школы** holds
global, whole-tenant rights; **модератор** holds narrow product roles, and
schedule configuration is one of them. Завуч owns the academic content
(учебный план, годовые часы, методические решения); the schedule engine
reads what завуч sets and модератор triggers generation.

This does **not** wait on N1…N8: those risks are about identity delivery
channels, confirmation mechanisms, and deletion — none of them gate a
schedule/annual-plan domain that only needs an `identityId` string and a
`workspaceId`, both of which already exist.

The full specification, ported and adapted for this repository's stack, is
[`12-utc-schedule.md`](../12-utc-schedule.md). The proven mathematical model
lives at `src/schoolium/schedule/model/quality.model.mjs`, copied byte-for-byte
from the EduStore source and re-verified standalone in this repository.

## Consequences

- Schoolium gains its first real domain tables: `schoolium.school_class`,
  `schoolium.school_subject`, `schoolium.teacher_binding`,
  `schoolium.calendar_term`, `schoolium.day_skeleton`,
  `schoolium.schedule_template`, `schoolium.schedule_slot`,
  `schoolium.hour_debt`, `schoolium.cover_mode`. `school_subject` and
  `teacher_binding` are two tables, not one — the first draft collapsed them
  and could not represent a subject taught to different groups by different
  teachers, the reference model's own primary scenario ("английский по
  группам"); caught and fixed against EduStore's real `TeacherBinding`
  schema before any code was written against it.
- The role enum in `workspaces.ts` gains `admin` distinct from `moderator`
  (AR-148 on the EduStore side; here it is the same decision, applied fresh).
- EduStore's `claude/schedule-engine-implementation-utc` branch remains the
  historical record of the specification work and stays where it is; it is
  not merged into EduStore's product code, and no further schedule-engine
  work is expected to land there.

## Enforcement

`test/utc/*.test.ts` — the fitness-function suite named in
[`12-utc-schedule.md`](../12-utc-schedule.md) §9 — proves the invariants,
quality layer, and cabinet contract on this repository's actual code, the
same way the EduStore gates did on theirs.
