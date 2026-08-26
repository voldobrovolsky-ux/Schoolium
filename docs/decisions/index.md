---
id: SCHOOLIUM-ADR-INDEX
title: Architecture decision register
status: Draft
owner: Schoolium Architecture
last_reviewed: 2026-08-27
---

# Architecture decision register

| ADR | Title | Status | Date |
|---|---|---|---|
| [ADR-0001](ADR-0001-authorization-code-pkce.md) | Use Authorization Code with PKCE | Proposed | 2026-08-27 |
| [ADR-0002](ADR-0002-refresh-token-rotation.md) | Rotate refresh tokens and detect reuse | Proposed | 2026-08-27 |
| [ADR-0003](ADR-0003-argon2id.md) | Store passwords with Argon2id | Proposed | 2026-08-27 |
| [ADR-0004](ADR-0004-hot-cold-path.md) | Separate hot and cold data paths | Proposed | 2026-08-27 |
| [ADR-0005](ADR-0005-product-authorization-boundary.md) | Keep product authorization out of IDP | Proposed | 2026-08-27 |
| [ADR-0006](ADR-0006-generic-groups.md) | Model groups as opaque relationship containers | Proposed | 2026-08-27 |
| [ADR-0007](ADR-0007-no-group-tenant.md) | Do not bind IDP groups to tenants | Proposed | 2026-08-27 |
| [ADR-0008](ADR-0008-group-audience.md) | Restrict group visibility by audience | Proposed | 2026-08-27 |
| [ADR-0009](ADR-0009-confirmation-mechanism.md) | Use a common confirmation mechanism | Proposed | 2026-08-27 |
| [ADR-0010](ADR-0010-crypto-shredding.md) | Delete identity data through crypto-shredding | Proposed | 2026-08-27 |
| [ADR-0011](ADR-0011-admin-webauthn.md) | Require phishing-resistant admin authentication | Proposed | 2026-08-27 |
| [ADR-0012](ADR-0012-defer-advanced-protocols.md) | Defer advanced protocols and access graph | Proposed | 2026-08-27 |

These records intentionally remain Proposed because `IDP-SPEC.md` remains Draft. They become Accepted only as part of the owner-approved resolution of the target specification.
