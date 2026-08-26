---
id: ADR-0010
title: Delete identity data through crypto-shredding
status: Proposed
date: 2026-08-27
owner: Flōr IDP owner
---

## Context
Soft deletion cannot prove personal data irrecoverable in immutable backups.

## Considered options
1. Delete operational data and destroy subject encryption material.
2. Keep data behind a soft-delete flag.
3. Delete rows only and rely on backup expiry.

## Decision
Remove operational profile, credential, and device records; retain only a minimal tombstone and audit record; destroy encryption material used for the subject's personal data.

## Consequences
The key hierarchy, KMS/HSM, backup handling, and retention period require owner approval before acceptance.

## Enforcement
Deletion test verifies no raw personal data can be decrypted after key destruction.
