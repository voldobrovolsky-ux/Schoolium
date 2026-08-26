---
id: ADR-0008
title: Restrict group visibility by audience
status: Proposed
date: 2026-08-27
owner: Flōr IDP owner
---

## Context
The existence and membership of a group are sensitive relationship data.

## Considered options
1. Explicit `audience` of client identifiers with non-enumerating `404`.
2. Allow every client holding `groups:read` to read all groups.
3. Include group data in all ID tokens.

## Decision
Expose a group only to clients in its explicit audience; inaccessible and absent groups both return `404`.

## Consequences
Audience changes and ownership rules need an additional Accepted decision before implementation.

## Enforcement
Contract test attempts a read outside the audience and expects `404`.
