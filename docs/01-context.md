---
id: SCHOOLIUM-CONTEXT
title: Schoolium context and boundaries
status: Draft
owner: Schoolium Architecture
last_reviewed: 2026-08-27
---

# Context

```text
User ──browser/app──> Schoolium ──OIDC / group API / webhooks──> Flōr IDP
                          │
                          └──> Schoolium workspace and permission store
```

| Counterparty | Direction | Protocol | Contract | Failure impact |
|---|---|---|---|---|
| User | inbound | HTTPS | Schoolium UI/API | Cannot work with a school workspace |
| Flōr IDP | outbound/inbound | OIDC, REST, signed webhook | `contracts/openapi.yaml`, `contracts/asyncapi.yaml` | New login and identity/group synchronisation fail; a valid access token remains usable only within its TTL |
| Schoolium data store | internal | database | Schoolium schema | Workspace and permission decisions are unavailable |

Schoolium never connects to the IDP database. Its integration boundary is the published protocol contract.
