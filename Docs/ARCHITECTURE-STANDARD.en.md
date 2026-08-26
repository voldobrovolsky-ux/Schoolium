---
id: FLOR-ADS
title: Flōr Group Architecture Documentation Standard
version: 1.0
status: Accepted
owner: Flōr Group / Architecture
language: en
counterpart: ARCHITECTURE-STANDARD.ru.md
last_reviewed: 2026-08-26
---

# FLOR-ADS — Flōr Group Architecture Documentation Standard

**Version 1.0 · Status: Accepted · Mandatory**

This document defines what architecture documentation every project in the Flōr Group ecosystem must contain, where it physically lives, in what form, who maintains it, and what blocks a merge when it is missing.

This is a normative document. It does not describe any particular project — it states requirements for all of them. Any project whose repository is registered in the Flōr service catalog falls under this standard from the moment of registration.

Russian version: `ARCHITECTURE-STANDARD.ru.md`. Section numbering is identical in both versions — cross-references by section number are language-independent.

---

## 1. How to read this document

### 1.1 Modal verbs

| Term | Meaning |
|---|---|
| **MUST** | Requirement. Violation blocks merge and/or release. Deviation only via an ADR with status Accepted. |
| **SHOULD** | Strong recommendation. Deviation permitted, but recorded as one line in `risks.md`. |
| **MAY** | Optional. Service owner's call, no justification required. |

### 1.2 Two documentation levels

Flōr Group documentation lives at two levels, and the split is physical, not stylistic:

- **Project level** — inside each service/product repository, under `docs/`. Describes one service.
- **Ecosystem level** — in the separate `flor-platform-docs` repository. Describes relationships between services and shared rules. No project document may duplicate an ecosystem document; it links to it.

Boundary rule: **if a fact stops being true when a neighbouring service is deleted, it is an ecosystem fact.** Everything else is project-level.

### 1.3 Tooling

The only documentation format is **Markdown in the project repository**, published through **Backstage TechDocs**. No documents in Notion, Google Docs, Confluence, messengers, or personal files. A document that is not in Git does not exist.

---

## 2. Criticality tiers

The volume of mandatory documentation depends on what the project is to the ecosystem, not on its size or age.

### 2.1 Definitions

**Tier 0 — Platform-critical.**
A service whose failure or incompatible change breaks other products in the ecosystem.
Criteria (any one is sufficient):
- two or more products have a synchronous runtime dependency on it;
- it is the source of truth for accounts, access rights, or personal data across the ecosystem;
- it owns an event schema consumed by more than one product.

**Tier 1 — Product.**
A standalone product with external users or commitments to a customer.
Criteria (any one is sufficient):
- it has users outside Flōr Group;
- there is a commercial contract or an obligation on timelines/quality to an external party;
- it stores personal data of external users.

**Tier 2 — Internal / experimental.**
An internal tool, prototype, or research project.
Criteria (all must hold):
- no external users;
- no personal data;
- no Tier 0/Tier 1 service depends on it at runtime.

### 2.2 Declaring and storing the tier

A project's tier MUST be declared in `catalog-info.yaml`:

```yaml
metadata:
  annotations:
    flor.group/tier: "1"
```

A missing annotation is interpreted as Tier 1 — the default is the stricter regime, not the looser one.

### 2.3 Tier escalation

Tier increases automatically on an event, not by decision:

| Event | New tier | Deadline to bring docs into compliance |
|---|---|---|
| A Tier 2 project gains its first external user | Tier 1 | 14 calendar days |
| A Tier 2 project begins storing personal data | Tier 1 | immediately, before the first write |
| A second synchronous dependency from another product appears | Tier 0 | 30 calendar days |
| The service becomes source of truth for identity or access rights | Tier 0 | immediately |

**Tier cannot be lowered automatically.** Lowering requires an ecosystem-level ADR with status Accepted and proof that all dependencies have been removed.

---

## 3. Canonical repository structure

The structure is fixed. Filenames are fixed. An agent generating a project MUST create exactly these paths — CI gates and TechDocs navigation depend on them.

```
<repo-root>/
├── README.md                     # entry point, one screen
├── CHANGELOG.md                  # Keep a Changelog format
├── catalog-info.yaml             # service catalog registration
├── mkdocs.yml                    # TechDocs configuration
└── docs/
    ├── index.md                  # 00 · Purpose and goals
    ├── 01-context.md             # Context and boundaries (C4 L1)
    ├── 02-containers.md          # Containers and structure (C4 L2)
    ├── 03-runtime.md             # Behaviour, FSM matrices (C4 L3 where needed)
    ├── 04-quality.md             # Quality scenarios
    ├── 05-data.md                # Data, PII, lineage
    ├── 06-security.md            # Threat model and access control
    ├── 07-reliability.md         # SLI/SLO, error budget
    ├── 08-change.md              # Migrations, flags, deprecation, decommissioning
    ├── 09-testing.md             # Test strategy and fitness functions
    ├── 10-operations.md          # Observability and operations
    ├── 11-onboarding.md          # Local setup and first run
    ├── glossary.md               # Ubiquitous language
    ├── risks.md                  # Risks and technical debt
    ├── decisions/
    │   ├── index.md              # architecture decision register
    │   └── ADR-0001-<slug>.md
    ├── contracts/
    │   ├── openapi.yaml          # synchronous interfaces
    │   ├── asyncapi.yaml         # event interfaces
    │   └── pacts/                # consumer-driven contracts
    └── runbooks/
        └── <failure-mode>.md
```

Additional files under `docs/` are allowed. Renaming or relocating the files listed above is not.

---

## 4. Mandatory artifact matrix

The core table of this standard. `M` — must, `S` — should, `O` — may.

| # | Artifact | Path | T0 | T1 | T2 |
|---|---|---|---|---|---|
| 1 | Entry point | `README.md` | M | M | M |
| 2 | Catalog registration | `catalog-info.yaml` | M | M | M |
| 3 | TechDocs configuration | `mkdocs.yml` | M | M | M |
| 4 | Purpose and goals | `docs/index.md` | M | M | M |
| 5 | Context and boundaries (C4 L1) | `docs/01-context.md` | M | M | M |
| 6 | Containers (C4 L2) | `docs/02-containers.md` | M | M | S |
| 7 | Behaviour and FSM matrices | `docs/03-runtime.md` | M | M | S |
| 8 | Architecture decision register | `docs/decisions/` | M | M | M |
| 9 | Ubiquitous language | `docs/glossary.md` | M | M | S |
| 10 | Quality scenarios | `docs/04-quality.md` | M | M | O |
| 11 | Risks and technical debt | `docs/risks.md` | M | M | S |
| 12 | Synchronous API contract | `docs/contracts/openapi.yaml` | M | M | S |
| 13 | Event contract | `docs/contracts/asyncapi.yaml` | M | M | O |
| 14 | Consumer-driven contracts | `docs/contracts/pacts/` | M | S | O |
| 15 | Data dictionary and PII map | `docs/05-data.md` | M | M | O |
| 16 | Threat model (STRIDE) | `docs/06-security.md` | M | M | O |
| 17 | SLI/SLO and error budget | `docs/07-reliability.md` | M | M | O |
| 18 | Runbooks | `docs/runbooks/` | M | M | O |
| 19 | Change management | `docs/08-change.md` | M | M | S |
| 20 | Test strategy | `docs/09-testing.md` | M | M | S |
| 21 | Fitness function catalog | `docs/09-testing.md`, "Fitness functions" section | M | S | O |
| 22 | Observability and operations | `docs/10-operations.md` | M | M | O |
| 23 | Developer onboarding | `docs/11-onboarding.md` | M | M | S |
| 24 | Changelog | `CHANGELOG.md` | M | M | S |

**The zero rule.** A `M` artifact cannot be absent, but it may contain an explicit "not applicable" with a one-line justification. An empty file and a missing file are the same violation. A file containing "No PII: the service stores no user data; all identifiers are surrogate keys" is compliant.

---

## 5. Project-level artifact specifications

For each artifact: what it contains, when it is updated, what counts as the minimum.

### 5.1 `README.md` — entry point

One screen. Contains: name and a one-line purpose, tier, owner, link to published TechDocs, local run command, link to `docs/11-onboarding.md`.
The README MUST NOT contain architectural description — that lives in `docs/`. A README that grows into architecture is the classic point where documentation starts diverging from reality.

**Updated:** on change of owner, tier, or run command.

### 5.2 `catalog-info.yaml` — service catalog registration

Required fields:

```yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: <machine-name>
  title: <human-readable name>
  description: <one line>
  annotations:
    flor.group/tier: "0" | "1" | "2"
    backstage.io/techdocs-ref: dir:.
  tags: [<domain>, <stack>]
  links:
    - url: <production URL>
      title: Production
spec:
  type: service | website | library
  lifecycle: experimental | production | deprecated
  owner: <team|person>
  system: <ecosystem system name>
  providesApis: [<api-name>]
  consumesApis: [<api-name>]
  dependsOn: [component:<name>, resource:<name>]
```

`dependsOn`, `providesApis` and `consumesApis` are not decorative. The ecosystem integration map is built from them. An unrecorded dependency means that when a service is decommissioned, nobody learns what breaks.

**Updated:** when any dependency appears or is removed, on owner change, tier change, or lifecycle change.

### 5.3 `docs/index.md` — purpose and goals

Three blocks:
1. **Problem** — what the service solves and for whom. Three to five sentences.
2. **Boundaries** — what the service deliberately does not do, stated as a list of "not".
3. **Key stakeholders** — who decides, who consumes.

The Boundaries block is mandatory and is the most valuable part of the document: it is what prevents scope creep into responsibility creep.

**Updated:** when the service's area of responsibility changes.

### 5.4 `docs/01-context.md` — context and boundaries

A C4 System Context diagram: the service as a black box, its users, and every external system it touches.

MUST include a table of external interfaces:

| Counterparty | Direction | Protocol | Contract | What breaks on failure |
|---|---|---|---|---|

The last column is mandatory for Tier 0 and Tier 1. It turns a diagram into a failure-analysis instrument.

**Updated:** when an external integration is added or removed.

### 5.5 `docs/02-containers.md` — containers

A C4 Container diagram: deployable units (applications, services, datastores), technologies, and protocols between them.

MUST include a "Dependency rules" section stating dependency direction explicitly: which layers must not know about which. The wording must be machine-checkable, because it becomes a fitness function under 5.19.

Checkable example: "Packages under `domain/**` import nothing from `infrastructure/**`, `api/**`, `db/**`."
Non-checkable and therefore forbidden: "The domain is isolated from infrastructure."

C4 Component level (L3) only for containers with more than seven components or non-trivial internal structure. Code level is never hand-maintained; where needed it is generated from source.

**Updated:** when a container is added, removed, or replaced; when dependency rules change.

### 5.6 `docs/03-runtime.md` — behaviour and FSM matrices

This is where the FSM matrices Flōr Group already uses live. The standard does not replace them; it fixes the minimum completeness bar.

Every state machine MUST be accompanied by two tables:

**Transition matrix:**

| From state | Event | To state | Data effect | Side effects |
|---|---|---|---|---|

**Completeness matrix:**

| State | Has exit? | Returns to home screen? | Terminal? |
|---|---|---|---|

An architectural hole shows up as an empty cell. A completeness matrix with no empty cells and no unexplained terminal states is an acceptance condition for the document.

Every enum taxonomy (roles, entity types, statuses) MUST be accompanied by a `value → behaviour` matrix across every dimension where behaviour differs.

Beyond the FSM, this section carries two to five key runtime scenarios: the call sequence for the primary user path, for authentication, and for handling a dependency failure.

**Updated:** when a state, event, role, or type is added; when any transition changes.

### 5.7 `docs/decisions/` — architecture decision register

The Flōr Group decision register in canonical form. One file, one decision. Format: MADR-lite (Appendix A).

Rules:
- continuous four-digit numbering, never reused: `ADR-0001`, `ADR-0002`;
- statuses: `Proposed` → `Accepted` → `Superseded by ADR-XXXX` | `Deprecated`;
- an accepted ADR is **never edited in substance**. If the decision changes, write a new ADR and mark the old one `Superseded`. Only typographic fixes are permitted;
- `docs/decisions/index.md` is a table of all ADRs: number, title, status, date, link. Generated by script, not maintained by hand.

An ADR MUST record the rejected alternatives. An ADR without a "Considered options" section is not accepted: the register's value is not in what was chosen but in what was already ruled out and why — otherwise the same debate reopens in six months.

**ADR triggers:** choosing or replacing a datastore, choosing an inter-service protocol, adding or removing an external dependency, changing the authentication model, changing data ownership, any deviation from FLOR-ADS.

### 5.8 `docs/glossary.md` — ubiquitous language

Table: term → definition → which bounded context it belongs to → how it differs from the same word in other contexts.

The last column is mandatory. "User", "account", "organization", and "role" mean different things across the ecosystem's products, and integration defects grow precisely in that gap.

Terms whose meaning is uniform across the ecosystem are not duplicated here: they live in `flor-platform-docs/glossary.md` and are linked.

**Updated:** whenever a term appears in code or UI that is not yet in the table.

### 5.9 `docs/04-quality.md` — quality scenarios

Not a list of adjectives, but a table of checkable scenarios:

| # | Attribute | Scenario (stimulus → response → metric) | Priority | Verified by |
|---|---|---|---|---|

The "Verified by" column points at a specific test, fitness function, or dashboard. A quality scenario with no verification MUST be marked `uncovered` and mirrored as a line in `docs/risks.md`.

Minimum for Tier 0 and Tier 1: one scenario for each of performance, availability, security, modifiability, observability.

**Updated:** on SLO revision, on a new customer requirement, after an incident that exposed an uncovered attribute.

### 5.10 `docs/risks.md` — risks and technical debt

Table: description → likelihood → impact → mitigation → owner → date recorded.

The decision register answers "what we chose". This file answers "what it cost us". Every ADR containing a trade-off MUST leave a line here.

Debt not recorded here does not exist for the ecosystem and never enters planning.

**Updated:** with every trade-off ADR, every temporary workaround, every incident.

### 5.11 `docs/contracts/openapi.yaml` — synchronous API contract

OpenAPI 3.1. It is the source of truth for the interface, not a description written afterwards. The order is mandatory: specification → client and server generation → implementation. Not the reverse.

Requirements:
- every endpoint carries request and response examples;
- every error code is listed with the condition that produces it;
- error schemas are uniform across the service;
- interface versioning follows section 8.

**Updated:** before the code changes, not after.

### 5.12 `docs/contracts/asyncapi.yaml` — event contract

AsyncAPI 3.0: channels, messages, servers, publish and subscribe operations.

For Tier 0, message schemas MUST be held in the ecosystem schema registry and pulled in via `$ref`, not duplicated in the file. A duplicated schema diverges from the original within roughly one release.

Every published event MUST have: a name in the form `<domain>.<entity>.<past-tense-action>`, a schema version, an idempotency statement, and a delivery-ordering guarantee statement.

**Updated:** before a new event is published or an existing schema changes.

### 5.13 `docs/contracts/pacts/` — consumer-driven contracts

Contracts generated by consumers and verified by the provider in CI. Mandatory for Tier 0: a service two or more products depend on has no business learning about a broken consumer from production.

Contract verification MUST be a deployment gate, not an informational test.

**Updated:** automatically from consumer tests.

### 5.14 `docs/05-data.md` — data, PII, lineage

Three sections:

1. **Data dictionary** — entity → field → type → meaning → source → mutation rules.
2. **Classification** — every field labelled `public` | `internal` | `personal` | `sensitive`. `personal` and `sensitive` fields are additionally listed separately with legal basis and retention period.
3. **Lineage** — where data enters from and where it leaves to beyond the service boundary, naming which fields cross.

Section 3 is the precondition for the ecosystem-wide lineage map. Without it there is no way to answer "where else does this user's personal data live" — and that question always eventually arrives.

**Updated:** when a field is added, when a new data consumer appears, when retention changes.

### 5.15 `docs/06-security.md` — threat model and access control

Contains:
1. **Trust boundaries** — where data crosses a trust perimeter, drawn over the diagram from `01-context.md`.
2. **STRIDE threat model** — per trust boundary: spoofing, tampering, repudiation, information disclosure, denial of service, elevation of privilege → threat → mitigation → status.
3. **Access model** — roles, permissions, who grants, who revokes, what happens to sessions on revocation.
4. **Secrets** — where stored, how rotated, who has access.

The threat model MUST be revisited on every new integration, not on a calendar. A new integration is a new trust boundary.

**Updated:** on new integration, on role model change, on change to secret storage.

### 5.16 `docs/07-reliability.md` — SLI/SLO and error budget

Contains:

1. **SLIs** — measured as a ratio of good events to total events. Not "server uptime" but "share of requests served within N ms without error".
2. **SLOs** — target value for each SLI and the measurement window.
3. **Error budget** — `100% − SLO`, expressed as permitted downtime or failure count per window.
4. **Error budget policy** — the pre-agreed rule for what happens on exhaustion. It MUST be phrased as an action, not an intention.

Default policy wording for Tier 0 and Tier 1:
> When the error budget for the rolling window is exhausted, all changes other than incident and vulnerability fixes stop until the service is back within its SLO.

Deviation from this wording requires an ADR.

An SLO MUST be stricter than any external commitment to a customer, where one exists: the gap between them is the margin for reacting.

**Updated:** on target revision, on change to external commitments, following an incident retrospective.

### 5.17 `docs/runbooks/` — runbooks

One file, one failure mode. Not "general operations" but "what to do when this specific alert fires".

File structure: symptom → how to confirm → user impact → remediation steps → how to verify it worked → escalation path → dashboard links.

Every Tier 0 and Tier 1 alert MUST carry a link to its runbook in the alert body. An alert without a runbook is an alarm clock without instructions: it produces stress but not faster recovery.

Minimum set for Tier 0: dependency failure, database degradation, error budget exhaustion, key or token compromise, release rollback.

**Updated:** after any incident where the existing runbook was insufficient.

### 5.18 `docs/08-change.md` — change management

Four sections:

1. **Schema migrations** — expand → migrate → contract is mandatory: add the new without breaking the old; migrate; confirm the old is no longer read; remove. Every migration is described as a forward/backward pair; irreversible migrations require an ADR.
2. **Feature flags** — table: flag → purpose → type → owner → planned removal date. A flag without a removal date is not created. An overdue flag lands in `risks.md`.
3. **Interface deprecation** — per section 8.
4. **Decommissioning** — plan: confirm zero traffic → notify consumers listed in the catalog's `dependsOn` → shut down → archive → remove from catalog → remove docs from navigation with a link to the successor.

**Updated:** with every migration, every flag, every deprecation announcement.

### 5.19 `docs/09-testing.md` — test strategy

"Strategy" section: which test levels exist in this project, what each level verifies, what counts as sufficient coverage and why that number.

"Fitness functions" section: table

| # | Rule | Type | Tool | Where it runs | Blocks merge |
|---|---|---|---|---|---|

A fitness function is an architectural rule turned into an executable check. Every rule in the "Dependency rules" section of `02-containers.md` MUST have a corresponding row here.

Minimum set for Tier 0:
- dependency direction between layers;
- no cyclic dependencies between modules;
- no direct access to tables owned by another module or service;
- event schema compatibility with the previous version;
- consumer contract verification.

This section is what converts architectural principles from declaration into mechanism. A rule with no executable check will be broken — the only question is after how many releases.

**Updated:** when an architectural rule is added, when module structure changes.

### 5.20 `docs/10-operations.md` — observability and operations

Contains:
1. **Conformance to the platform observability standard** — a link to `flor-platform-docs/standards/observability.md` plus a list of deviations, if any. The conventions themselves are not restated here.
2. **Trace attributes** — which identifiers the service sets and how it propagates trace context downstream.
3. **Log structure** — required fields, masked fields. The masked-field list MUST match the `personal` and `sensitive` fields from `05-data.md`.
4. **Health checks** — what each probe actually checks and why. A probe reporting "alive" while a dependency the service cannot function without is down is a defect, not a feature.
5. **Dashboards and alerts** — a linked list; every alert references its runbook.

**Updated:** when the alert set changes, when masked fields change.

### 5.21 `docs/11-onboarding.md` — developer onboarding

The path from a clean machine to a working local environment and a first meaningful change. Contains: environment prerequisites, install commands, environment variables and where their values come from, run command, how to obtain test credentials, how to run the tests, and a first task confirming everything works.

Acceptance criterion: a person or agent who has never touched the project reaches a running service without asking a question. If a question arises, that is a defect in this document, closed by editing the file — not by answering in chat.

**Updated:** every time someone asks a question while setting the project up.

### 5.22 `CHANGELOG.md` — changelog

Keep a Changelog format, semantic versioning per section 8. Sections: Added, Changed, Deprecated, Removed, Fixed, Security.

Written for the interface consumer, not for the code author. Commit history is not a changelog.

**Updated:** in the same change as the code.

---

## 6. Ecosystem level

Repository `flor-platform-docs`. No project duplicates its content.

| # | Artifact | Path | Purpose |
|---|---|---|---|
| E1 | System landscape | `landscape.md` | C4 System Landscape diagram: every product in the ecosystem and the links between them |
| E2 | Context map | `context-map.md` | Relationships between bounded contexts with pattern names: shared kernel, customer-supplier, conformist, anti-corruption layer |
| E3 | Service catalog | Backstage | Registry of all components: owner, tier, dependencies, documentation links, freshness |
| E4 | Event catalog | `events/` | Every ecosystem event: domain, publisher, subscribers, schema, version |
| E5 | Schema registry | infrastructure | Versioned message schemas with automated compatibility enforcement |
| E6 | Shared identity architecture | `identity/sso-architecture.md` | Identity provider, protocols, token and session lifecycle, how a new product is onboarded, behaviour on access revocation |
| E7 | Shared component registry | `shared/registry.md` | Ecosystem libraries and SDKs: versions, consumers, support policy |
| E8 | Observability standard | `standards/observability.md` | Attribute naming conventions, required log fields, trace identifier format |
| E9 | Versioning and deprecation policy | `standards/versioning.md` | Section 8 of this document in executable form |
| E10 | Golden path | `golden-path/` | Reference project template: repository skeleton, pipeline, document set. The primary entry point for agent pipelines |
| E11 | Technology radar | `radar.md` | Adopt / trial / assess / hold across tools and techniques |
| E12 | Ecosystem ADRs | `decisions/` | Decisions affecting more than one product |
| E13 | Data classification and PII map | `data/pii-map.md` | Consolidated map: which personal data, in which services, with which retention |
| E14 | Architecture review policy | `governance/review.md` | Triggers and procedure for revisiting architecture |
| E15 | This standard | `ARCHITECTURE-STANDARD.ru.md` / `.en.md` | Documentation requirements for projects |

**Precedence rule.** Where a project document contradicts an ecosystem document, the ecosystem document wins. A project needing to deviate writes a project-level ADR referencing the ecosystem document it deviates from and notifies that document's owner.

---

## 7. Metadata, statuses, freshness

### 7.1 Mandatory document header

Every file under `docs/` starts with:

```yaml
---
id: <unique within the repository>
title: <title>
status: Draft | Accepted | Superseded | Deprecated
owner: <responsible party>
last_reviewed: YYYY-MM-DD
---
```

### 7.2 Statuses

| Status | Meaning |
|---|---|
| `Draft` | In progress. Must not be referenced from accepted documents. Must not be handed to an agent for implementation. |
| `Accepted` | In force. Source of truth. |
| `Superseded` | Replaced. MUST contain a link to the replacement. |
| `Deprecated` | Describes something being decommissioned. Kept until removal, then archived. |

### 7.3 Freshness

| Tier | Maximum age of `last_reviewed` |
|---|---|
| Tier 0 | 90 days |
| Tier 1 | 180 days |
| Tier 2 | 365 days |

An overdue document is flagged as stale in the service catalog. For Tier 0, more than 30 days beyond the limit moves the component into a review-required state, visible to everyone in the catalog.

A review need not produce an edit. Confirming the document is still accurate and updating the date is a valid outcome.

---

## 8. Versioning and deprecation

### 8.1 Versions

Semantic versioning for all public interfaces: `MAJOR.MINOR.PATCH`.

A change is breaking when a correct consumer of the previous version stops working: removing or renaming a field, narrowing a type, tightening validation, changing the meaning of a value, removing a response code, changing an event's delivery-ordering guarantee.

Adding an optional field is not breaking. Adding a required field to an input contract is.

### 8.2 Deprecation

The sequence is mandatory and identical for HTTP interfaces and events:

1. An ADR with status Accepted recording the decision and the successor.
2. `deprecated: true` in the contract specification.
3. `Deprecation` and `Sunset` headers in responses, plus a `Link` header to the migration guide.
4. Notification of every consumer listed in the catalog's `consumesApis` — individually, not by broadcast.
5. Waiting period: Tier 0 — 90 days from the moment the last consumer acknowledges the notice; Tier 1 — 60 days; Tier 2 — 14 days.
6. Shutdown and decommissioning per 5.18.

Shutting down an interface that telemetry shows still has consumers is forbidden regardless of the elapsed period. The period is a floor, not a permission.

---

## 9. Continuous integration gates

The standard is enforced automatically. What blocks a merge:

| Check | T0 | T1 | T2 |
|---|---|---|---|
| All `M` files from section 4 present | block | block | block |
| `catalog-info.yaml` valid; `owner`, `tier`, `dependsOn` populated | block | block | block |
| TechDocs builds cleanly, no broken internal links | block | block | warn |
| Document header valid; `status` not `Draft` for `M` files | block | block | warn |
| `openapi.yaml` / `asyncapi.yaml` schema-valid | block | block | warn |
| Contract changed without a `CHANGELOG.md` entry | block | block | warn |
| Breaking contract change without an ADR | block | block | warn |
| Event schema backward compatibility | block | block | — |
| Consumer contract verification | block | warn | — |
| Fitness functions from `09-testing.md` | block | block | warn |
| New `personal` field absent from `05-data.md` | block | block | — |
| New alert without a runbook | block | warn | — |
| `last_reviewed` overdue | warn | warn | warn |

Stale freshness never blocks a merge: blocking edits is the worst way to fight documentation decay, because the result is that nobody touches the documentation at all.

---

## 10. Definitions of done

### 10.1 A change is ready to merge when

- every affected document is updated in the same change, not the next one;
- the contract changed before the code, not after;
- any breaking change carries an ADR and a changelog entry;
- any new state or role is reflected in the matrices in `03-runtime.md`;
- any new personal-data field is reflected in `05-data.md` and in the masked-field list in `10-operations.md`;
- all gates in section 9 are green.

### 10.2 A project is ready for Tier 1 when

Every `M` artifact for Tier 1 exists with status `Accepted`, TechDocs builds, the component is visible in the service catalog with dependencies populated, SLOs and an error budget policy are defined, and at least one runbook exists.

### 10.3 A project is ready for Tier 0 when

Additionally: the threat model covers every trust boundary, event schemas live in the schema registry, consumer contracts are verified in the pipeline as a deployment gate, runbooks cover the minimum set from 5.17, fitness functions cover the minimum set from 5.19, and every consumer of the service is identified by name.

---

## 11. Amending this standard

FLOR-ADS changes only through an ecosystem ADR with status Accepted. The document version increments per section 8: adding an optional artifact is a minor version; promoting an artifact from `S` to `M`, or changing the directory structure, is a major version.

On a major version bump, existing projects get a transition period: Tier 0 — 60 days, Tier 1 — 90 days, Tier 2 — until the project's next substantive change.

The Russian and English versions are amended in a single change. Divergence between them is a defect fixed at priority; where divergence is found, the version with the later `last_reviewed` is treated as the source of truth.

---

## Appendix A — ADR template

```markdown
---
id: ADR-0001
title: <the decision in one imperative sentence>
status: Proposed | Accepted | Superseded by ADR-XXXX | Deprecated
date: YYYY-MM-DD
owner: <decision maker>
---

## Context
What is happening, which forces are in play, why a decision is needed at all.

## Considered options
1. <option> — pros / cons
2. <option> — pros / cons
3. <option> — pros / cons

## Decision
What was chosen and against which criterion.

## Consequences
What got easier. What got harder. What is now forbidden. What debt this creates — with a link to the line in risks.md.

## Enforcement
Which fitness function or test prevents this decision from being violated.
```

## Appendix B — Runbook template

```markdown
---
id: RB-<slug>
title: <failure mode>
status: Accepted
owner: <responsible party>
last_reviewed: YYYY-MM-DD
---

## Symptom
What the on-call sees. The exact alert text.

## Confirmation
How to establish within 60 seconds that this is this failure and not a similar one.

## Impact
What exactly is broken for the user right now. Which SLO is burning.

## Remediation
1. <step>
2. <step>

## Verification
How to confirm it worked.

## Escalation
Who to escalate to, and after how many minutes, if the steps do not help.

## Links
Dashboards, logs, adjacent runbooks.
```

## Appendix C — SLO table template

```markdown
| SLI | Definition | SLO | Window | Error budget | Alert |
|---|---|---|---|---|---|
| API availability | share of requests with status < 500 | 99.9% | 28 days | 40 min | burn rate |
| Latency | share of requests faster than 300 ms | 99.0% | 28 days | — | burn rate |
```

## Appendix D — Threat model row template

```markdown
| Trust boundary | STRIDE category | Threat | Likelihood | Mitigation | Status | Verification |
|---|---|---|---|---|---|---|
```

---

*Ready for use. Any Flōr Group project started after this version is adopted begins from a copy of the golden path, not from an empty repository.*
