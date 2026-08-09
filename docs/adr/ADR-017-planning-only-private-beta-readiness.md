# ADR-017: planning-only Private Beta readiness phase

Status: accepted for planning scope on 2026-08-09. Its implementation
prohibition was superseded for bounded fake-data-only local work by ADR-018 on
2026-08-09. It still does not approve Private Beta execution.

## Context

Milestones 1-6 are complete and human-approved, but every accepted environment,
identity, merchant, email, load, restore and security exercise is fake-local.
The source plan places a Private Beta after M6, while the repository lacks a
beta charter, accountable operating roles, real-data decisions, environment,
immutable candidate, CodeQL evidence, guide-freshness program and final
go/no-go record.

Treating M6 approval as beta authority would silently expand the data,
environment, legal, operational and security boundaries.

## Decision

Create a distinct planning-only phase named **Private Beta Readiness
Planning**, not Milestone 7. Planning may document scope, risks, proposed data
handling, operations, guide freshness and acceptance evidence using fake data.

Planning must preserve three separate decisions:

1. approve the readiness plan;
2. later authorize bounded implementation/rehearsal without real users; and
3. only after all gates pass, explicitly authorize a named Private Beta
   candidate, environment, cohort cap and time window.

Until decision 3, Private Beta execution is NO-GO.

## Consequences

- M1-M6 code and approval remain unchanged.
- Unassigned ownership and external/legal decisions are visible blockers.
- CodeQL remains not run and cannot be described as passed.
- Existing fictional guides remain fictional and inert; their dates are not
  advanced by planning.
- Local M6 load/restore results remain historical engineering evidence, not
  beta SLO/DR evidence.
- No source-code change, Git commit/remote/branch/PR/push, cloud/vendor setup,
  real email, real user/data, or deployment follows from this ADR.
- Planning completion is reviewable without implying beta readiness.

## Rejected alternatives

- **Call this Milestone 7:** rejected because the roadmap defines Private Beta
  as a separately gated operating phase.
- **Invite a small cohort while controls are designed:** rejected because the
  missing environment, data, ownership, guide and security decisions are
  blocking.
- **Treat the accepted CodeQL deferral as a future pass:** rejected; a beta
  candidate needs current CodeQL evidence or explicitly approved equivalent
  SAST evidence with documented Java and JS/TS coverage. A decision alone is
  insufficient.
- **Use the local Compose stack for invited users:** rejected because it is a
  development-only topology with fake identity/email assumptions.

## Stop condition

Under this historical decision, work stopped after readiness-pack review.
ADR-018 records the later bounded fake-data-only local implementation and
rehearsal authority. Repository, external environment, vendor, participant,
real-data, and beta-execution actions remain unauthorized.
