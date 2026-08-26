---
id: ADR-0004
title: Separate hot and cold data paths
status: Proposed
date: 2026-08-27
owner: Flōr IDP owner
---

## Context
Login and token validation must not depend on profile reads.

## Considered options
1. Separate logical schemas from the first commit.
2. One undifferentiated user table.
3. Fully split services from day one.

## Decision
Use separate `core`, `credentials`, `profile`, `sessions`, `devices`, `groups`, and `audit` boundaries while allowing a single physical database initially.

## Consequences
The hot path can use the session store and cached JWKS; no profile repository is available to it.

## Enforcement
Static dependency checks reject hot-path imports of profile repositories.
