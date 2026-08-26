---
id: SCHOOLIUM-RUNTIME
title: Schoolium runtime behaviour
status: Draft
owner: Schoolium Architecture
last_reviewed: 2026-08-27
---

# Runtime

## User login

1. Schoolium redirects the user to IDP `/authorize` using Authorization Code + PKCE.
2. It exchanges the authorization code, validates `iss`, `aud`, `exp`, `nonce`, and the JWT signature against cached JWKS.
3. `sub` becomes `identity_id`; Schoolium loads matching `WorkspaceMembership` records.
4. Schoolium chooses the workspace and evaluates its own permission catalogue. No IDP group relation grants access.

## Workspace lifecycle

| From | Event | To | Data action | Side effects |
|---|---|---|---|---|
| — | school creation | `creating` | create Workspace | audit request |
| `creating` | moderator assigned | `created` | create WorkspaceMembership | notify moderator |
| `created` | delete request | `deleted` | apply product retention policy | revoke Schoolium access |

| State | Exit | User return path | Terminal |
|---|---|---|---|
| `creating` | moderator assignment | setup screen | no |
| `created` | delete request | workspace UI | no |
| `deleted` | none | unavailable | yes; retention semantics must be specified by Schoolium |

## Family linking

Schoolium may read an IDP group only when its client is in the group's `audience`. It then applies Schoolium policy separately before disclosing child-related data. The exact cross-workspace disclosure policy is an open product decision and is listed in [risks.md](risks.md).
