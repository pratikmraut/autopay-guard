# ADR-011: Use a deterministic immutable savings ledger

- Status: Accepted for Milestone 4 implementation
- Date: 2026-07-27

This ADR refines the savings mechanics introduced by ADR-009; it does not
change ADR-009's separation between savings states or verification provenance.

## Context

M4 has no bank feed, provider callback, real merchant confirmation, or evidence
store. Recalculating a historical amount from an edited commitment would change
the past, while adding potential, self-reported, and user-confirmed projections
would double count the same attempted cancellation. Frequency multipliers,
floating point, foreign exchange, or treating an unknown amount as zero would
also overstate what the product knows.

## Decision

Attempt creation pins the commitment version, currency, amount kind, fixed or
estimated minor-unit amount, anchor, frequency, interval, custom unit,
month-day policy, and occurrence scheduled date. Its immutable savings period
starts on that date and ends the day before `scheduledDate.plusYears(1)`.
Calendar arithmetic follows the accepted deterministic `LocalDate` and
month-end rules in ADR-006.

The API projects every recurrence date in that inclusive period directly from
the pinned anchor:

- a fixed commitment sums the pinned fixed minor-unit amount once per projected
  date;
- an estimated-variable commitment does the same with the pinned estimate and
  retains `estimated=true`; and
- an unknown-variable commitment remains unquantified, creates no monetary
  event, and contributes only to `unquantifiedCount`.

Arithmetic uses checked bounded integer addition and one ISO currency. It does
not use a frequency multiplier, average, division, proration, rounding,
floating point, foreign exchange, cross-currency addition, browser result,
database timezone, external service, or LLM.

A quantifiable attempt appends one immutable `POTENTIAL` event when it is
created. Legal attempt transitions may subsequently append no more than one of
each applicable `SELF_REPORTED`, `VERIFIED`, and `REVERSED` event. Events retain
the attempt, currency, amount, period, estimate flag, event type, applicable
reversal reason, and timestamp. Database uniqueness plus the operation
idempotency binding prevents retry or concurrency from appending the same event
type twice.

`SELF_REPORTED` means only that the owner says the external steps were
completed. `VERIFIED` means the owner reported no debit on or after the saved
verification due date and is labelled user-confirmed, not independently
verified. Abandonment appends a `REVERSED` event with reason `ABANDONED`; a
reported debit appends one with reason `DEBIT_OCCURRED`. A reversal preserves
the positive projected amount in the reversed bucket and supersedes the prior
current state; it does not initiate or claim a refund.

The current savings state is derived per attempt from its legal immutable event
sequence. Household summaries group current states by ISO currency and expose
potential, self-reported, verified, and reversed fixed/estimated totals
separately. They expose estimate flags and unquantified counts and provide no
grand total across states or currencies.

Only a `CANCEL_WITH_PROVIDER` attempt creates M4 savings. Downgrade, switch, and
other decisions may be recorded, but M4 has no new-price baseline and therefore
creates no savings for them. Refund recording or handling is out of scope.
Savings events never update commitment or occurrence status; the owner must
separately archive tracking if desired.

## Consequences

Every displayed amount is reproducible from an immutable input snapshot and
retains its uncertainty, currency, state, and user-attestation provenance.
Commitment edits cannot rewrite historical savings, and state-separated
summaries cannot exaggerate an outcome by adding the same projection more than
once.

A future downgrade/switch calculation, observed debit, provider confirmation,
foreign-exchange view, refund record, or independent evidence source needs a
new data contract, trust model, migration, and human approval.
