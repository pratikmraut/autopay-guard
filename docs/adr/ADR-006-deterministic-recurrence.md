# ADR-006: Deterministic recurrence and occurrence projections

- Status: Accepted
- Date: 2026-07-26

## Context

Recurring obligations cross short months, leap years, custom intervals, and
household timezones. Deriving one due date from the previously clamped date can
silently drift a series. Generating an unlimited schedule can also create a
denial-of-service path, while calculating dates independently in the API and UI
would create reconciliation errors.

The Milestone 2 dashboard and calendar need reproducible projections, but they
must not imply that AutoPay Guard observed a bank debit or knows an unknown
variable amount.

## Decision

The Spring API is the only recurrence authority. It uses deterministic
`LocalDate` arithmetic; an LLM, browser, database timestamp, or external service
never decides recurrence, money, category policy, or ownership.

Each series has an immutable `anchorDate`. Occurrence `n` is calculated directly
from that origin:

- `WEEKLY`: `intervalCount * n` weeks;
- `MONTHLY`: `intervalCount * n` months;
- `QUARTERLY`: `3 * intervalCount * n` months;
- `HALF_YEARLY`: `6 * intervalCount * n` months;
- `YEARLY`: `intervalCount * n` years; and
- `CUSTOM`: `intervalCount * n` in an explicit `DAYS`, `WEEKS`, `MONTHS`, or
  `YEARS` unit.

`CUSTOM` requires its unit and all other frequencies reject one. Intervals are
positive and bounded. The implementation derives the first relevant series
index rather than looping from an arbitrarily old anchor.

Month-based schedules require one explicit policy. `LAST_DAY` maps every target
to its last valid calendar day. `ANCHOR_DAY` uses the anchor's original
day-of-month, clamps only when that target month is shorter, and restores the
original day in a later longer month. A clamped occurrence is never used as the
next origin.

The owned household's IANA timezone is used to derive `localToday`; scheduled
dates themselves remain `LocalDate`. The materialized horizon is inclusive from
`localToday` through `localToday + 90 days`. Creation and scheduled
reconciliation fill missing active occurrences idempotently. A unique
commitment/date key protects concurrent runs.

Schedule edits are transactional. Historical rows remain intact; only future
`UPCOMING` rows are replaced. Paused or archived commitments are excluded from
new projections and summary reads. `nextDueDate` is server-derived and never a
client authority.

Expected occurrence money remains one of `FIXED`, `ESTIMATED`, or
`UNKNOWN_VARIABLE`. Unknown is not zero. Amounts are bounded integer minor
units, and unlike currencies are returned as separate buckets.

Dashboard summaries use explicit household-local calendar windows rather than
frequency multipliers or fractional proration. For a requested `YearMonth`, the
monthly window is its first through last day inclusive. The annualized window
starts on that same first day and ends one day before the same date 12 months
later. The recurrence engine projects every occurrence in each window directly
from the anchor, even beyond the materialized 90-day rows.

Within each currency bucket, fixed and estimated-variable minor units are summed
separately with checked integer addition, then reported together as the known
total. Unknown-variable occurrences contribute only to explicit unknown counts.
The response also reports whether estimates are present. There is no foreign
exchange conversion, division, rounding, averaging, or silent zero.

## Consequences

Leap-day, month-end, interval, horizon-boundary, old-anchor, and timezone
behavior can be asserted with a fixed clock and property tests. The same engine
drives reconciliation, upcoming lists, calendar views, and summaries, so those
surfaces cannot invent competing dates.

The stored 90-day horizon is a projection, not proof of payment. Actual debit
confirmation and occurrence history transitions remain later milestones.
Changing these semantics requires an additive migration and explicit contract
versioning rather than silently reinterpreting stored commitments.
