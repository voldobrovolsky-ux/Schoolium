---
id: RB-signing-key-compromise
title: IDP signing-key compromise
status: Draft
owner: Flōr IDP operator
last_reviewed: 2026-08-27
---

# Signing-key compromise

## Symptom
A signing key is suspected exposed, used unexpectedly, or its key-management boundary has been compromised.

## Confirmation
Correlate key-management audit logs, `kid` use, deployment history, and incident evidence. Treat a credible report as an incident while confirmation proceeds.

## Impact
Forged tokens may be accepted by consumers until affected keys and issued tokens are invalidated.

## Remediation
1. Page security and IDP owners; stop normal releases.
2. Generate and publish a replacement key through the approved KMS/HSM procedure.
3. Remove the compromised key from JWKS only after the approved containment decision; revoke affected sessions/token families as required.
4. Notify each relying party with scope and verification steps.

## Verification
Consumers accept only replacement-key tokens, telemetry shows no compromised-key validation, and incident audit evidence is preserved.

## Escalation
Immediate security-incident escalation. Exact key rotation procedure is blocked until key management is accepted.

## Links
Key-management ADR and incident communication plan are required before production.
