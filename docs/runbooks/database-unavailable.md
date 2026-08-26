---
id: RB-database-unavailable
title: IDP database unavailable
status: Draft
owner: Flōr IDP operator
last_reviewed: 2026-08-27
---

# Database unavailable

## Symptom
Readiness is failing for the database dependency; `/token` and profile/group operations report dependency errors.

## Confirmation
Within 60 seconds, check database connection errors, database health, connection-pool saturation, and a synthetic token request. Distinguish it from a session-store outage.

## Impact
New authentication and token issuance fail. Products may locally validate unexpired JWTs until their TTL expires.

## Remediation
1. Declare the incident and freeze non-incident changes.
2. Restore database reachability, capacity, credentials, or fail over using the approved operational procedure.
3. Do not bypass authentication or disable token validation.

## Verification
Readiness is green, token and group synthetic checks succeed, error rate returns to target, and audit writes are durable.

## Escalation
Escalate to the database on-call immediately; escalate to the IDP owner if recovery exceeds the approved RTO.

## Links
Production dashboard, database failover procedure, and RTO/RPO are pending deployment decisions.
