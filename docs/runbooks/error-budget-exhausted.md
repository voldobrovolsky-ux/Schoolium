---
id: RB-error-budget-exhausted
title: Error budget exhausted
status: Draft
owner: Flōr IDP operator
last_reviewed: 2026-08-27
---

# Error budget exhausted

## Symptom
A defined SLO budget reaches zero or its burn-rate alert triggers.

## Confirmation
Check SLI denominator, excluded traffic, release timeline, dependency health, and whether the breach is current or historical.

## Impact
The Tier 0 policy stops all changes except incident remediation and security fixes until the service returns within SLO.

## Remediation
1. Freeze feature and non-essential changes.
2. Identify the highest error contributor and mitigate or roll back.
3. Record the decision and owner for any temporary exception.

## Verification
SLI is healthy, projected budget is recovering, and the incident review identifies follow-up work.

## Escalation
Escalate to the service owner when freeze duration affects product commitments.

## Links
SLO dashboard and release-rollback runbook.
