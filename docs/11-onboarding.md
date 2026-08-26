---
id: SCHOOLIUM-ONBOARDING
title: Schoolium developer onboarding
status: Draft
owner: Schoolium Architecture
last_reviewed: 2026-08-27
---

# Developer onboarding

The repository contains a development-only TypeScript runtime: IDP OIDC discovery on port 4000, IDP group API on port 4001, and Schoolium API on port 3000.

Before starting implementation, a developer must:

1. Read [index.md](index.md), [03-runtime.md](03-runtime.md), and [06-security.md](06-security.md).
2. Confirm all IDP open nodes in [risks.md](risks.md) are accepted or obtain an explicit ADR for an exception.
3. Run `npm install`, `npm test`, then `npm run dev:idp` and `npm run dev:schoolium` in separate terminals.
4. Implement against the published contracts, never against IDP storage.
5. Add the applicable fitness functions from [09-testing.md](09-testing.md) to CI in the same change.
