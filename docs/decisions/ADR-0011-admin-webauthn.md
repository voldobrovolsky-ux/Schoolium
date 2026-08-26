---
id: ADR-0011
title: Require phishing-resistant admin authentication
status: Proposed
date: 2026-08-27
owner: Flōr IDP owner
---

## Context
IDP administration can affect all ecosystem identities and clients.

## Considered options
1. Require WebAuthn for IDP administrative access.
2. Permit password-only administrative access.
3. Permit TOTP-only MFA for administrators.

## Decision
Require a phishing-resistant WebAuthn factor for IDP administrative roles.

## Consequences
An administrator enrolment and recovery process must be designed without weakening this guarantee.

## Enforcement
End-to-end test rejects an admin login without WebAuthn and audits every admin action.
