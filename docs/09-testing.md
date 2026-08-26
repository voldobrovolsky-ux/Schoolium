---
id: SCHOOLIUM-TESTING
title: Schoolium testing and fitness functions
status: Draft
owner: Schoolium Architecture
last_reviewed: 2026-08-27
---

# Testing

## Required tests before implementation acceptance

| ID | Rule | Type |
|---|---|---|
| FF-S1 | No authorization path treats an IDP group membership as a permission | integration / property test |
| FF-S2 | IDP JWT validation checks signature, issuer, audience, expiry and nonce | integration test |
| FF-S3 | Webhook processing is idempotent by `event_id` | contract test |
| FF-S4 | Sensitive values cannot be logged | static analysis / log test |
| FF-S5 | Consumer contract remains compatible with published IDP OpenAPI and AsyncAPI | contract test |

The repository currently contains no runtime implementation; these are acceptance gates to wire into the future CI pipeline.
