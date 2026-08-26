---
id: ADR-0002
title: Rotate refresh tokens and detect reuse
status: Proposed
date: 2026-08-27
owner: Flōr IDP owner
---

## Context
A stolen long-lived refresh token otherwise stays useful until expiry.

## Considered options
1. Rotate every use and revoke a token family on reuse.
2. Keep a static refresh token until expiry.
3. Do not issue refresh tokens.

## Decision
Rotate on every use; reuse of a rotated token revokes the complete family and related session.

## Consequences
Clients must atomically replace stored refresh tokens and handle `invalid_grant` by interactive login.

## Enforcement
Integration test covers family revocation after reuse.
