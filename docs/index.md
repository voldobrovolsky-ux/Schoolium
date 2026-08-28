---
id: SCHOOLIUM-INDEX
title: Schoolium — purpose and boundaries
status: Draft
owner: Schoolium Architecture
last_reviewed: 2026-08-27
---

# Schoolium

Schoolium manages school workspaces, their memberships, and product-specific permissions. It consumes identity assertions from the Flōr IDP and stores only the external `identity_id` needed to connect a person to Schoolium data.

## Boundaries

Schoolium does not store passwords, authenticate users, issue ecosystem tokens, own an identity profile, or interpret IDP group membership as permission. A school (`Workspace`), its tenant lifecycle, its roles, and all access decisions belong to Schoolium.

## Stakeholders

| Stakeholder | Responsibility |
|---|---|
| Schoolium owner | product boundaries and authorization policy |
| Flōr IDP owner | identity, authentication, OIDC and group contracts |
| School administrators | workspace administration within their grants |
| Parents, learners, staff | subjects of identity and school data |

## Status

This is a documentation baseline. The IDP contract is not accepted until the open nodes in [risks.md](risks.md) are resolved by their owners.

## Product domain

Schoolium's first product-domain slice is [12-utc-schedule.md](12-utc-schedule.md) — schedule generation and the завуч/moderator cabinet that feeds it ([ADR-0013](decisions/ADR-0013-utc-schedule-cabinet-scope.md)). It does not depend on the IDP-contract nodes above.
