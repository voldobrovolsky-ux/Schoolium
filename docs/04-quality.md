---
id: SCHOOLIUM-QUALITY
title: Schoolium quality scenarios
status: Draft
owner: Schoolium Architecture
last_reviewed: 2026-08-27
---

# Quality scenarios

| ID | Attribute | Scenario | Priority | Verification |
|---|---|---|---|---|
| Q1 | Security | IDP group membership alone cannot grant a Schoolium permission | High | authorization integration test |
| Q2 | Availability | An IDP confirmation-channel outage does not end existing Schoolium sessions | High | degradation test |
| Q3 | Privacy | A client outside group `audience` cannot discover a relationship | High | contract test expects `404` |
| Q4 | Performance | Normal Schoolium requests validate IDP token signatures locally | High | architecture test and trace review |
| Q5 | Changeability | Adding a school role does not require an IDP schema change | Medium | design review |

Uncovered scenarios must be added to [risks.md](risks.md), rather than silently accepted.
