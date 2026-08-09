# Architecture

## Context

```text
Browser
  |
  | secure HttpOnly session cookie
  v
Next.js web / BFF :3000
  |
  | short-lived bearer token on the server only
  v
Spring Boot API :8080
  |        |
  |        +--> Actuator health/readiness
  |        +--> bounded reminder scheduler/outbox worker
  |                    |
  |                    v
  |             Mailpit SMTP :1025
  v
PostgreSQL :5432

Keycloak :8081 --> OIDC authorization-code flow
Mailpit  :8025 --> development-only email inspection
```

The browser never receives a refresh token and never stores an access token in
`localStorage` or `sessionStorage`. The BFF holds encrypted session state in a
secure, HttpOnly, SameSite cookie and attaches the short-lived access token only
while making a server-to-server API request.

## Deployment shape

The API is one deployable modular monolith. Packages are organized by feature,
with explicit domain/application/adapters where that improves isolation:

```text
in.autopayguard.api
  identity
  household
  merchant
  commitment
  decision
  cancellation
  savings
  reminder
  notification
  importing
  privacy
  audit
  support
  common
```

Occurrences and recurrence policy live with the commitment feature because
their invariants and transactions are shared. Versioned household and
commitment rules live in the reminder feature; preferences, deterministic
scheduling, notification state, deliveries, and the outbox worker live in the
notification feature. Milestone 4 decisions snapshot occurrence context,
cancellation owns immutable guides, their bounded administration, and attempt
state, and savings owns the deterministic event ledger and summaries.
Milestone 5 adds consented household membership in `household`, subject rights
in `privacy`, an append-only redacted application audit, and owner-authorized
redacted diagnostics in `support`. Milestone 6 adds a bounded owner-controlled
CSV-import feature in `importing`; it owns upload validation, server-side
parsing, normalized preview jobs, deterministic duplicate classification,
confirmation/discard/expiry state, raw-storage prevention, and import rate
limits. It
calls the existing commitment application boundary only during explicit
confirmation. These features remain in the monolith until measured scaling,
deployment cadence, or team ownership provides a reason to split them.

The local runtime uses Compose. Production topology, provider choices, and
Terraform are out of scope; `infra/terraform` is documentation only.
The local non-superuser application role owns only the development application
database and schema so it can run Flyway and the API from one process. This is
not the production design: a later production milestone must separate a
migration owner from a runtime DML-only role.

## Authentication and local identity

Keycloak is the local OIDC provider. The web application uses authorization code
with PKCE through the BFF. The API is an OAuth2 resource server and accepts only
JWTs from the configured issuer/audience. It derives identity from the immutable
`sub` claim and maps it to a local user row.

In development only, a first authenticated request can reconcile the fake
subject with the seeded local user. Email/display claims are conveniences, not
authorization keys. Environment profiles must prevent development seeding or
implicit user creation from silently becoming a production behavior.

Authorization is enforced in repository queries and application services, not
only at the URL layer. `OWNER` and `MEMBER` are persisted household roles:
owners retain every mutation, while active, currently consenting members may
read only explicitly `HOUSEHOLD`-visible records. Exact case-sensitive client
roles separately authorize guide administration, privacy execution, redacted
audit reads, and support diagnostics. Email, display name, realm-default roles,
unknown roles, and case-confused role strings grant no authority.

## Data model and migrations

The immutable first Flyway migration contains:

- `users`: UUID primary key, unique OIDC subject, normalized email, display name,
  timezone, locale, monotonic adult-confirmation and initial privacy-notice
  acceptance/version fields, and timezone-aware timestamps.
- `households`: UUID primary key, owner user foreign key, name, default ISO
  currency, IANA timezone, and timezone-aware timestamps.

The second migration adds:

- `merchants` and normalized `merchant_aliases`: a read-only, fictional local
  search catalog;
- `commitments`: an owned household's recurring obligation, source/provenance,
  category-safe status, integer minor-unit amount or estimate, currency,
  recurrence origin and policy, visibility, and optimistic version; and
- `commitment_occurrences`: deterministic scheduled local dates and expected
  amounts, unique by commitment and scheduled date.

The third migration adds:

- an explicitly disabled-by-default notification preference row per user;
- versioned household and commitment reminder-rule sets with bounded channel,
  offset, and local-send-time rules;
- owned in-app notification intents with read state and a stable semantic key;
- per-channel delivery state and sanitized failure categories; and
- leased PostgreSQL outbox events for bounded concurrent processing.

The fourth migration adds:

- `occurrence_decisions`: append-only owned occurrence decisions plus immutable
  household, commitment, date, amount-kind, currency, and allowed-action
  snapshots;
- `cancellation_guides`, `cancellation_guide_versions`, and
  `cancellation_guide_steps`: immutable fictional merchant/version fixtures,
  structural-review/freshness metadata, risk notices, ordered service/mandate
  tracks, and typed actions;
- `cancellation_target_allowlist`: persisted exact `.example` HTTPS and
  `autopayguard-demo` mandate target boundaries;
- `cancellation_attempts`: owned versioned state with pinned occurrence,
  recurrence, money, guide/version, track applicability, twelve-month period,
  verification date, lifecycle, and bounded optional note;
- `cancellation_attempt_verifications`: append-only user-attested attempt
  transitions with the pinned attempt version and explicit attestation basis;
- `cancellation_guide_feedback`: owner/commitment/guide-version feedback with
  an enumerated type and bounded optional note;
- `savings_events`: immutable quantified state transitions and reversal reasons,
  linked to their attempt; and
- operation-scoped idempotency records binding an authenticated owner, route,
  key, request fingerprint, and stable result.

The fictional guide, step, target, and merchant additions are global seed
content, not user activity. V4 migration/startup creates no decision, attempt,
feedback, or savings event for an existing owner.

The fifth migration adds:

- immutable founder `OWNER` memberships, invitations with digest-only one-time
  codes, `PRIVATE`/`HOUSEHOLD` commitment visibility, and optional planning-only
  responsibility for one active member;
- append-only notice acknowledgements and purpose/version-pinned consent events;
- privacy requests and events, bounded canonical JSON export artifacts, and
  minimal domain-separated deletion tombstones;
- mutable guide draft state outside the immutable published rows, immutable
  lifecycle events, feedback-review state, and the current catalog head;
- allowlisted, append-only redacted local application audit events and their
  integrity locks;
- digest-only, household-scoped, expiring support diagnostic grants;
- M5 operation-scoped idempotency records and bounded rate events.

V5 backfills each founder as `OWNER`, preserves existing commitments as
`PRIVATE`, and faithfully converts an exact saved foundation notice acceptance
to an acknowledgement. It infers no sharing consent, invitation, privacy
request, artifact, audit event, support grant, responsibility, or staff role.

The sixth migration adds:

- owner- and household-scoped import jobs with bounded counts, state,
  optimistic version, keyed integrity/replay metadata, a database-enforced
  always-null raw-payload column, and a preview-availability lifecycle of at
  most 24 hours;
- normalized preview items and allowlisted row-error codes, without retaining
  invalid raw cell values, original filenames, or multipart metadata;
- optional exact catalog-merchant matches and deterministic schedule
  fingerprints for advisory `IN_FILE` and `EXISTING` duplicate classification;
- nullable import job, item, and fingerprint provenance on commitments, with
  foreign keys and one-commitment-per-import-item uniqueness for `CSV` sources;
  and
- database-serialized, one-way actor rate-lock rows for the separately bounded
  upload and confirmation operations.

V6 backfills no import job, item, rate lock, provenance, commitment, or
occurrence. Existing non-CSV commitments retain null import provenance.

Import rate and domain transactions use the existing subject `users` row as
their first mutation fence. Get-with-lazy-expiry, discard, scheduled expiry,
and eligible local deletion use the same user-first order before any import-job
or household lock. This serializes the import lifecycle with deletion without a
new lock table or a job-to-user lock inversion.

Each migration is additive and must upgrade an empty database and the previous
milestone snapshot without rewriting V1 through V5. V3 neither enables
delivery nor creates a notification or outbox event during migration; V4
creates no owner action or savings record; V5 creates no consent or privileged
operation; V6 creates no import or commitment activity. UUIDs are generated by
the application; system timestamps use `timestamptz`, while expected debit,
verification, and savings period boundaries remain `date`. Email, merchant
names, labels, financial values, notification content, cancellation/feedback
notes, guide targets, one-time plaintext codes and digests, idempotency keys,
export bytes, raw CSV content and digests, and raw provider responses are not
logged.

Commitment authority is derived through the household and active membership,
not from a request-supplied user identifier. Owner mutations join through the
exact `OWNER`; member reads additionally require current sharing consent and
`HOUSEHOLD` visibility. Private names, amounts, rows, and their aggregate
effects are excluded before projection or serialization. Responsibility is a
planning label for one active member and grants no mutation, payment,
notification, or provider authority. A confirmed import creates only private,
active, fixed-amount `CSV` commitments and records the exact import job, item,
and normalized schedule fingerprint that produced each commitment. The
provenance is server-derived, cannot be supplied by the CSV or client, and does
not infer sharing, responsibility, provider authority, or external
verification. M4 decisions, attempts, feedback, and savings remain owner-only.
Fictional guide content is globally readable through an eligible commitment,
while guide administration is isolated behind the exact `GUIDE_ADMIN` client
role.

## Deterministic recurrence and projections

An immutable local `anchorDate` is the recurrence origin. Each occurrence is
computed directly from that origin and its series index, never from the prior
possibly clamped result. `LAST_DAY` preserves the last valid day of each target
month; `ANCHOR_DAY` clamps in a short month and restores the original day in a
later month. Custom intervals require an explicit day, week, month, or year
unit.

Household timezone is used only to derive the local current date and projection
window. Scheduled billing dates remain `LocalDate`; system timestamps remain
instants. Creation and daily reconciliation idempotently fill the inclusive
local-today through local-today-plus-90-days horizon. A database uniqueness
constraint protects concurrent reconciliation. Schedule edits retain historical
occurrences and transactionally replace only future upcoming projections.

Money is an integer minor-unit value below the JavaScript safe-integer ceiling.
Fixed, estimated-variable, and unknown-variable commitments remain distinct.
Summaries are per currency and never add unlike currencies or silently turn an
unknown amount into zero. The monthly projection covers one explicit
household-local calendar month. The annualized projection covers the 12
calendar months beginning with that same month. Both project recurrence dates
from the immutable anchor; they do not use frequency multipliers, averages,
foreign-exchange conversion, division, or rounding.

## Controlled CSV import

The browser sends one selected file to the Next.js BFF and never parses it or
stores its bytes in browser persistence. The BFF allowlists only the four
import operations, independently bounds multipart size and read time, and
forwards the file to the API without logging or reflecting the filename,
boundary, or content. No arbitrary file, URL, network, mailbox, provider, bank,
card, UPI, spreadsheet, archive, document, or image ingestion exists.

The API is the sole CSV parser and normalization authority. Upload requires an
active household owner, the exact eight-column UTF-8 CSV contract, bounded
file/row/field sizes, strict structural parsing, formula and sensitive-content
rejection, and an operation-scoped idempotency key. A structurally valid upload
creates only a `PREVIEW_READY` job and normalized items. It creates no
commitment, occurrence, sharing state, notification, decision, or provider
action. Invalid rows persist only their row number and allowlisted error codes.
Raw CSV bytes exist only in bounded request memory and are never written to the
`PREVIEW_READY` transaction; the database constrains every `raw_payload` value
to SQL `NULL`. Request references are released when request processing returns,
without claiming physical JVM buffer zeroization. Duplicate guidance uses a deterministic
normalized schedule fingerprint; it is advisory, not fuzzy or model-derived.

Confirmation requires an explicit non-empty selection, current ETag, and a
separate idempotency key. The transaction locks and revalidates the job and
selected items, creates the private CSV commitments and deterministic
occurrences through the commitment boundary, attaches server-derived
provenance, records bounded audit/idempotency evidence, marks the job
`CONFIRMED`, and verifies the already-null raw-payload invariant atomically.
Discard and expiry create no commitments. Discard preserves the upload-time
processing-completed timestamp. A preview is unavailable after its deadline;
the scheduler, API startup, or first subsequent read/confirm/discard observation
transitions an overdue persisted row to `EXPIRED`. All import rate
and domain mutations acquire the subject user row before import-job or
household locks, matching eligible local deletion. Durable rate checks use
their own transaction and release it before the domain transaction, preventing
outer-transaction connection-pool starvation. Safe normalized provenance
remains subject to the existing privacy export and deletion lifecycle.

## Reminder scheduling and delivery

Notification delivery is opt-in at three layers: a global master preference,
an enabled channel, and an enabled effective household or commitment rule.
Absent preferences are represented as disabled version `0`; the first
conditional update creates the row. Household defaults are also disabled until
the owner explicitly saves them. A commitment can inherit, replace, or disable
those defaults.

The scheduler derives each occurrence's local send time in the household
timezone and stores the resulting instant. Gaps in a daylight-saving transition
move to the first valid instant; overlaps use the earlier offset. Quiet hours
are evaluated in the saved preference timezone using a start-inclusive,
end-exclusive interval. A deferred reminder is suppressed if deferral would
cross the occurrence's local calendar date. Activation never backfills older
reminders; genuine downtime catch-up is bounded to two hours. Production logic
uses injected clocks.

One logical reminder is keyed by recipient, household, commitment, scheduled
date, channel, and offset days. Occurrence and rule UUIDs are trace metadata,
not identity, because future occurrences are replaceable on commitment edits.
The notification intent, delivery state, and outbox event are inserted in one
transaction. Workers claim small batches with `FOR UPDATE SKIP LOCKED`, short
leases, and expired-lease recovery. Retry delays are bounded at 1, 5, 15, 60,
and 360 minutes; permanent or exhausted failures become terminal and visible
through owner-scoped diagnostics.

In-app effects are effectively once. SMTP delivery is at least once: a stable
`Message-ID` helps diagnose duplicates, but a process can crash after SMTP
acceptance and before recording success. The product therefore does not claim
exactly-once email.

## Decisions, guides, and cancellation attempts

A renewal decision is an append-only event for one owned occurrence. The API
validates the action against the existing server-derived category policy and
stores an immutable snapshot so a later recurrence edit or occurrence
replacement cannot rewrite history. The latest decision for an occurrence is
current. `CANCEL_WITH_PROVIDER` is available only for the consumer categories
already allowed by that policy.

Published fictional guide versions and their ordered steps are immutable.
Current-guide reads return only the latest published version and derive
`CURRENT` or `REVIEW_DUE` from an injected clock, the structural-review instant,
and the saved 30-to-90-day interval. Review-due guides remain readable, but
their targets are removed and they cannot start an attempt. An owner who reports
`UNSAFE_LINK` gets the same suppression for that exact guide version without
changing global fixture content.

Every actionable target is seeded and persisted; no request field can supply or
override it. The API reparses the URI at read and attempt time, validates the
exact scheme, host, and normalized path against the persisted allowlist, and
fails closed. It performs no DNS lookup or network request. The BFF proxies only
the product JSON API and has no arbitrary redirect route. The browser displays
an external-demo warning and navigates only after a user gesture.

Attempt creation requires the current cancellation decision, a non-archived
owned commitment and occurrence, a current fictional guide, and a valid
idempotency key. It pins all inputs that could otherwise change the guide
history, track requirements, verification date, or savings projection. The
whole attempt is an optimistic resource: conditional PATCH replaces the track
state and may abandon an unresolved attempt. Database constraints and
transactional checks permit at most one unresolved attempt per commitment.

Track and verification transitions are deterministic domain state machines.
`VERIFIED` means only that the owner reported no debit on or after the
household-local verification date. It is never an external confirmation.
Crucially, decisions, attempts, verification, feedback, and savings do not
change commitment or occurrence status. Existing recurrence, dashboard, and
reminder behavior continues until the owner invokes the existing conditional
archive operation.

## Deterministic savings ledger

The attempt snapshots one inclusive period from the occurrence date through the
day before its one-year anniversary. The API projects exact recurrence dates
from the pinned anchor and recurrence inputs. It uses checked integer
minor-unit addition: fixed and estimated-variable projections stay
distinguishable, unknown-variable amounts remain unquantified, and currencies
never mix. There are no frequency multipliers, averages, division, rounding,
foreign exchange, browser calculations, database-time calculations, or LLM
decisions.

A quantifiable attempt begins with one immutable `POTENTIAL` event. Legal
attestation or abandonment transitions append at most one corresponding
`SELF_REPORTED`, `VERIFIED`, or `REVERSED` event instead of editing prior
history. The current state is derived transactionally per attempt. Summary
queries group current amounts by currency and state, expose unknown counts and
estimate markers, and never add potential, self-reported, verified, or reversed
totals together.

## Household sharing, privacy, administration, and support

An owner can create one active, subject-bound invitation for a fake-local
identity only after acknowledging the current notice and granting the current
`HOUSEHOLD_SHARING` purpose. Invitation and support codes contain 256 random
bits, are returned once for manual transfer, and persist only as SHA-256
digests. Invitation expiry is exactly 24 hours; support grants expire no later
than 15 minutes. Neither workflow sends an email. Consent withdrawal suspends
authorization without rewriting visibility or consent history, and regrant
restores only the authorization that those durable rows already describe.

Privacy requests are subject-owned optimistic resources. Export generation
serializes the documented `autopay-guard-export-v1` inventory to deterministic
canonical JSON inside a transaction, stores its bytes and SHA-256 in PostgreSQL,
caps it at 5 MiB, and expires it in under 24 hours. Only the subject can
download it. Correction changes only the app user's validated IANA timezone
after `PRIVACY_ADMIN` revalidates the fake-local subject boundary. Eligible
deletion removes app-owned local data in one transaction, leaves only a
domain-separated one-way fake-local tombstone and redacted event, and blocks
silent reprovisioning. It does not delete or claim to delete Keycloak.

`GUIDE_ADMIN` drafts clone one published fictional guide version. Only the
risk notice, 30-to-90-day review interval, and existing step title/instruction
text can change. Publication revalidates the M4 structure and target allowlist,
then atomically writes immutable locks/lifecycle history and advances a
separate head. Retirement moves only that head; pinned attempt history remains
readable. `AUDIT_READ` sees only cursor-paginated allowlisted audit metadata.
`SUPPORT_READ` additionally needs a current owner-generated code and receives
only bounded counts, status/version values, and timestamps—never identity,
content, money, raw errors, impersonation, or mutation authority.

## API

All product endpoints use `/v1` and JSON:

```text
GET  /v1/me
POST /v1/households
GET  /v1/households
POST /v1/commitments
GET  /v1/commitments
GET  /v1/commitments/{id}
PATCH /v1/commitments/{id}
DELETE /v1/commitments/{id}
GET  /v1/commitments/{id}/occurrences
GET  /v1/commitments/upcoming
GET  /v1/merchants/search
GET  /v1/dashboard/summary
GET  /v1/dashboard/calendar
GET  /v1/notification-preferences
PUT  /v1/notification-preferences
GET  /v1/households/{householdId}/reminder-rules
PUT  /v1/households/{householdId}/reminder-rules
GET  /v1/commitments/{commitmentId}/reminder-rules
PUT  /v1/commitments/{commitmentId}/reminder-rules
POST /v1/imports
GET  /v1/imports/{importId}
POST /v1/imports/{importId}/confirm
DELETE /v1/imports/{importId}
GET  /v1/notifications
GET  /v1/notifications/{notificationId}
PATCH /v1/notifications/{notificationId}
GET  /v1/notification-diagnostics
GET  /v1/decisions/inbox
POST /v1/occurrences/{occurrenceId}/decisions
GET  /v1/commitments/{commitmentId}/cancellation-guide
POST /v1/commitments/{commitmentId}/cancellation-attempts
GET  /v1/commitments/{commitmentId}/cancellation-attempts
GET  /v1/cancellation-attempts/{attemptId}
PATCH /v1/cancellation-attempts/{attemptId}
POST /v1/cancellation-attempts/{attemptId}/verify
POST /v1/cancellation-guides/{guideId}/feedback
GET  /v1/savings
GET  /v1/privacy/notices/current
GET  /v1/privacy/notice-acknowledgements
POST /v1/privacy/notice-acknowledgements
GET  /v1/privacy/consents
POST /v1/privacy/consents
GET  /v1/households/{householdId}/members
GET  /v1/households/{householdId}/invitations
POST /v1/households/{householdId}/invitations
DELETE /v1/households/{householdId}/invitations/{invitationId}
POST /v1/household-invitations/accept
DELETE /v1/households/{householdId}/members/{memberId}
PATCH /v1/commitments/{commitmentId}/sharing
GET  /v1/privacy/requests
POST /v1/privacy/requests
GET  /v1/privacy/requests/{requestId}
POST /v1/privacy/requests/{requestId}/cancel
GET  /v1/privacy/requests/{requestId}/export
GET  /v1/admin/privacy/requests
POST /v1/admin/privacy/requests/{requestId}/execute
GET  /v1/admin/cancellation-guides
GET  /v1/admin/cancellation-guides/{guideId}
GET  /v1/admin/cancellation-guides/{guideId}/versions
POST /v1/admin/cancellation-guides/{guideId}/drafts
GET  /v1/admin/cancellation-guide-drafts/{draftId}
PATCH /v1/admin/cancellation-guide-drafts/{draftId}
POST /v1/admin/cancellation-guide-drafts/{draftId}/publish
POST /v1/admin/cancellation-guides/{guideId}/retire
GET  /v1/admin/cancellation-guide-feedback
POST /v1/admin/cancellation-guide-feedback/{feedbackId}/review
GET  /v1/admin/audit-events
POST /v1/households/{householdId}/support-codes
DELETE /v1/households/{householdId}/support-codes/{supportCodeId}
POST /v1/support/diagnostics/resolve
```

The initial household request carries explicit `ageConfirmed`,
`privacyNoticeAccepted`, and the configured notice version. The API accepts only
`true` confirmations for the current version and sets previously empty
timestamps atomically with household creation; no client operation can clear
them. V5 preserves that initial acknowledgement in the normalized append-only
notice history; purpose-specific sharing consent is never inferred.

Errors follow RFC 9457-style problem details with the
`application/problem+json` media type. Validation messages omit submitted
values. A caller-supplied correlation ID is accepted only after length and
character validation; otherwise the API creates one. The ID is returned in a
response header and logging context.

Every household collection or projection takes an explicit authorized
`householdId`; data is never silently aggregated across households, currencies,
or timezones. Owner-only M4 decision, attempt, and savings surfaces remain
owner-scoped. A member-visible collection applies consent and visibility in its
database query so private rows cannot affect counts, totals, calendars, or
response-size side channels.
Commitment reads return an ETag. Updates and soft archive require `If-Match`;
missing, malformed, and stale preconditions fail without overwriting a newer
version. A foreign or nonexistent household-scoped identifier has the same
not-found response.

Preferences, rule sets, and notification read state use the same quoted numeric
ETag and `If-Match` discipline. Notification lists are cursor-paginated and
owner-scoped. Diagnostics expose bounded operational state and sanitized
failure categories, never an unrestricted scheduler, retry, Mailpit proxy, or
administrator endpoint. Cancellation attempt replacement and verification also
require a quoted numeric `If-Match`. Decision, attempt, verification, and
feedback creation require an ASCII `Idempotency-Key` from 16 through 100
characters; a replay with the same authenticated operation and request
fingerprint returns the stable result, while the same key with another payload
conflicts without revealing data.

Actuator exposes liveness and readiness groups but not environment, beans, heap
dumps, or secrets. OpenAPI describes product endpoints and security; the
generated TypeScript client is checked for drift.

## Configuration and secrets

Configuration comes from environment variables. `.env.example` contains names
and explicitly non-secret defaults/placeholders; `.env` is ignored. The
development realm, database, and Mailpit never contain real user or financial
data. Local bootstrap fails clearly when required values are absent or retain a
`change-me` marker.

Local SMTP is disabled unless the explicit fake-email mode is enabled.
Recipients come only from the authenticated identity mapping and must end in
`@autopayguard.local` or `.example.test`; an API client cannot supply or
override an address. Email bodies are generic and omit commitment names,
merchant names, amounts, payment labels, credentials, and tokens.

No arbitrary outbound URL is accepted. Issuer and API URLs are operator
configuration, not user input. M4 cancellation targets are immutable fictional
fixtures and must match a persisted exact scheme/host/path allowlist. HTTPS uses
lowercase reserved `.example` hosts; demo deep links use only the exact
`autopayguard-demo://mandates/service/` boundary. Targets contain no user-info,
port, query, fragment, traversal, or encoded authority delimiter and never come
from a request, note, feedback body, or CSV content. Neither the API nor BFF
resolves, fetches, follows, or redirects to a target.

Invitation and support plaintext codes are shown once over authenticated local
responses and never reused as URLs. Only their SHA-256 digests persist. Export
artifacts stay in PostgreSQL rather than a filesystem or object store, and their
exact route is the only BFF path allowed to return the canonical JSON media,
fixed filename, digest, and at most 5 MiB.

## Contract generation

The API's runtime OpenAPI document is the source of truth. An explicit Maven
test mode exports a deterministic snapshot, normal test execution compares the
runtime contract (including security, status codes, required/nullability, and
schema constraints) with that snapshot, and a repository-owned generator
regenerates `packages/contracts`. CI rejects generated-client drift. Generated
artifacts are not hand-edited, and the web app consumes the generated package
through the pnpm workspace.

## Observability

Logs are structured and intentionally exclude JWTs, cookies, authorization
headers, email, financial values, merchant names, and request/response bodies.
The API records correlation ID, method, normalized route where possible, status,
duration, and safe error category. Health endpoints support local orchestration.
Owner-safe diagnostics report counts, oldest eligible outbox age, delivery
state, attempt count, and sanitized failure category without raw SMTP text.
Cancellation/decision telemetry may record only normalized route, outcome
category, duration, and aggregate counts. It excludes notes, feedback content,
guide targets, idempotency keys or fingerprints, decision/attempt payloads,
amounts, currency, merchant names, and user attestations. Metrics/traces beyond
the baseline are deferred without weakening the log redaction rules. M5
mutation and privileged privacy/support-read audit events contain only an ID,
timestamp, exact actor role, allowlisted action/resource type, opaque resource
ID, safe outcome, and correlation ID. Audit output is a local application
record, not a legal compliance report or complete infrastructure audit.

## Evolution constraints

- Expand-and-contract database migrations.
- Deterministic money and recurrence logic.
- Transactional outbox before external notifications.
- At-least-once processing plus stable idempotency keys.
- Object-level authorization tests with every new household-scoped resource.
- Exact least-privilege staff roles; no composite or inferred administration.
- One-time codes persist only as digests and never enter URLs, logs, audit,
  browser storage, notifications, or email.
- Privacy artifacts require a documented field inventory, canonical bytes,
  subject-only download, hard size/expiry limits, and physical purge.
- Published guide versions and attempt snapshots are immutable.
- User-attested verification and savings remain separate from commitment and
  occurrence tracking state.
- No binary evidence or user-supplied guide target without a new storage,
  retention, threat-model, and human approval decision.
- No network data source, payment capability, or production infrastructure
  without a new ADR, threat-model update, and human milestone approval.
