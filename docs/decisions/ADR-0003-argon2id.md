---
id: ADR-0003
title: Store passwords with Argon2id
status: Proposed
date: 2026-08-27
owner: Flōr IDP owner
---

## Context
Passwords must remain resistant to offline cracking after a database disclosure.

## Considered options
1. Argon2id with calibrated memory cost and bounded concurrency.
2. bcrypt for a new system.
3. Fast digest algorithms.

## Decision
Use Argon2id; start from the documented `m=19 MiB, t=2, p=1` baseline and calibrate against production hardware.

## Consequences
Password verification consumes material memory, requiring a semaphore and load test.

## Enforcement
Security test checks Argon2id configuration and an overload test checks memory budget.
