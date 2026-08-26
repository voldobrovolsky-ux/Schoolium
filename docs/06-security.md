---
id: SCHOOLIUM-SECURITY
title: Schoolium security model
status: Draft
owner: Schoolium Architecture
last_reviewed: 2026-08-27
---

# Security

| Boundary | Threat | Mitigation | Verification |
|---|---|---|---|
| Browser → Schoolium → IDP | authorization-code interception | PKCE S256, exact registered redirect URI, state and nonce validation | end-to-end test |
| Schoolium → IDP | token audience confusion | validate signature, `iss`, `aud`, expiry and nonce; cache JWKS | integration test |
| IDP group → Schoolium authorization | relationship becomes implicit privilege | explicit permission evaluation from `WorkspaceMembership` and product catalogue | negative authorization test |
| IDP → Schoolium webhook | forged or replayed event | signed, timestamped, idempotent events; implementation details pending contract acceptance | webhook test |

No raw token, authorization code, password, confirmation secret, email, phone number, IP, or user-agent may be written to application logs.
