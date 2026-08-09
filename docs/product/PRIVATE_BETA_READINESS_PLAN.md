# Private Beta readiness plan

Status: **fake-data-only implementation/rehearsal and sanitized public source
publication were authorized on 2026-08-09. Private Beta is not ready,
operational, or authorized.** This creates no real-user, vendor, shared/cloud/
production-environment, hosted-application, or deployment authority.

## Purpose

Define the evidence, accountable humans, and stop conditions that must exist
before AutoPay Guard can ask for a separate decision to invite any adult into a
Private Beta. This is not Milestone 7 and does not extend the approved M1-M6
product boundary.

Three states must remain distinct:

1. **Planning complete** - this readiness pack is internally consistent and
   reviewed.
2. **Beta ready** - every blocking gate has current evidence and accountable
   sign-off.
3. **Beta authorized** - after readiness, the human beta sponsor separately
   authorizes a named candidate, environment, cohort, and time window.

The current state is PB-G00 complete, bounded local readiness work authorized,
and Private Beta execution **NO-GO**.

## Non-negotiable phase boundary

This phase may change local source, tests, fixtures, and documents and may run
seeded local rehearsals. It must not:

- identify, invite, enroll, contact, interview, or store details for a real
  participant;
- enter, import, migrate, or process real personal or financial data;
- create a cloud, staging, shared, or production environment or buy a service;
- configure real email, DNS, domains, analytics, monitoring, identity, or
  support vendors;
- use the public source repository to deploy or enroll users; repository and
  repository-triggered CI are the only newly authorized external surfaces;
- publish real merchant guides or targets, contact a provider, or claim
  merchant verification;
- initiate payments, change mandates, access banks/cards/UPI/Account
  Aggregator/SMS/inboxes, or add automated financial advice; or
- describe local M6 load, restore, security, or browser evidence as production
  or Private Beta evidence.

## Proposed future cohort - not authorized

The source plan proposes no more than 50 invited adults in India. The cohort
cap is a hypothesis, not permission to collect names.

Before any invitation, a human-approved cohort policy must define:

- adult eligibility and the limitation that self-confirmed age is not identity
  proof;
- inclusion/exclusion rules and a prohibited-data notice;
- staged enrollment with explicit pause points (recommended cumulative
  invitation-cap hypothesis: 5 total, then 15 total, then at most 50 total);
- supported devices, browsers, timezones, currencies, and service hours;
- withdrawal, account offboarding, export, correction, and deletion handling;
- free participation with no success fee, advertising, or sale of personal or
  financial data; and
- a stop condition for incidents, stale guidance, support overload, or
  unreliable notifications.

No cohort stage advances automatically.

## Future feature boundary

Only the human-approved M1-M6 capabilities are candidates for a beta release.
Even those capabilities need a release-specific privacy, environment,
security, and operating decision.

The current twenty guides remain fictional fixtures with inert `.example`
targets. A future candidate must either disable the guide/cancellation surfaces
and their outcome metrics, isolate clearly fictional non-actionable training
content and exclude it from outcome metrics, or obtain a separate milestone
for a real-guide inventory, review evidence, link monitoring, expiry, updated
threat/data reviews, and specialist review. Planning defaults to the disabled
surface because real guides are not authorized. Real email is similarly
excluded unless a separate decision approves its purpose, vendor,
authenticated domain, suppression, bounce/complaint, monitoring, retention,
export, and deletion behavior.

## Readiness workstreams

| ID     | Workstream           | Required planning output                                                                                                                                                                            | Accountable human                        | Current state                                            |
| ------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------- |
| PB-01  | Governance           | Charter, cohort policy, feature allowlist, RACI, decision log, pause/stop rules                                                                                                                     | Beta sponsor / product owner             | Unassigned - blocking                                    |
| PB-02  | Source and release   | Repository decision, immutable candidate, protected workflow, release evidence                                                                                                                      | Engineering owner                        | Public source push authorized; controls/evidence pending |
| PB-02A | Invite-only identity | Closed provisioning/deprovisioning, public-registration and dev-auto-provisioning rejection, staff MFA/role review, recovery/session/break-glass/offboarding tests                                  | Identity, security and operations owners | PRELIMINARY/PARTIAL local controls - blocking            |
| PB-03  | Security             | CodeQL for Java and JS/TS, fresh scans, ASVS review, risk register, authorization review                                                                                                            | Security owner                           | CodeQL not run - blocking                                |
| PB-04  | Environment          | Approved India-region design, public ingress/origin/proxy/edge-abuse model, outbound egress allowlist, TLS/HSTS, private networking, secrets, encryption, separate migration/runtime roles, backups | Platform owner                           | PRELIMINARY/PARTIAL local controls - blocking            |
| PB-05  | Privacy and data     | Purpose map, minimization, notice/consent, retention, rights, IdP and backup handling, vendor review                                                                                                | Privacy owner and counsel                | Unapproved - blocking                                    |
| PB-06  | Operations           | Service hours, dashboards/alerts, daily review, incident/support/rollback/restore procedures                                                                                                        | Operations and support owners            | Unassigned - blocking                                    |
| PB-07  | Guide freshness      | Disabled, fictional-training or separately approved real-guide mode with mode-specific evidence and metric exclusions                                                                               | Guide/content owner                      | Mode unchosen - blocking                                 |
| PB-08  | Feedback and metrics | First-party event schema, feedback route, metric definitions, retention/access limits                                                                                                               | Product/data owner                       | Not designed - blocking                                  |
| PB-09  | Rehearsal            | Seeded candidate rehearsal, access tests, load/capacity record, restore and incident exercises                                                                                                      | Engineering, security, operations        | Fake-local pre-rehearsal authorized; not run             |
| PB-10  | Final go/no-go       | Evidence index and signed product/security/privacy/operations decision                                                                                                                              | Human beta sponsor                       | Not requested - blocking                                 |

The detailed gate states live in
`docs/testing/PRIVATE_BETA_READINESS_GATE.md`.

## Current baseline

PB-G00 passed on 2026-08-09. The stale-date failure was confined to the test:
production correctly preserves history and materializes upcoming occurrences
from household-local today. A class-scoped fixed test clock now makes the
integration fixture deterministic. The focused method, full integration class,
and complete delivery gate passed. The same gate discovered a new HIGH
`nanoid` advisory; version 3.3.17 was pinned through the workspace override and
lockfile, and the final production audit reported no known vulnerabilities.

## PB-G04A/PB-G06 preliminary local slice

ADR-019 adds application-level provider-independent rejection controls without
selecting a real provider or environment. Production identity configuration now
rejects development profiles, implicit provisioning and unverified email;
subject lookup cannot rebind by email; deletion tombstones remain effective;
API and web require exactly one allowlisted client role; and the local realm
fixture/reconciliation rejects public registration, permissive recovery flags,
external identity providers, unsafe client settings and unexpected role
mappings.

When explicitly selected, production-mode configuration validates API/web
modes and profiles, requires explicit non-local HTTPS destinations and exact
declared origins, rejects unapproved trusted-proxy/development/management/error/
schema surfaces, makes web-owned dependency calls fail on redirects, and
requires different configured runtime and Flyway usernames. Test endpoint
strings are not resolved or contacted and do not approve a host, domain,
vendor, or environment.

Both workstreams remain blocking. PB-G04A still needs `(iss, sub)` storage and
migration, reversible disablement, live session/token revocation, staff MFA,
recovery, break-glass, offboarding, a real approved IdP and human owners.
PB-G06 still needs deployment-level mode/profile pinning, network-level egress
and dependency-redirect evidence, database grants/object owners, a migration
credential isolated from the runtime process, an approved India-region/TLS/
edge/WAF/private-network design, managed secrets/KMS, backup/recovery, cost
authority, real hosts and named platform/security/operations owners. Local
PRELIMINARY/PARTIAL work is not beta-readiness or deployment evidence.

The final fake-local rehearsal rebuilt and seeded the stack, then passed the
complete synchronized delivery gate in 819.2 seconds: 301 Surefire, 29
Failsafe, four raw-request-gate and 488 Vitest tests passed; format, lint, type,
contracts, production build, dependency audit and Gitleaks passed; Playwright
recorded 24 passes and six guarded skips. Final parity covered 693 source files
with zero differences. This evidence does not change either blocked status.

## Proposed product hypotheses

These measures evaluate a future beta; they do not justify collecting data
now and are not promises:

- maximum 50 invited adults, kept separate from accepted and activated
  denominators;
- activation: at least three commitments, one reminder rule, and one renewal
  decision within a proposed 14-day window after invitation acceptance;
- at least 60% activation among accepted participants whose activation window
  matured, with invitation-to-activation reported separately;
- at least 25% day-30 retention among activated participants whose D30 window
  matured, where retention requires a defined meaningful review/action rather
  than login alone;
- zero severity-one data or authorization incident.

Only a candidate with a separately approved real-guide/action workflow may
test these additional hypotheses:

- at least 20% of activated participants reach an exact allowlisted terminal
  cancel, downgrade, or switch state; and
- median INR-only user-confirmed annualized savings of at least INR 1,000 per
  eligible participant who reaches a matured savings action.

The exact terminal states, verification maturity, missing/unmatured treatment,
per-participant aggregation, retry deduplication, withdrawals/deletions, and
fixed-versus-estimated reporting must be approved and tested before PB-G10 can
pass. Self-attested external action is not merchant-guide effectiveness.

Potential, self-reported, user-confirmed, and reversed savings must remain
separate. Do not optimize for cancellation count, and never steer users toward
cancelling loans, insurance, or investments.

## Privacy-minimized measurement rule

Before any analytics implementation, every proposed event needs an allowlisted
purpose, fields, retention, access role, and deletion/export treatment. General
analytics must exclude email, names, free text, merchant/commitment names,
amounts, payment labels, account identifiers, credentials, tokens, raw CSV,
support codes, and guide notes. No third-party analytics vendor is approved.

The beta metric denominator, duplicate/retry behavior, timezone boundary,
withdrawn/deleted-user handling, matured-window rules, terminal-state mapping,
and aggregation threshold must be testable before a dashboard is trusted.

## Required human decisions

The following are deliberately unresolved and may not be assigned by Codex:

1. beta sponsor/product owner and named security, privacy, operations, support,
   engineering, data, and guide owners;
2. branch protection, release ownership, license terms and acceptance of the
   authorized public repository's remote workflow evidence;
3. environment/provider/India-region architecture and spending authority;
4. counsel-approved basis, participant documents, retention, vendors, and
   incident obligations before real data;
5. whether a beta uses fictional guides only or requests a separately approved
   real-guide workstream;
6. whether beta notifications remain in-app only or request a separately
   approved real-email workstream;
7. service hours, severity owners, support channel, recovery objectives, and
   shutdown authority; and
8. final candidate/cohort/time-window go/no-go approval.

## Sequence and human gates

1. Complete and review this planning pack using fake data only. Completed.
2. Obtain approval for bounded fake-data-only implementation/rehearsal.
   Completed on 2026-08-09.
3. Close PB-G00 without changing production recurrence semantics. Completed.
4. Implement only bounded provider-independent local controls and label their
   results preliminary rather than candidate/environment evidence. Completed
   for the PB-G04A/PB-G06 slice on 2026-08-09.
5. Stop for the unresolved human and external decisions before creating an
   immutable candidate, running external CI/CodeQL, or selecting an environment.
6. Require every blocking readiness gate to be green and current.
7. Stop again for explicit Private Beta execution approval.
8. Only a later approval may identify or invite real adults.

## Public Beta gates remain separate

Private-beta planning or seeded rehearsals do not satisfy the later public-beta
requirements for specialist Indian legal approval and approved notices/terms/
retention, an independent penetration test, a formal incident-response
exercise, tested production restore, authenticated email delivery, or explicit
human production approval.

## Planning and local implementation completion

Planning is complete when the readiness plan, operating model, guide plan, risk
register, data-handling plan, and gate matrix agree. Each local implementation
slice additionally needs current tests, scans, documentation, and canonical/
delivery parity. Neither condition closes a beta execution gate.

## Stop condition

Stop at the documented human gate after each bounded local slice. Do not create
a repository or shared/cloud/production environment, run external CI, select a
vendor, invite anyone, process real data, or deploy without new explicit
authority.
