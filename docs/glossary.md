---
id: SCHOOLIUM-GLOSSARY
title: Schoolium ubiquitous language
status: Draft
owner: Schoolium Architecture
last_reviewed: 2026-08-27
---

# Glossary

| Term | Meaning in Schoolium | Difference in IDP |
|---|---|---|
| Identity | External person reference (`identity_id`) | IDP owns the account, credentials and profile |
| Workspace | A school tenant | IDP has no tenant concept |
| WorkspaceMembership | Person's product-local membership, role and status in a school | IDP Membership is an opaque relationship in a group |
| Role | Schoolium permission bundle | Only IDP administrative roles have meaning inside IDP |
| Group | Optional relationship input to a Schoolium rule | Generic IDP container; grants no access |
| Client | Registered OAuth consumer | In product language may otherwise mean a customer |
