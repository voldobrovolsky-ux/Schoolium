---
id: ADR-0007
title: Do not bind IDP groups to tenants
status: Proposed
date: 2026-08-27
owner: Flōr IDP owner
---

## Context
Family relationships can span several Schoolium workspaces and products.

## Considered options
1. Keep groups tenant-agnostic.
2. Add a tenant foreign key to groups.
3. Duplicate cross-tenant relationships in each product.

## Decision
Do not store a product tenant on an IDP group.

## Consequences
Products decide which tenant-scoped data, if any, may be disclosed after reading a relationship.

## Enforcement
IDP schema check prohibits tenant fields in Group.
