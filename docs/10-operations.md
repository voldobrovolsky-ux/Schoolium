---
id: SCHOOLIUM-OPERATIONS
title: Schoolium operations and observability
status: Draft
owner: Schoolium Architecture
last_reviewed: 2026-08-27
---

# Operations

Use structured logs with timestamp, severity, trace identifier, operation, outcome, and non-sensitive identifiers only. Mask all personal and sensitive values defined in [05-data.md](05-data.md) and [06-security.md](06-security.md).

Operational dashboards must show login completion, IDP dependency failures, JWT validation failures, webhook delivery/application lag, and authorization denials. Each production alert requires a linked runbook before it is enabled.
