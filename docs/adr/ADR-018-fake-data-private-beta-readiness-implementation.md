# ADR-018: fake-data-only Private Beta readiness implementation

Status: accepted on 2026-08-09 for local implementation and rehearsal only.
Private Beta execution remains NO-GO.

## Context

ADR-017 separated readiness planning, readiness implementation, and a later
Private Beta execution decision. The planning pack exposed PB-G00: one
time-dependent integration test used August 2026 fixtures after those dates had
become historical, while production correctly materializes occurrences from
household-local today.

The user subsequently approved the bounded implementation/rehearsal phase and
directed work to start with PB-G00. The approval explicitly excludes real
users, production deployment, vendors, and real data.

## Decision

Permit local source, dependency/configuration, test, fixture, and documentation
changes plus seeded local rehearsals that directly advance the Private Beta
readiness gates. All work must use fake identities, fictional merchants, inert
targets, Mailpit, and local development infrastructure.

The phase does not authorize:

- a Git commit, remote, branch, pull request, push, or external CI;
- cloud, staging, shared, or production infrastructure;
- vendor selection, purchase, configuration, or real outbound email;
- real merchant guides, targets, provider contact, or verification claims;
- identifying, recruiting, inviting, or onboarding a participant;
- processing real personal, financial, support, analytics, or credential data;
  or
- payment, mandate, bank, card, UPI, Account Aggregator, SMS, or inbox action.

PB-G00 is the first bounded gate. Preserve production recurrence semantics and
make the test deterministic by injecting a test clock. A gate may be marked
`PASS` only after current evidence is recorded; local preliminary evidence must
not be promoted to candidate, environment, recovery, security-owner, or beta
evidence.

## Consequences

- ADR-017 remains the historical planning decision, but its prohibition on all
  source changes is superseded for this bounded fake-data-only phase.
- Private Beta readiness and execution remain separate decisions.
- External CodeQL, immutable release evidence, accountable owners, legal/data
  decisions, a real environment, and final beta authorization remain blocked.
- Discovery of a high or critical advisory stops the gate until it is fixed or
  closed through specific evidence; it may not be silently ignored.
- Work stops at the documented human gate with no commit or push.

## Stop condition

Stop before any external setup, real identity/data, vendor, deployment, or beta
operation. After each bounded slice, record the remaining blockers and return
for human review before expanding its scope.
