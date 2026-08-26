---
id: SCHOOLIUM-CONTAINERS
title: Schoolium containers and dependencies
status: Draft
owner: Schoolium Architecture
last_reviewed: 2026-08-27
---

# Containers

| Container | Responsibility | Technology | Dependencies |
|---|---|---|---|
| Schoolium application | UI, workspace lifecycle, authorization | To be selected | IDP OIDC and group APIs |
| Schoolium database | Workspaces, `WorkspaceMembership`, permission catalogue | To be selected | Application only |
| Flōr IDP | identity, sessions, tokens, groups | Separate Tier 0 service | PostgreSQL, session store, confirmation channel |

## Dependency rules

1. Schoolium domain code does not import IDP storage or implementation types.
2. The OIDC adapter returns a stable `identity_id` and validated claims; it does not make permission decisions.
3. `WorkspaceMembership` owns Schoolium roles and permissions. IDP `Membership` is a different entity and cannot be used for authorization.
4. Product code validates IDP-issued JWTs locally using cached JWKS and never introspects every request.
