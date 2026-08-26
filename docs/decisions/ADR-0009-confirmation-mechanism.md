---
id: ADR-0009
title: Use a common confirmation mechanism
status: Proposed
date: 2026-08-27
owner: Flōr IDP owner
---

## Context
Group joins, credential recovery, contact verification, and deletion all require one-time confirmation.

## Considered options
1. One `Confirmation` state machine with purpose-specific payload.
2. A separate delivery and verification implementation per use case.
3. Product-managed confirmations for identity changes.

## Decision
Use one single-use, TTL-bound Confirmation mechanism with hashed secrets and atomic target operation.

## Consequences
The provider, delivery channel, purposes, and registration semantics remain blocked by N1, N3, and N4.

## Enforcement
Tests reject replay and assert atomic confirmation plus target-state change.
