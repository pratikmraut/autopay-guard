# Milestone 4 requirements - Cancellation OS and honest savings

Status: authorized on 2026-07-27 after explicit human approval of Milestone 3.
These requirements define the bounded fake-local implementation and acceptance
contract. Milestone 5 administration, household sharing, privacy operations,
and audit tooling remain blocked.

## Outcome

An owner can record a category-safe renewal decision, read a current fictional
merchant guide, separately track merchant-service cancellation and
payment-mandate action, record the outcome after the expected debit date, and
see potential, self-reported, verified, and reversed savings without AutoPay
Guard contacting a provider or moving money.

## Boundary

Milestone 4 is a record-and-guide system only:

- The user performs every merchant, bank, card, app-store, or UPI action
  outside AutoPay Guard.
- AutoPay Guard never enters a PIN, OTP, password, payment credential, full
  account/card number, or full UPI ID and never claims to revoke a mandate.
- Guides and targets are fictional local fixtures. HTTPS targets use reserved
  `.example` hosts; demo app links use the non-production
  `autopayguard-demo` scheme.
- No target is accepted from a browser, note, CSV row, feedback body, or other
  untrusted content. The API never fetches a guide target and the BFF never
  redirects to one.
- Notes are optional, bounded plain text and reject obvious credentials and
  account identifiers. They are absent from operational logs.
- There is no file upload, image/document evidence, object storage, real
  merchant verification, real provider confirmation, or independent financial
  data verification.
- Decisions, attempts, verification, and savings never change commitment or
  occurrence status automatically. Tracking continues until the owner uses the
  existing explicit archive flow; the UI must make that separation clear.
- Guide administration, publishing, retirement, and feedback operations queues
  remain Milestone 5. M4 reads deterministic published fixtures and records
  owner feedback.

## Renewal decisions

- A decision belongs to one owned occurrence and snapshots its commitment,
  household, scheduled date, expected amount kind, currency, and allowed
  category action.
- Supported decisions use the existing deterministic category action policy:
  `KEEP`, `REVIEW`, `PAUSE_TRACKING`, `CANCEL_WITH_PROVIDER`,
  `DOWNGRADE_WITH_PROVIDER`, `SWITCH_PROVIDER`, `CONFIRM_BILL`,
  `COMPARE_PROVIDERS`, `DUE_DATE_READINESS`, `PAYMENT_CONFIRMATION`,
  `RENEWAL_READINESS`, and `TRACK`.
- The chosen action must be present in the occurrence's server-derived
  `reviewActions`. A loan, insurance, investment, utility, education, or other
  commitment can never manufacture a cancellation decision.
- Decisions are append-only and the latest decision for an occurrence is
  current. An idempotent replay returns the original response; a reused key
  with a different payload conflicts safely.
- A later recurrence edit may replace the occurrence row but cannot erase its
  decision snapshot or history.

## Versioned guides and freshness

- A guide is an immutable merchant/version pair with `DRAFT`, `PUBLISHED`, or
  `RETIRED` status, a required risk notice, structural-review instant, review
  interval from 30 through 90 days, publication instant, and immutable steps.
  The UI calls this a fictional structural review, never merchant verification.
- Only the latest `PUBLISHED` version is returned. Its exact ID and version are
  pinned into each attempt; later guide publication cannot rewrite an attempt.
- Steps belong to independent `SERVICE` and `PAYMENT_MANDATE` tracks, have a
  stable sequence, and use `INFORMATION`, `SAFE_LINK`, or `APP_DEEP_LINK`.
- A guide is `CURRENT` through its review-due date and `REVIEW_DUE` afterward.
  Review-due guides remain visible with a warning, but targets are omitted and
  a new attempt cannot be started.
- M4 seeds twenty structurally validated fictional published guides. This
  satisfies local coverage only and must never be described as real merchant
  verification.

## Safe target policy

Every non-information target must match an enabled, persisted allowlist entry
and all of these rules:

- the URI is absolute, ASCII, canonical, and contains no user-info, port,
  query, fragment, backslash, encoded authority delimiter, or path traversal;
- `https` uses an exact lowercase `.example` host and a normalized path beneath
  its configured prefix;
- `autopayguard-demo` uses the exact `mandates` host and a normalized path
  beneath `/service/`;
- no HTTP, JavaScript, data, file, UPI, intent, protocol-relative, mixed-case
  spoof, suffix-only host match, or open-redirect parameter is accepted.

Targets open only after an explicit user gesture and are labelled as external
demo guidance. `rel="noopener noreferrer"` is required for HTTPS links. If the
current user reports `UNSAFE_LINK`, later reads suppress targets for that user
and attempt creation is blocked for that guide version.

## Cancellation attempts

- An attempt requires an owned, non-archived commitment, its owned occurrence,
  a recorded `CANCEL_WITH_PROVIDER` decision, a current published guide, and an
  `Idempotency-Key`.
- The attempt snapshots occurrence date/amount kind/currency, guide ID/version,
  commitment recurrence and amount inputs, required tracks, and a deterministic
  twelve-month savings period.
- `SERVICE` is required. `PAYMENT_MANDATE` is required for `UPI_AUTOPAY`,
  `CARD_RECURRING`, `NACH_ENACH`, `APP_STORE`, and `MERCHANT_DIRECT`; it is
  `NOT_REQUIRED` for `CASH_OR_MANUAL` and `UNKNOWN`.
- Each track is one of `NOT_REQUIRED`, `NOT_STARTED`, `REQUESTED`,
  `CONFIRMED`, or `FAILED`. Required tracks may move from not-started to
  requested or confirmed, requested to confirmed or failed, and failed to
  requested or confirmed. Confirmed and not-required tracks are immutable.
- Track updates replace the complete track state, require the current ETag, and
  reject stale writers. `completedAt` is set once all required tracks are
  confirmed.
- At most one unresolved attempt exists for a commitment. An active attempt may
  be explicitly `ABANDONED` through its conditional PATCH. Abandonment is
  terminal, keeps the commitment and track history unchanged, reverses any
  current saving state, and permits a new attempt. A disputed, abandoned, or
  otherwise closed attempt never erases its history.

## Verification

- `verificationDueDate` is the occurrence scheduled date plus one day in the
  household calendar.
- `SELF_REPORTED` is allowed only after every required track is confirmed. It
  means the user reports completing the external steps; it is not proof that a
  debit stopped.
- `VERIFIED` is allowed on or after `verificationDueDate` only when all
  required tracks are confirmed and the user reports that no debit occurred.
  The UI must label this as **user-confirmed after the due date**, not bank,
  merchant, provider, or independent verification.
- `DISPUTED` is allowed on or after `verificationDueDate` when the user reports
  that a debit occurred. It reverses the current saving state but does not
  claim or initiate a refund.
- Valid transitions are `PENDING` to `SELF_REPORTED`, `VERIFIED`, or
  `DISPUTED`; `SELF_REPORTED` to `VERIFIED` or `DISPUTED`; and `VERIFIED` to
  `DISPUTED`. `DISPUTED` is terminal.
- Verification requires the current attempt ETag and an `Idempotency-Key`.
  Replays are stable; different payloads with a reused key conflict.

## Savings

Savings are deterministic records, never advice or a claim about a bank:

- The immutable period is the occurrence scheduled date through the day before
  its one-year anniversary.
- Fixed commitments sum the exact recurrence dates in that inclusive period
  multiplied by the fixed minor-unit amount.
- Estimated-variable commitments use the saved estimate for those exact dates
  and remain visibly `estimated=true`.
- Unknown-variable commitments create an unquantified attempt and no monetary
  savings event. They increment an `unquantifiedCount`; unknown is never zero.
- Arithmetic uses exact bounded integer minor units and one ISO currency. No
  frequency multiplier, average, division, rounding, foreign exchange, or
  cross-currency addition is allowed.
- An immutable `POTENTIAL` event is recorded at attempt creation when the
  amount is quantifiable. Later valid transitions append at most one
  `SELF_REPORTED`, `VERIFIED`, or `REVERSED` event for that attempt.
- Abandoning a quantified attempt appends one `REVERSED` event with an
  `ABANDONED` reason. Reporting a debit uses a `DEBIT_OCCURRED` reason.
- The savings summary uses only each attempt's current state and exposes
  potential, self-reported, verified, and reversed totals separately by
  currency. It never adds those states together or labels
  `SELF_REPORTED` as verified.

## Feedback

- Authenticated owners may submit `WORKED`, `OUTDATED`,
  `MERCHANT_CHANGED_FLOW`, or `UNSAFE_LINK` feedback for a guide reached
  through their owned commitment.
- Feedback accepts an optional safe note and an `Idempotency-Key`; it cannot
  change a guide, target, status, freshness date, or version.
- Reusing a key with another payload conflicts. Foreign and nonexistent
  commitment/guide pairs are indistinguishable.

## API

All endpoints are authenticated JSON under `/v1`:

```text
GET   /v1/decisions/inbox
POST  /v1/occurrences/{occurrenceId}/decisions
GET   /v1/commitments/{commitmentId}/cancellation-guide
POST  /v1/commitments/{commitmentId}/cancellation-attempts
GET   /v1/commitments/{commitmentId}/cancellation-attempts
GET   /v1/cancellation-attempts/{attemptId}
PATCH /v1/cancellation-attempts/{attemptId}
POST  /v1/cancellation-attempts/{attemptId}/verify
POST  /v1/cancellation-guides/{guideId}/feedback
GET   /v1/savings
```

Collection reads take an explicit `householdId`, bounded limit/cursor or date
range as applicable. Object reads and mutations derive ownership from the
authenticated subject. POST creation/verification/feedback operations require
an ASCII `Idempotency-Key` of 16 through 100 characters. PATCH and verification
require a quoted numeric `If-Match`. All client-controlled fields are exact
allowlists; server IDs, owner IDs, versions, guide targets, amounts, savings
states, timestamps, and verification source are never mass assignable.

## Acceptance

- Empty-to-V4 and real V3-to-V4 migrations preserve all prior data and V1-V3
  checksums; migration creates no decision, attempt, feedback, or savings event.
- Twenty fictional guides pass database and runtime link validation, freshness,
  two-track ordering, immutability, and exact-version pinning tests.
- Decisions, attempts, feedback, verification, and savings pass two-subject
  object authorization, validation, idempotency replay/mismatch, rollback, and
  concurrency tests.
- Unsafe scheme/host/suffix/user-info/port/query/fragment/encoding/traversal
  cases fail without reflecting the value or making a network request.
- Category restrictions, occurrence replacement, stale ETags, archive races,
  track transitions, verification dates, reversal, unknown amounts, estimates,
  recurrence boundaries, currencies, and overflow are deterministic.
- Desktop and mobile real-OIDC journeys cover reminder/upcoming decision,
  guide review, both tracks, self-report, savings separation, unsafe feedback,
  conflict, sign-out, keyboard operation, and Axe checks.
- The complete repository gate, production build, generated-contract drift,
  guarded fake-local live acceptance, migration checksum audit, and cleanup
  pass before the Milestone 4 human gate.
