---
id: ADR-0012
title: Defer advanced protocols and access graph
status: Proposed
date: 2026-08-27
owner: Flōr IDP owner
---

## Context
The first target is secure ecosystem SSO, not a universal enterprise IAM platform.

## Considered options
1. Defer SAML, SCIM, ReBAC, DPoP/mTLS sender constraints, and FAPI until justified.
2. Implement all features before first release.
3. Omit an extension strategy.

## Decision
Defer each capability until its documented trigger is met: enterprise SAML consumer, provisioning need, per-object relationship access, or token-theft/high-sensitivity risk.

## Consequences
Each trigger requires a new ADR and compatible contract version.

## Enforcement
Architecture review rejects premature protocol or graph dependencies without an Accepted ADR.
