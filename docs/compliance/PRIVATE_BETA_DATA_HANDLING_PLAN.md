# Private Beta data-handling plan

Status: **unapproved planning proposal created on 2026-08-09.** It is not legal
advice, a compliance claim, a privacy notice, consent, retention approval,
vendor approval, or authority to process real personal/financial data.

## Current boundary

All accepted operation remains fake-local. Do not collect participant names,
emails, identities, commitments, amounts, merchant names, feedback, events, or
support content during this fake-data-only implementation/rehearsal phase.

Before any real-data beta, Indian fintech/privacy counsel and accountable human
owners must approve the purposes, documents, retention, rights, vendors,
incident process, and real-guide boundary relevant to that beta.

## Proposed purpose map - not approved

| Data class                           | Proposed purpose                                                     | Minimization rule                                                                             | Current decision         |
| ------------------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------ |
| OIDC identity and adult confirmation | Authenticate an invited adult and enforce subject access             | Immutable subject; minimum display/contact attributes; age confirmation is not identity proof | Unapproved               |
| Household/membership/consent         | Owner/member isolation and explicit sharing                          | Default private; invitation cap; current consent; no inferred authority                       | Unapproved               |
| Recurring commitments/occurrences    | User-directed tracking, forecasts and reminders                      | Deliberately entered fields only; minor-unit money; masked labels; no full credentials        | Unapproved               |
| Decisions/attempts/savings           | Preserve user choices and user-confirmed outcomes                    | Separate tracks/states; no provider/bank verification claim; protected-category rules         | Unapproved               |
| Notifications                        | In-app reminders under explicit preferences                          | In-app-only planning default; no content in external analytics                                | Unapproved               |
| Imports                              | Controlled owner bulk entry                                          | Existing bounded CSV contract; raw bytes never committed; normalized provenance only          | Unapproved for real data |
| Privacy/audit/support                | Rights handling, security accountability and bounded troubleshooting | Least privilege, redacted fields, owner-authorized diagnostics, no impersonation              | Unapproved               |
| Feedback and product events          | Evaluate usability and beta hypotheses                               | First-party allowlisted event names and coarse states only; no free text/amount/name          | Unapproved               |

## Always prohibited

Never request, store, transmit, log, or put in analytics a UPI PIN, bank
password, OTP, private key, full card number, full account number, full UPI ID,
session/access token, or full payment credential. The product must not initiate
a payment, revoke a mandate, log into a provider/bank/inbox, or claim an
external action occurred.

Support and feedback must not solicit bank statements, screenshots, raw CSV,
receipts, evidence files, provider credentials, or unnecessary financial
details.

## Proposed event allowlist

Implementation requires separate approval and tests. Candidate events should
describe only coarse product transitions, for example:

- invitation accepted/withdrawn;
- onboarding completed;
- commitment-count threshold reached;
- reminder rule enabled;
- renewal decision recorded by safe action category;
- cancellation workflow started/completed without merchant identity;
- user-confirmed savings-state transition without amount/currency in the
  general event stream;
- privacy request state transition;
- guide unsafe/outdated report category; and
- support contact opened/closed by severity category.

Exclude emails, OIDC subjects, names, free text, merchant/commitment names,
amounts, currencies where re-identifying, payment labels, guide notes, URLs,
credentials, tokens, codes, raw CSV, export bytes and exact financial dates.
Use an internal subject key only if the approved metric truly requires it;
define rotation/deletion and prohibit third-party reuse.

## Metric-definition decisions

Before collection, define and test:

- invited, eligible and activated denominators;
- activation as three commitments, one reminder rule and one renewal decision;
- a meaningful D30 action and matured-window handling;
- duplicate/retry/idempotency behavior;
- withdrawn/deleted participant treatment;
- timezone/reporting boundaries and small-cohort suppression;
- savings population/state/amount-kind/currency rules; and
- access roles, query review, export controls and publication thresholds.

Do not combine potential, self-reported, user-confirmed and reversed savings,
fixed and estimated amounts, or different currencies.

## Required lifecycle decisions

| Topic                        | Required human/counsel decision                                                     | Status   |
| ---------------------------- | ----------------------------------------------------------------------------------- | -------- |
| Participant notice and terms | Exact purposes, voluntary/free nature, limitations, contacts and withdrawal         | Blocking |
| Consent/versioning           | Which purposes require acknowledgement/opt-in and how withdrawal changes processing | Blocking |
| Retention/deletion           | Per-table/event/support/log/backup periods and legal/security exceptions            | Blocking |
| Correction/export            | Scope, format, authentication, deadlines and third-party/IdP boundaries             | Blocking |
| Identity offboarding         | Disable/delete order, tombstones, reinvitation and orphan prevention                | Blocking |
| Backup propagation           | How deletion interacts with immutable backups and restore                           | Blocking |
| Security/incident logs       | Minimal fields, India clock/retention/access and breach workflow                    | Blocking |
| Vendors/subprocessors        | Purpose, region, contract, security, deletion, incident and cross-border review     | Blocking |
| Real guide content           | Sources, disclaimer, monitoring, expiry and consumer-protection review              | Blocking |

## Environment and vendor boundary

No analytics, email, identity, cloud, storage, logging, monitoring, support, or
other vendor is selected or approved. Any proposal must include a purpose/data
flow, India-region/cross-border analysis, contract and subprocessor review,
security controls, access roles, retention/deletion, incident notification,
exit/export plan, cost authority, and explicit human approval before setup.

## Rights and incident planning

A future procedure must reconcile application and identity-provider data,
household ownership, active invitations, exports, corrections, deletions,
support/audit records, event data, notification state, backups and restored
data. It must identify what is deleted, retained, anonymized, restored, or
blocked and why. Codex must not decide the legal basis or reporting duty.

## Stop condition

No real-data schema use, analytics implementation, vendor configuration,
participant document, invitation, or processing may begin from this proposal.
Stop for specialist and human approval plus a separately authorized real-data
implementation phase.
