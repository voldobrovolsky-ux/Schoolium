---
id: RB-refresh-token-reuse
title: Refresh-token reuse spike
status: Draft
owner: Flōr IDP operator
last_reviewed: 2026-08-27
---

# Refresh-token reuse spike

## Symptom
`token.reuse_detected` alert fires above its baseline.

## Confirmation
Check the event rate by client, token family, anonymised device context, and deployment version; exclude an intentional client retry defect only with evidence.

## Impact
Affected token families are revoked and their users must reauthenticate. A spike can indicate token theft or a client storage/rotation defect.

## Remediation
1. Preserve audit evidence and page security plus the affected client owner.
2. Confirm family revocation and session removal are succeeding.
3. If compromise is suspected, revoke wider affected scope only through incident command.
4. Fix client token replacement before lifting any mitigation.

## Verification
Reuse rate returns to baseline; affected client passes rotation integration tests; no raw tokens appear in logs.

## Escalation
Escalate immediately to security for suspicious geographic or multi-client patterns.

## Links
ADR-0002 and token-family dashboard.
