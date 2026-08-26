---
id: ADR-0001
title: Use Authorization Code with PKCE
status: Proposed
date: 2026-08-27
owner: Flōr IDP owner
---

## Context
All ecosystem clients need a single secure login flow.

## Considered options
1. Authorization Code + PKCE S256 — protects code interception for public and confidential clients.
2. Implicit flow — exposes tokens to browser delivery paths.
3. Resource Owner Password Credentials — gives a product access to credentials.

## Decision
Use Authorization Code + PKCE S256 only; reject implicit and password grants.

## Consequences
Clients must register exact redirect URIs and validate state and nonce. The resulting contract is in `../contracts/openapi.yaml`.

## Enforcement
Configuration test allows only `authorization_code` and `refresh_token` grants.
