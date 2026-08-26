---
id: ADR-0006
title: Model groups as opaque relationship containers
status: Proposed
date: 2026-08-27
owner: Flōr IDP owner
---

## Context
Family and workgroup relationships can be shared without making IDP a product domain model.

## Considered options
1. Opaque `tag` and `role` supplied by products.
2. Fixed IDP group-type catalogue.
3. Product-specific tables in IDP.

## Decision
Keep `Group.tag` and `Membership.role` opaque to IDP.

## Consequences
Products document meaning and validation; IDP cannot make access decisions from either field.

## Enforcement
Schema and code review reject IDP branching on product group tags.
