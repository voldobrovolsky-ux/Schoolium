---
id: RB-release-rollback
title: Release rollback
status: Draft
owner: Flōr IDP operator
last_reviewed: 2026-08-27
---

# Release rollback

## Symptom
A deployment causes a security regression, material SLI failure, or breaks a compatible consumer.

## Confirmation
Compare deployment timestamp to errors, traces, contract failures, and dependency metrics. Confirm a previous known-good release exists.

## Impact
Login, token issuance, group operations, or event delivery can be impaired.

## Remediation
1. Stop rollout and freeze further changes.
2. Roll back application code through the approved deployment system.
3. Apply only the documented backward migration; do not improvise destructive schema reversal.
4. If a signing key or token policy changed, follow its specialised runbook instead.

## Verification
Synthetic login, token, group-isolation, and event checks succeed; consumer contract telemetry normalises.

## Escalation
Escalate to the release owner and database owner if rollback requires migration action.

## Links
Change policy in `../08-change.md` and database-unavailable runbook.
