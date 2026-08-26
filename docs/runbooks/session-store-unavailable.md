---
id: RB-session-store-unavailable
title: IDP session store unavailable
status: Draft
owner: Flōr IDP operator
last_reviewed: 2026-08-27
---

# Session store unavailable

## Symptom
Session-store readiness fails or session lookup latency breaches its SLO.

## Confirmation
Check datastore reachability, TTL operations, rate-limit counters, and login-session creation separately from the database.

## Impact
New browser sessions and confirmation operations may fail. Locally valid product JWTs can continue within TTL.

## Remediation
1. Declare the incident and stop deployment changes.
2. Restore the store or fail over according to the approved topology.
3. Do not silently fall back to persistent, unbounded sessions.

## Verification
New login, logout, session revocation, and rate limiting work; readiness and latency recover.

## Escalation
Escalate to the session-store on-call immediately and the IDP owner if session integrity is in doubt.

## Links
Session topology and recovery procedure are pending deployment decisions.
