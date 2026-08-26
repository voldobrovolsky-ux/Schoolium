---
id: ADR-0005
title: Keep product authorization out of IDP
status: Proposed
date: 2026-08-27
owner: Flōr IDP owner
---

## Context
Products have different tenants, roles, and permission models.

## Considered options
1. Products own their role catalogues and authorization.
2. Centralise every product role in IDP.
3. Introduce a general access graph now.

## Decision
IDP supplies identity and relationships only; Schoolium owns `WorkspaceMembership`, roles, and permission evaluation.

## Consequences
IDP group membership cannot grant access; each product must implement its own authorization checks.

## Enforcement
Consumer integration test proves that a relationship without a Schoolium grant is denied.
