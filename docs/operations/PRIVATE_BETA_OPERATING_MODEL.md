# Private Beta operating-model plan

Status: **fake-data-only local rehearsal is authorized; no Private Beta
operation is authorized.** All human roles below are unassigned, no service
window exists, and the current local Compose stack must not be shared or
internet exposed.

## Purpose

Define the minimum accountable operating model that a later beta candidate
must prove with seeded data before any real adult is invited.

## Required human ownership

| Role                      | Accountability                                                      | Primary    | Backup     | Current status |
| ------------------------- | ------------------------------------------------------------------- | ---------- | ---------- | -------------- |
| Beta sponsor              | Scope, cohort, final go/no-go and shutdown authority                | Unassigned | Unassigned | Blocking       |
| Product owner             | Feature allowlist, participant expectations and metric definitions  | Unassigned | Unassigned | Blocking       |
| Release/engineering owner | Candidate, migrations, rollback/forward fix and technical changes   | Unassigned | Unassigned | Blocking       |
| Security/incident owner   | Risk gate, access review, detection, incident command and evidence  | Unassigned | Unassigned | Blocking       |
| Privacy/data owner        | Purpose, consent, rights requests, retention and breach assessment  | Unassigned | Unassigned | Blocking       |
| Operations owner          | Health, alerts, backups, daily review and service restoration       | Unassigned | Unassigned | Blocking       |
| Support owner             | Participant intake, redaction, escalation and response expectations | Unassigned | Unassigned | Blocking       |
| Guide/content owner       | Guide review, expiry, unsafe reports and emergency disable          | Unassigned | Unassigned | Blocking       |
| Metrics owner             | First-party event allowlist, query correctness and access review    | Unassigned | Unassigned | Blocking       |

One person may hold more than one role only through an explicit human decision
that also names a backup and conflict/escalation path.

## Service model decisions

Before a beta go/no-go, record:

- supported hours and timezone;
- on-call or best-effort response model;
- support channel and expected response times;
- planned maintenance and participant notice rules;
- deployment and rollback authority;
- invitation pause and complete beta shutdown authority;
- RPO/RTO hypotheses and backup schedule;
- monitoring/alert destinations and access; and
- who performs privacy, security, and guide reviews when the primary is absent.

No values are inferred from the local development environment.

## Invite-only identity operations

A future beta must be closed enrollment. Public self-registration and the
development first-request reconciliation path must fail closed. The approved
procedure must cover allowlisted provisioning, immutable OIDC subject binding,
duplicate/reinvitation handling, participant withdrawal, account disablement,
session revocation, recovery, lost-device handling and coordinated application/
IdP offboarding.

Every staff identity needs phishing-resistant MFA where supported, exact
least-privilege roles, grant/expiry/review records, session revocation, a
separately controlled break-glass path and audit evidence. Seeded tests must
prove unknown/default/case-confused roles, public registration and development
auto-provisioning grant no access.

## Proposed severity model

| Severity | Examples                                                                                                                                                                         | Required future response                                                                                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SEV-1    | Cross-household/staff authorization failure; personal/financial data exposure; credential collection; unintended payment/provider/mandate action; material destructive data loss | Immediately pause invitations and mutations where safe, preserve redacted evidence, notify incident/privacy owners, begin human-led assessment, and do not resume without written approval |
| SEV-2    | Core sign-in, commitment, reminder, privacy, import, or guide safety path unavailable; repeated notification failure; restore/backup failure without known data loss             | Stop cohort expansion, assign incident owner, mitigate or roll back, communicate through an approved channel, and require evidence before resuming                                         |
| SEV-3    | Degraded noncritical workflow, isolated support defect, stale non-actionable content, or performance outside a hypothesis                                                        | Triage in the daily review, document owner and target date, and escalate if impact grows                                                                                                   |
| SEV-4    | Cosmetic/documentation issue with no safety, privacy, authorization, or core-flow impact                                                                                         | Track through normal review                                                                                                                                                                |

Severity classification is a planning proposal requiring human approval. It is
not an incident-response legal determination.

## Mandatory immediate-pause triggers

A future operator must be able to pause invitations without deleting history
when any of these occurs:

- a suspected authorization or data-isolation defect;
- a real credential, OTP, full account/card number, full UPI ID, or unintended
  sensitive field is accepted, logged, exported, or exposed;
- a guide target is unsafe, redirects unexpectedly, is stale beyond policy, or
  lacks a current reviewer;
- a provider, bank, payment rail, or mandate action appears to have been
  initiated by AutoPay Guard;
- a HIGH/CRITICAL security finding becomes applicable;
- privacy export/deletion/offboarding or identity control is unreliable;
- monitoring, backups, or incident ownership is unavailable beyond the agreed
  tolerance; or
- support demand exceeds the approved handling capacity.

## Proposed daily operational review

During a later authorized beta, the named owner would record a dated review of:

1. application/API/identity/database health and declared availability;
2. latency, error rate, auth denials, scheduler lag, outbox age and notification
   failures without exposing participant content;
3. backup completion and most recent restore evidence;
4. open security findings and expiring risk decisions;
5. guide review-due, unsafe-report and disabled-target queues;
6. privacy/export/deletion/offboarding requests and deadlines;
7. support volume, severity and overdue responses;
8. cohort size, pauses, withdrawals and metric data quality; and
9. a signed continue/pause/escalate decision.

No such review is running now.

## Support handling boundary

Support must never request a password, PIN, OTP, token, private key, full
payment credential, full account/card number, full UPI ID, raw CSV, bank
statement, screenshot, or financial evidence. Prefer the existing
owner-authorized redacted diagnostic surface. Free text must be bounded,
redacted from operational logs, access-controlled, retained only for an
approved purpose, and excluded from general analytics.

Support cannot impersonate a user, alter a payment/mandate/provider state,
claim a cancellation succeeded, or override privacy/authorization controls.

## Release and change plan

A future candidate needs an immutable source identifier and exact image
digests. Required CI/security/migration evidence must attach to that candidate.
No direct production edit is allowed. A release record must name the approver,
backup, migration, rollback or forward-fix plan, feature flags/kill switches,
known risks, and participant communication impact.

Sanitized public source publication and repository-triggered CI were authorized
on 2026-08-09. This does not make the public commit a deployable beta candidate:
branch protection, reviewed remote evidence, release ownership, exact image
digests, rollback identification and every environment gate remain outstanding.

## Recovery and rehearsal

The M6 local restore drill is historical engineering evidence, not a beta
backup policy. A later approved rehearsal must use seeded data and prove the
declared environment's backup encryption, access, schedule, failure alert,
restore isolation, integrity checks, and measured RPO/RTO hypotheses. It must
also rehearse:

- invitation pause and restart;
- candidate rollback/forward fix;
- compromised/stale guide disable;
- notification-provider outage or in-app-only fallback;
- identity access removal;
- privacy export/deletion/offboarding;
- support escalation; and
- a simulated SEV-1 authorization incident with no real participant data.

## Stop condition

This operating model remains a proposal until every required role and decision
is assigned and a candidate rehearsal passes. The current phase may run only
bounded fake-local pre-rehearsals. Do not start service operations or contact a
participant.
