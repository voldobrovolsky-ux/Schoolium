---
id: SCHOOLIUM-CHANGE
title: Schoolium change management
status: Draft
owner: Schoolium Architecture
last_reviewed: 2026-08-27
---

# Change management

- Update protocol contracts before dependent code.
- Use expand → migrate → contract for database changes; an irreversible change requires an Accepted ADR.
- Treat removal/rename, type narrowing, stricter validation, semantic changes, and response-code removal as breaking changes.
- Deprecate only with an Accepted ADR, `Deprecation`/`Sunset` signalling, identified consumers, and no remaining consumers in telemetry.
- Every feature flag needs an owner and planned removal date.

Any change to an IDP contract must remain compatible with the Tier 0 IDP change policy in `IDP-SPEC.md`.
