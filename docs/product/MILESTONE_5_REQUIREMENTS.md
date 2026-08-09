# Milestone 5 requirements - household, privacy, and administration

Status: authorized for bounded fake-local implementation on 2026-07-27.
Implementation and autonomous fake-local acceptance passed on 2026-07-29. The
user explicitly approved Milestone 5 and separately authorized Milestone 6 on
2026-07-29.

## Outcome

The founder can invite a fake local user into a household, share selected
commitments read-only, and assign a non-authoritative responsibility label.
Users can inspect append-only privacy records and exercise real, bounded
export, timezone-correction, and deletion workflows. Separately authorized
staff can operate fictional guide versions, execute approved privacy work, read
redacted audit events, or inspect owner-authorized support diagnostics.

## Boundary

- Only seeded fake identities, fictional merchants, reserved `.example`
  targets, local PostgreSQL, Keycloak, Mailpit, and the existing BFF are used.
- M5 sends no invitation email. An owner transfers the one-time invitation code
  outside AutoPay Guard's modeled workflow.
- M5 performs an actual app-data export and actual app-owned local erasure. It
  does not claim legal compliance or fulfillment of
  a statutory process, and it does not delete a Keycloak account.
- Existing M2-M4 payment, provider, cancellation, attestation, and savings
  boundaries remain unchanged.
- Member authoring, owner transfer, real email, real providers or merchants,
  real personal or financial data, cloud or file storage, CSV import,
  production deployment, and legal/regulatory claims are deferred.

## Household authority and visibility

- Every existing household founder is represented by one immutable `OWNER`
  membership. Invitation acceptance creates a `MEMBER` membership.
- `OWNER` remains the immutable author and only mutation authority for all
  legacy M2-M4 household, commitment, reminder, decision, cancellation, and
  savings operations. `MEMBER` is read-only.
- Migration backfills every existing commitment to `PRIVATE` with no
  responsible member. It does not infer sharing, consent, or an invitation.
- Visibility is exactly `PRIVATE` or `HOUSEHOLD`.
  - `PRIVATE` is visible only to the household `OWNER`.
  - `HOUSEHOLD` is visible to the `OWNER` and active, currently consented
    `MEMBER` records.
- The same visibility predicate applies to commitment detail, occurrences,
  dashboard counts and totals, calendar, upcoming items, decisions,
  cancellation guides and attempts, savings, notifications, and diagnostics.
  Aggregate responses include only records visible to the caller.
- A shared commitment may reference one active member as
  `responsibleMemberId`. The label is optional, is cleared when visibility
  becomes `PRIVATE`, and is a planning label only. It grants no authorship,
  edit right, payment authority, provider access, notification subscription,
  or ownership.
- The owner cannot be transferred or removed in M5. Removing a member is
  conditional and atomically clears that member's current responsibility
  labels. Historical snapshots and audit events remain redacted and intact.
- Foreign, private, removed, and nonexistent object identifiers retain the
  existing non-enumerating not-found behavior. A visible member object may
  return forbidden for a mutation the member is not allowed to perform.

## Fake-local invitations

- Only an `OWNER` with a current `HOUSEHOLD_SHARING` grant may invite an
  existing allowlisted fake identity.
- Creation uses a cryptographically secure opaque code containing 256 random
  bits. The plaintext is returned once, never persisted, and never appears in
  a URL, log, problem detail, metric, trace, audit event, or later read.
- PostgreSQL stores only the code digest and invitation metadata. Acceptance
  compares the presented code safely, requires the authenticated intended
  invitee, and never treats the code alone as identity.
- An invitation expires exactly 24 hours after creation, may be revoked before
  acceptance, and may be accepted at most once. Acceptance, revocation,
  expiry, replay, and concurrent acceptance are deterministic.
- Acceptance requires the invitee to have acknowledged the current notice and
  hold a current `HOUSEHOLD_SHARING` grant. It creates one `MEMBER` row in the
  same transaction as the invitation transition and audit event.
- Duplicate active membership and more than one pending invitation for the
  same household/invitee pair are rejected safely.
- No invitation creates an SMTP, Mailpit, notification, or outbox record. The
  UI says: "Invitation created locally. No email was sent."

## Notices and household-sharing consent

- Notice acknowledgements are append-only records of subject, notice version,
  content SHA-256, and server timestamp. Migration faithfully backfills an
  existing M1 saved acceptance with its exact version and acceptance timestamp
  as `ACKNOWLEDGED`; that snapshot never becomes `HOUSEHOLD_SHARING` consent.
  A new notice version requires a new acknowledgement.
- Consent events are append-only `GRANTED` or `WITHDRAWN` events for the exact
  purpose `HOUSEHOLD_SHARING`, pinned to the acknowledged notice version.
  Current consent is derived from the latest valid event.
- The current grant is checked at invitation creation, invitation acceptance,
  every member-visible household read, and every transition from `PRIVATE` to
  `HOUSEHOLD`. Withdrawal takes effect without rewriting consent history,
  memberships, commitments, or audit events.
- Owner withdrawal suspends new invitations and member visibility. Member
  withdrawal suspends that member's shared reads. A later valid grant may
  restore authorization; no data is silently reclassified.
- Age confirmation remains a recorded self-confirmation, not identity or age
  proof. Notice acknowledgement is not described as blanket consent.

## Privacy requests

Privacy requests belong only to the authenticated subject. Creation is
idempotent and append-oriented; state transitions are server controlled and
audited. A request may be `REQUESTED`, `PROCESSING`, `READY`, `EXECUTED`,
`BLOCKED`, `EXPIRED`, `FAILED`, or `CANCELLED` only when the corresponding work
actually occurred. Only the requester may cancel, and only before
`PROCESSING`; cancellation appends its request and audit events.

### Export

- An `EXPORT` request produces one complete machine-readable
  `autopay-guard-export-v1` canonical UTF-8 JSON artifact for all app-owned
  data linked to the subject. Its top-level manifest contains `schemaVersion`,
  `generatedAt`, `subject`, `noticeAcknowledgements`, `consentEvents`,
  `memberships`, `households`, `notificationData`, `cancellationData`,
  `privacyRequests`, `auditEvents`, and `supportGrants`. Global fictional
  catalog content is represented by stable guide/merchant references rather
  than duplicated.
- The artifact includes a schema version and generation instant and preserves
  UUIDs, ISO timestamps, local dates, integer minor-unit money, nulls, event
  order, and uncertainty/provenance fields without browser recomputation.
- Object keys use lexicographic order. Arrays use their documented domain order
  or stable `(createdAt, id)` order. Instants use UTC `Z`; bytes contain no BOM
  or insignificant whitespace. SHA-256 covers the exact stored bytes.
- Access/refresh tokens, invitation and support-code digests, password or
  credential material, idempotency fingerprints, raw provider failures, and
  data belonging only to another subject are never exported.
- Canonical bytes and their digest are stored in PostgreSQL, not a filesystem
  or cloud/object store. The artifact expires and is physically removed no
  later than 24 hours after generation; request metadata may retain only its
  safe state, timestamps, size, and digest.
- The bounded artifact maximum is 5 MiB. The fake-local domain and test
  fixtures must fit completely. Oversize or incomplete generation becomes
  `FAILED`, stores no partial payload, and never becomes `READY`.
- Only the requesting subject may read the artifact. No staff role, household
  owner, or support code grants download access. Expired access returns a safe
  gone response and never regenerates implicitly.
- Generation is all-or-nothing. It may fail safely but may not mark an artifact
  ready if any in-scope row was omitted or the output was truncated.

### Correction

- A `CORRECTION` request accepts only one app-owned IANA timezone value.
  Display name, email, OIDC subject, locale, household data, financial data,
  and Keycloak attributes are not correctable in M5.
- `PRIVACY_ADMIN` may execute the request conditionally. The user timezone
  update, request transition, and redacted audit event commit in one
  transaction or all roll back.
- Execution revalidates the timezone, request state, subject state, current
  version, and fake-local boundary. It does not rewrite historical household
  timezone or event snapshots.

### Deletion and local erasure

- A `DELETION` request is executable only by `PRIVACY_ADMIN`, only for an
  eligible fake user, and only after locking and rechecking the complete
  subject/membership scope.
- Execution is blocked if any household containing the subject has another
  active member. The block changes no household or user data.
- For an eligible subject, one transaction cascades every sole-member
  household and its dependent M1-M4 records, removes short-lived export
  artifacts and other subject-only operational rows, physically removes the
  local user row, and writes a minimal tombstone and redacted audit event.
- The tombstone contains no raw OIDC subject, email, name, household,
  financial content, or request body. It contains a one-way,
  domain-separated digest bounded to fake-local OIDC subjects plus a random
  execution reference and timestamp so a later OIDC sign-in cannot silently
  recreate the deleted local identity.
- Append-only acknowledgements, consents, requests, and audit records remain
  append-only during normal operation. Deletion is their explicit erasure
  boundary; only the minimal tombstone and redacted audit event
  survive.
- Successful deletion is a documented terminal exception to durable response
  replay: its idempotency row would relink the erased request, so it is not
  retained. The key still serializes the in-flight transaction; a later retry
  receives the same non-enumerating not-found response as any erased request.
  Blocked deletion and every non-deletion transition retain normal durable
  idempotent replay.
- The canonical demo identity is protected by immutable server-side identity
  configuration and a persisted fixture marker. Its deletion execution always
  fails before mutation, including under direct API, retry, and concurrency
  tests.
- The UI says what will be deleted, what minimal tombstone remains, and that
  this local app operation does not delete an identity-provider account or
  establish legal compliance.

## Staff roles

The resource server validates issuer, audience, signature, expiry, and exact
case-sensitive API client roles. It maps only `USER`, `GUIDE_ADMIN`,
`PRIVACY_ADMIN`, `AUDIT_READ`, and `SUPPORT_READ`; unknown, realm-default,
email-derived, display-name-derived, or differently cased claims grant
nothing.

| Role | Allowed M5 authority |
| --- | --- |
| `USER` | Own consent/privacy records, owned household operations, member-visible reads, and owner-generated support codes |
| `GUIDE_ADMIN` | Guide drafts, publication/retirement heads, and redacted feedback review |
| `PRIVACY_ADMIN` | Privacy request queue plus conditional correction/deletion execution; never export download |
| `AUDIT_READ` | Redacted append-only audit reads only |
| `SUPPORT_READ` | Owner-code-scoped redacted diagnostic reads only |

There is no super-admin implication. Staff roles do not grant household
membership, legacy data mutation, export download, audit read, support read, or
another staff role unless that exact authority is also present. The browser
may hide unavailable navigation, but the API is the authorization authority.

## Guide administration and feedback

- `GUIDE_ADMIN` creates a draft by cloning an immutable published guide
  version selected by the server. The clone preserves guide, merchant, track,
  sequence, action type, target key, and target URI.
- A draft edit may replace only the risk notice, review interval from 30
  through 90 days, and existing step title/instruction text. Merchant, version,
  status, structural-review time, publication time, tracks, sequence, action
  type, targets, allowlist rows, and current-head state are not mass assignable.
- Draft writes require the current quoted ETag. Drafts are not returned by
  owner guide reads and cannot start an attempt.
- Publication locks the guide head, revalidates all M4 structural and target
  rules, converts the draft to a published version, creates the matching V4
  published-version/step/target lock rows, appends a head event and audit event,
  and advances the current-head pointer in one transaction.
- Earlier published rows and lock rows remain unchanged. Existing attempts
  retain their exact pinned version.
- Retirement appends a retirement head event and changes the current-head
  pointer atomically. It never updates a locked `PUBLISHED` version to
  `RETIRED`. Historical versions and attempts remain readable; no new guide or
  attempt resolves through a retired head.
- Concurrent publish, stale draft, stale head, retry, and retire races have one
  deterministic winner. Idempotent replay returns the original result and a
  reused key with another payload conflicts.
- The feedback queue exposes only feedback ID, guide ID/version, outcome,
  created timestamp, and review state. It excludes note, user, household,
  commitment, identity, amount, and target content. Review disposition cannot
  edit or retire a guide.
- Publishing means a fictional local guide became current. It is never
  described as merchant/link verification or provider action.

## Append-only redacted audit

- Each successful M5 invitation, membership, visibility, consent, privacy,
  guide, feedback-review, and support-code mutation appends its audit event in
  the same database transaction. Privacy and support diagnostic reads append a
  bounded access event without storing the presented code or returned data.
- An audit event contains only an ID, timestamp, actor role, allowlisted action,
  resource type, opaque resource reference, outcome, and correlation ID.
- Audit rows are append-only and have no update/delete application operation.
  They contain no email, name, OIDC subject, household or commitment title,
  amount, currency, note, request body, guide text/target, invitation/support
  code or digest, token, header, exception, or export content.
- Only `AUDIT_READ` may list the bounded, cursor-paginated audit view. The UI
  calls it a local application audit, not a legal compliance report or a
  complete infrastructure audit.

## Owner-authorized support diagnostics

- Only the household `OWNER` may generate or revoke a support code. The
  cryptographically random plaintext is shown once, stored only by digest,
  scoped to that household, revocable, and expires no later than 15 minutes
  after creation.
- `SUPPORT_READ` and a currently valid code are both required. The role without
  a code and the code without the role grant no access.
- The diagnostic response contains only allowlisted counts, enumerated status,
  resource versions, and timestamps. It contains no identity or contact data,
  IDs that enable another lookup, names, amounts, currencies, commitment or
  notification content, notes, guide/feedback text, targets, raw errors,
  tokens, codes, or digests.
- Support access is read-only. M5 has no impersonation, view-as-user, arbitrary
  account search, raw-log/Mailpit proxy, retry, resend, state change, provider
  contact, or household mutation.
- Expiry and revocation are checked transactionally at read time. The UI says
  the view is redacted local diagnostics and is not proof of incident
  resolution.

## API and conditional-write contract

All endpoints are authenticated JSON under `/v1`, except that a ready export
returns its canonical `application/json` artifact. Collection inputs use exact
enum/UUID/date/cursor/limit allowlists.

```text
GET    /v1/privacy/notices/current
GET    /v1/privacy/notice-acknowledgements
POST   /v1/privacy/notice-acknowledgements
GET    /v1/privacy/consents
POST   /v1/privacy/consents

GET    /v1/households/{householdId}/members
GET    /v1/households/{householdId}/invitations
POST   /v1/households/{householdId}/invitations
DELETE /v1/households/{householdId}/invitations/{invitationId}
POST   /v1/household-invitations/accept
DELETE /v1/households/{householdId}/members/{memberId}
PATCH  /v1/commitments/{commitmentId}/sharing

GET    /v1/privacy/requests
POST   /v1/privacy/requests
GET    /v1/privacy/requests/{requestId}
POST   /v1/privacy/requests/{requestId}/cancel
GET    /v1/privacy/requests/{requestId}/export
GET    /v1/admin/privacy/requests
POST   /v1/admin/privacy/requests/{requestId}/execute

GET    /v1/admin/cancellation-guides
GET    /v1/admin/cancellation-guides/{guideId}
GET    /v1/admin/cancellation-guides/{guideId}/versions
POST   /v1/admin/cancellation-guides/{guideId}/drafts
GET    /v1/admin/cancellation-guide-drafts/{draftId}
PATCH  /v1/admin/cancellation-guide-drafts/{draftId}
POST   /v1/admin/cancellation-guide-drafts/{draftId}/publish
POST   /v1/admin/cancellation-guides/{guideId}/retire
GET    /v1/admin/cancellation-guide-feedback
POST   /v1/admin/cancellation-guide-feedback/{feedbackId}/review

GET    /v1/admin/audit-events
POST   /v1/households/{householdId}/support-codes
DELETE /v1/households/{householdId}/support-codes/{supportCodeId}
POST   /v1/support/diagnostics/resolve
```

Privacy-request/cancellation, consent-event, draft, publish, feedback-review,
and privacy-execution POSTs require an ASCII `Idempotency-Key` of 16 through
100 characters. Invitation and support-code creation deliberately reject an
idempotency key: replay cannot return plaintext that was never persisted. Each
has a database-enforced single-active invariant, and concurrent creates have
one winner while the loser receives no code. Versioned draft, sharing,
membership, invitation, privacy request, privacy execution, feedback review,
head retirement, and code revocation require a quoted numeric `If-Match` as
applicable. Request bodies are exact discriminated schemas with
`additionalProperties: false`; server IDs, roles, owners, status, versions,
timestamps, digests, targets, artifact bytes, audit fields, and execution
outcome are never client assignable.

The BFF uses an exact method/path/query/header/body allowlist, same-origin
mutation checks, bounded request/response handling, server-side tokens,
timeouts, and `no-store`. Only the exact subject export route accepts a
canonical JSON response through its dedicated 5 MiB cap; it does not accept a
client URL, filename, media type, or content-disposition value. The BFF has no
arbitrary download, redirect, URL fetch, Mailpit/log proxy, role override, or
support/account lookup route. Generated OpenAPI contracts are the client
source of truth.

## Acceptance and stop condition

The detailed executable matrix is
`docs/testing/MILESTONE_5_ACCEPTANCE.md`. Empty-to-M5 and real V4-to-M5
migrations, authorization, privacy execution, guide concurrency, redaction,
BFF, desktop/mobile accessibility, and every M1-M4 regression must pass.

Work then stops at the Milestone 5 human gate. Milestone 6 remains blocked
until a human explicitly approves M5 and separately authorizes the next scope.
