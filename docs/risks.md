---
id: SCHOOLIUM-RISKS
title: Schoolium risks and open decisions
status: Draft
owner: Schoolium Architecture
last_reviewed: 2026-08-27
---

# Risks and blockers

## Explicit IDP owner decisions

| ID | Decision needed | Impact |
|---|---|---|
| N1 | Confirmation delivery channel, provider, failure policy | invitations, recovery, verification |
| N2 | Archive retention period and legal basis | deletion implementation |
| N3 | Primary login identifier and verification requirements | signup and recovery |
| N4 | Self-registration versus product-provisioned identities | onboarding flow |
| N5 | Mandatory versus optional MFA for ordinary users | authentication policy |
| N6 | OAuth-client registration and scope-grant process | every integration |
| N7 | Group and membership handling when an identity is blocked | relationship semantics |
| N8 | Duplicate group-tag membership policy | idempotency and UX |

## Additional integration risks

| Risk | Impact | Required action |
|---|---|---|
| `identity.invite` is used by Schoolium mechanics but is absent from the IDP contract | moderator provisioning cannot be implemented consistently | define endpoint, Confirmation payload, and identity matching policy |
| Group-member mutation ownership is ambiguous | one client could affect another client's relationship data | restrict member mutations to group owner or explicit delegation |
| Webhook signing, retry and reconciliation are unspecified | forged events or divergent status | publish AsyncAPI security and delivery guarantees |
| Cross-workspace parent visibility is unspecified | privacy breach or unusable family flow | Schoolium owner must define policy per data category |
| Key hierarchy for crypto-shredding is unspecified | deletion may not be provably irreversible | Accepted key-management ADR required |

No implementation may invent behaviour for these items.
