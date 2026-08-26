---
id: SCHOOLIUM-DATA
title: Schoolium data and PII boundary
status: Draft
owner: Schoolium Architecture
last_reviewed: 2026-08-27
---

# Data

| Entity/data | System of record | Classification | Boundary rule |
|---|---|---|---|
| `identity_id` | Flōr IDP | internal identifier | Stored as an opaque external reference; never replaced by a local account |
| Identity profile and credentials | Flōr IDP | personal / sensitive | Schoolium reads only claims authorised by scope |
| `Workspace` | Schoolium | product data | IDP has no tenant representation |
| `WorkspaceMembership` | Schoolium | product access data | Role and status are evaluated only by Schoolium |
| IDP Group/Membership | Flōr IDP | relationship data | May inform a Schoolium policy; never confers rights directly |

Schoolium's detailed field-level PII inventory, retention periods, legal basis, and deletion procedures are not supplied in the current materials and remain a product-owned blocker.
