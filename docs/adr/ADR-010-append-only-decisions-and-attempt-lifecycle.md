# ADR-010: Keep decisions and cancellation attempts append-oriented and separate from tracking

- Status: Accepted for Milestone 4 implementation
- Date: 2026-07-27

This ADR refines the attempt and verification lifecycle introduced by ADR-009;
it does not change ADR-009's user-attested trust boundary.

## Context

A cancellation guide does not prove that an external merchant service or
payment instruction changed. Occurrence rows can also be replaced after a
recurrence edit, two browser tabs can race an attempt update, and a retried POST
must not create duplicate decisions or attempts. Conflating an attested outcome
with commitment tracking would silently remove projections and reminders even
though M4 has no bank, merchant, or provider confirmation.

The existing category policy already defines which actions are safe for each
commitment category. M4 must preserve that authority, keep the service and
payment-mandate tracks independent, and let an owner abandon stalled work
without rewriting history.

## Decision

A renewal decision is an append-only event for one owned occurrence. The API
validates the requested action against the server-derived `reviewActions` and
stores immutable household, commitment, occurrence-date, expected-amount-kind,
currency, action, actor, and time snapshots. The latest decision for an
occurrence is current. Replacing a future occurrence cannot erase or reinterpret
an earlier decision.

Decision creation, attempt creation, verification, and feedback use an ASCII
`Idempotency-Key` from 16 through 100 characters. The binding includes the
authenticated owner, normalized operation, key, and canonical request
fingerprint. Replaying the same operation and payload returns the stable result;
reusing the key with another payload conflicts. Idempotency rows and domain
writes commit or roll back together.

An attempt requires an owned non-archived commitment and occurrence, the current
`CANCEL_WITH_PROVIDER` decision, and a current fictional guide. It snapshots
the occurrence, recurrence and money inputs, guide ID/version, required tracks,
verification due date, and savings period. There can be at most one unresolved
attempt for a commitment.

`SERVICE` is always required. `PAYMENT_MANDATE` is required for
`UPI_AUTOPAY`, `CARD_RECURRING`, `NACH_ENACH`, `APP_STORE`, and
`MERCHANT_DIRECT`; it is `NOT_REQUIRED` for `CASH_OR_MANUAL` and `UNKNOWN`.
Required tracks start `NOT_STARTED` and may transition:

- `NOT_STARTED` to `REQUESTED` or `CONFIRMED`;
- `REQUESTED` to `CONFIRMED` or `FAILED`; and
- `FAILED` to `REQUESTED` or `CONFIRMED`.

`CONFIRMED` and `NOT_REQUIRED` are immutable. A whole-attempt PATCH carries the
complete desired mutable track state and requires the quoted current ETag.
`completedAt` is assigned once, by the server, when every required track is
confirmed.

An unresolved attempt may be conditionally marked `ABANDONED`. Abandonment is
terminal, preserves the decision, guide snapshot, notes, and track history,
reverses any current quantified savings state, and allows a new attempt.
Abandonment never changes the commitment or occurrence.

The verification due date is the occurrence date plus one day in the household
calendar. After all required tracks are confirmed:

- `PENDING` may become `SELF_REPORTED`;
- on or after the verification due date, `PENDING` or `SELF_REPORTED` may
  become `VERIFIED` when the owner reports no debit, or `DISPUTED` when the
  owner reports a debit; and
- `VERIFIED` may later become `DISPUTED`.

`DISPUTED` is terminal. Verification requires the current attempt ETag and an
idempotency key. `VERIFIED` is always presented as **user-confirmed after the
due date**, not merchant, provider, bank, payment-network, or independent
verification.

Decisions, attempt states, completion, abandonment, verification, feedback, and
savings never update a commitment or occurrence status. Tracking, recurrence,
dashboard projections, and reminders continue unchanged until the owner
separately uses the existing conditional archive operation. Creating an attempt
against an already archived commitment fails; archiving never erases attempt
history.

Optional attempt and feedback notes are bounded plain text. They reject obvious
credentials and full account/payment identifiers, cannot supply a guide target
or file, are output-encoded, and do not enter operational logs or diagnostics.

## Consequences

M4 records what the owner decided and attested without pretending to execute or
observe an external action. Attempt history remains stable across recurrence and
guide changes, stale tabs cannot overwrite newer state, and retried requests do
not duplicate work.

The UI must keep two separations explicit: service cancellation is not payment-
mandate revocation, and a user-confirmed outcome is not the same as stopping
AutoPay Guard tracking. Automatic tracking changes, provider callbacks,
independent confirmation, binary evidence, and administrator operations require
a later approved design.
