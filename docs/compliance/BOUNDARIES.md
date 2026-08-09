# Product and regulatory boundaries

This document records design intent and open questions. It is not legal advice
and makes no claim that AutoPay Guard is compliant with the Digital Personal
Data Protection Act or any payments/financial-services regime.

## Hard MVP boundary

AutoPay Guard records user-supplied recurring-commitment information and helps
the user make and document their own decisions. It does not:

- request or store a bank password, UPI PIN, OTP, private key, full card number,
  full bank account number, or full UPI ID;
- initiate a payment, move money, pay a bill, handle a refund, or directly
  revoke a UPI/card/NACH mandate;
- log into a bank, payment app, Gmail account, inbox, or Account Aggregator;
- read SMS in the MVP;
- provide personalized investment, insurance, lending, or credit advice;
- recommend cancelling an EMI, insurance policy, or SIP;
- act as a universal cancellation agent or claim merchant affiliation.

Users perform final merchant and mandate actions in the relevant merchant,
UPI, bank, card, or app-store application. Cancelling the service and revoking
the payment instruction are separate facts.

## Data-minimization rules

- Fake data only in local development and automated tests.
- Store commitment money as bounded integer minor units and ISO currency.
- Masked labels must not be reversible and must not contain a full credential.
- Retain only purpose-linked fields; process raw import content in bounded
  request memory without committing it to product storage.
- Keep tokens, secrets, personal/financial fields, and content out of logs and
  general analytics.
- Treat cancellation notes and guide feedback as optional bounded plain text;
  reject obvious credentials and account identifiers, and never log their
  content.
- Persist invitation and support codes only as SHA-256 digests after returning
  plaintext once for manual fake-local transfer. Neither code is an email,
  notification, URL, browser-storage, log, audit, or analytics field.
- Keep subject exports as canonical JSON in PostgreSQL only, cap them at 5 MiB,
  restrict download to the subject, and physically purge them in under 24
  hours.
- Evidence, if later approved, requires private storage, encryption, scanning,
  size/type limits, short-lived access, and a retention decision.
- Household visibility defaults must not expose private commitments.

## Milestone 2 local data inventory

Milestone 2 processes only details the fake local user deliberately enters:
household, fictional or manual merchant/display name, category, payment rail,
fixed amount or optional variable estimate, currency, recurrence dates and
timezone, and an optional strictly masked label. It derives occurrence dates,
upcoming projections, and per-currency summaries from those fields.

The purpose is to let the household owner organize and review recurring
obligations. The implementation does not connect to a bank, verify an account,
move money, recommend a regulated financial action, or contact a merchant.
Source is `MANUAL`, visibility is `PRIVATE`, and generated projections are
accessible only through exact authenticated household ownership. The fictional
merchant catalog contains no personal data and no live external link or fetch.

Full card/account numbers, full UPI IDs, PINs, OTPs, and high-confidence
credential patterns are rejected rather than stored. Users are instructed not
to upload secrets; this bounded guard is not a general data-loss-prevention
system. Unknown variable amounts remain unknown and must not be represented as
zero. A retention/deletion policy and real-data processing remain blocked
before any public beta.

## Milestone 3 local notification inventory

Milestone 3 adds only user-saved notification controls, reminder rules,
scheduled notification metadata, in-app read state, delivery/outbox state,
sanitized failure categories, and development-only email capture. Global,
in-app, and email delivery are disabled until the fake authenticated user
explicitly opts in. Migration and startup do not infer consent or create a
notification.

An email recipient is derived from the authenticated local identity and cannot
be supplied by a client. Development delivery accepts only
`@autopayguard.local` and `.example.test` recipients. Email content is generic:
it contains no commitment or merchant name, amount, currency, payment label,
account identifier, credential, or token. Mailpit and its captured messages are
local test infrastructure, not a production communications service.

The purpose is to remind the owner about a date they already chose to track.
The feature does not contact a bank or merchant, execute an action, infer a
financial recommendation, or expose a public scheduler, retry control, Mailpit
proxy, or operator console. In-app delivery is effectively once; local SMTP is
at least once and may duplicate if the worker fails after provider acceptance.
No exactly-once email claim is made.

Before real email or public beta, approve a purpose/consent and retention model,
recipient correction and suppression behavior, provider and data-processing
terms, authenticated-domain controls, bounce/complaint handling, abuse limits,
delivery monitoring, and deletion/export treatment for notification records.

## Milestone 4 local cancellation and savings inventory

Milestone 4 adds only fake-local, owner-scoped records needed to document a
user-directed cancellation workflow:

- an append-only renewal decision and immutable snapshots of the owned
  household, commitment, occurrence date, expected-amount kind, currency, and
  server-allowed category action;
- twenty globally seeded fictional guide versions, their ordered service and
  payment-mandate steps, structural-review metadata, risk notices, and exact
  `.example` or `autopayguard-demo` allowlist targets;
- an owned cancellation attempt with the pinned guide version, required-track
  states, lifecycle/version, recurrence and money snapshot, deterministic
  savings period, verification due date, and optional bounded plain-text note;
- user-attested verification state and its timestamp;
- immutable potential, self-reported, user-confirmed, and reversed savings
  records in integer minor units and one ISO currency, or an explicit
  unquantified marker for an unknown-variable amount; and
- owner guide feedback type plus an optional bounded plain-text note.

The purpose is to let the owner follow fictional guidance, record actions they
take elsewhere, preserve the state they reported, and understand a deterministic
projection. The data is never evidence that a bank, merchant, app store, card
issuer, or UPI application accepted or performed an action. `VERIFIED` means
only that the owner reported no debit on or after the configured follow-up
date. Every product surface must call it **user-confirmed after the due date**
and must not imply independent, provider, bank, or merchant verification.

No guide target, amount, owner, verification source, savings state, timestamp,
or version is accepted from untrusted content. Targets are inert fictional
fixtures: the API never fetches them and the BFF never redirects to them. Notes
and feedback are not evidence, cannot contain a file or URL target, and remain
out of logs and diagnostics. There is no upload, attachment, image, document,
object storage, malware-processing boundary, real merchant catalog, or real
provider contact in M4.

Decision, attempt, verification, and savings records do not change a commitment
or occurrence status. Tracking, projections, and reminders continue until the
owner separately invokes the existing archive operation. A payment-mandate
track is a user-maintained status, not a mandate instruction, revocation, or
confirmation from a payment system.

Savings are forward projections from the pinned recurrence and amount snapshot,
not observed account balances or avoided-debit facts. Fixed and estimated
amounts remain distinguishable, unknown-variable amounts remain unquantified,
currencies stay separate, and potential, self-reported, user-confirmed, and
reversed states are never added together. A `REVERSED` state records a changed
user attestation or abandonment; it does not initiate or claim a refund.

M4 owner records remain isolated from administration and support. M5 adds only
the bounded fake-guide administration, redacted audit, and owner-authorized
support surfaces documented below. Owner-reported unsafe-link suppression is
local to that owner and guide version. A real guide catalog, independent
verification, binary evidence, wider access, or production retention requires
a new approved data inventory, purpose and retention decision, threat-model
review, and specialist review where applicable.

## Milestone 5 local household, privacy, administration, and support inventory

Milestone 5 adds fake-local records and derived outputs for five bounded
purposes:

- household membership, one-time subject-bound invitations, explicit
  `PRIVATE`/`HOUSEHOLD` visibility, and an optional planning-only responsible
  member;
- append-only current-notice acknowledgements and
  purpose/version-pinned `HOUSEHOLD_SHARING` grant/withdraw events;
- subject-created export, app-timezone correction, and app-data deletion
  requests with append-only lifecycle events;
- fictional guide draft/head/lifecycle and redacted feedback-review state; and
- allowlisted local application audit metadata plus owner-authorized redacted
  support grants and diagnostics.

The purpose of sharing is to let invited adults see only commitments the owner
explicitly marks for the household. Members cannot mutate a commitment, receive
owner notifications, make a payment, contact a provider, record a cancellation
decision, or gain authority merely by being labelled responsible. Current
sharing consent is required for both owner and member. Withdrawal suspends
authorization without rewriting history or silently changing visibility.
M5 sends no invitation email; the owner manually transfers a one-time code.

The export is the documented `autopay-guard-export-v1` inventory of app-owned
subject data. It preserves historical states, nulls, integer money, timestamps,
and provenance in deterministic canonical JSON. Exact bytes and SHA-256 remain
in PostgreSQL for less than 24 hours, with a 5 MiB hard cap and subject-only
download. It is not a bank statement, provider record, legal disclosure
certificate, filesystem export, cloud artifact, or implicit regeneration
service. Oversize or incomplete generation is `FAILED`, never a partial ready
artifact.

Correction changes only the app user's IANA timezone after exact
`PRIVACY_ADMIN` authorization and fresh fake-local eligibility checks.
Historical snapshots do not change. Eligible deletion removes app-owned local
data in one transaction, leaves a minimal domain-separated one-way fake-local
subject tombstone and one redacted audit event, and prevents silent local
recreation. It does not delete, modify, or claim to delete the Keycloak account.
The canonical demo and a subject in a multi-member household are blocked before
mutation. Production retention, backup propagation, identity-provider
coordination, and legal-basis decisions remain unapproved.

Guide administration applies only to fictional local guides and exact reserved
targets. `GUIDE_ADMIN` can clone a published version, edit only existing
instruction/title text, risk notice, and a 30-to-90-day review interval, then
publish or retire an immutable head. It does not verify a merchant, target, or
provider. `AUDIT_READ` receives only append-only allowlisted metadata and the UI
calls it a local application audit, not a legal compliance report.

Support requires both exact `SUPPORT_READ` authority and a current
household-owner code. The response contains only bounded counts,
status/version values, and timestamps. It has no identity/content/money/raw
error data, account lookup, impersonation, retry, resend, or mutation power, and
is not proof that an issue was resolved.

## Milestone 6 controlled CSV import and hardening inventory

Milestone 6 adds only the owner-controlled CSV workflow and local engineering
exercises described in
`docs/compliance/MILESTONE_6_IMPORT_INVENTORY.md`. The fixed template carries
recurring-commitment fields; it cannot carry ownership, sharing,
responsibility, status, source, merchant IDs, URLs, payment credentials, or
provider instructions. Preview creates no commitment. Explicit confirmation
creates only active, private, fixed `CSV` commitments and their deterministic
occurrences.

Raw CSV bytes exist only in bounded request memory and have no read/download
surface. The API does not commit them to PostgreSQL, browser persistence,
application-controlled temporary files, logs, or audit; the database constrains
`raw_payload` to SQL `NULL` in every state. Invalid cell values are never
retained. Unconfirmed preview availability ends no later than 24 hours after
upload. Privacy export version 2 includes only subject-owned safe normalized
import provenance; app-data deletion removes eligible subject-owned import
rows. This local lifecycle does not claim JVM buffer zeroization or erasure from
production backups.

The M6 load and restore commands use fake local data and guarded disposable
resources. They are engineering evidence, not a production capacity,
availability, business-continuity, disaster-recovery, or legal-compliance
claim. Real users/data, remote sources, spreadsheet/archive/binary ingestion,
email/SMS/bank/Account Aggregator ingestion, cloud/object storage, merchant
contact, payment initiation, mandate action, and independent provider
verification remain outside scope.

## Private Beta readiness implementation boundary

On 2026-08-09 the user authorized bounded fake-data-only local implementation
and rehearsal, with no real users, real data, vendors, or production
deployment. Local source/test/document changes and seeded rehearsals are
allowed. The charter, operating model, guide plan, risk register, data proposal,
and gate matrix remain decision artifacts; they do not approve a purpose, legal
basis, privacy notice, consent, retention period, vendor, shared/cloud/
production environment, real guide, analytics event, invitation, participant,
or real-data processing.

The proposed future cohort is capped at 50 invited adults as a hypothesis, but
no identity or recruitment list may be created in this phase. All accountable
owners remain human decisions. CodeQL remains not run, the Compose stack
remains development-only, and the fictional guide dates/targets remain
unchanged.

Before any real-data beta, a separately authorized phase must update this
inventory with approved purposes and lifecycles, close the security/environment
gates, assign operational ownership, complete candidate rehearsal, and obtain a
new explicit human go/no-go decision.

## Consent and rights design

M5 versions the local privacy notice and household-sharing purpose, records
append-only grant/withdrawal timestamps, and provides the bounded fake-local
export, timezone-correction, and app-deletion workflows above. This is product
behavior, not a legal-compliance claim. Age confirmation is limited to adults
18+ for launch; an age timestamp is not identity proof.

Human-approved documents required before any public beta include a privacy
notice, terms, AutoPay Guard cancellation/refund terms, grievance contact,
retention/deletion schedule, vendor agreements, and incident/breach workflow.

## Written specialist review required

Indian fintech and privacy counsel must produce or approve a perimeter memo
covering Account Aggregator, payment aggregation, BBPS, UPI ecosystem
participation, financial advice, consumer protection, DPDP implementation, and
app-store/mobile data-access rules before relevant scope or public beta.

Also required:

- data inventory and processing-purpose map;
- vendor/subprocessor and cross-border/region review;
- CERT-In point-of-contact, clock/log retention, and incident-reporting process
  where applicable;
- real merchant-guide disclaimer, verification ownership, feedback operations,
  link monitoring, and expiry process;
- trademark/domain review before adopting the final brand.

## Change control

Any proposal for payment initiation, real financial data, Account Aggregator,
SMS, inbox/receipt ingestion, assisted cancellation, negotiation, success fees,
personalized recommendations, real merchant guides or targets, independent
provider verification, binary evidence, WhatsApp, or production cloud resources
requires a new milestone, updated threat model and data inventory, written
perimeter review where relevant, and explicit human approval.
