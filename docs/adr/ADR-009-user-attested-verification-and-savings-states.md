# ADR-009: Keep user-attested outcomes and savings states separate

- Status: Accepted for Milestone 4 implementation
- Date: 2026-07-27

## Context

M4 has no bank feed, provider callback, real evidence store, or independent
verification source. Calling an early completion report "verified" or combining
potential savings with verified savings would overstate the product's
knowledge.

## Decision

An attempt begins as `PENDING`. After required tracks are confirmed, the user
may mark it `SELF_REPORTED`. On or after the day following the expected debit,
the user may attest that no debit occurred (`VERIFIED`) or that a debit occurred
(`DISPUTED`). The API and UI always identify `VERIFIED` as user-confirmed after
the due date; it is not merchant, provider, bank, or independent verification.

Savings use exact recurrence dates in one immutable twelve-month period and
bounded integer minor units. Fixed and estimated-variable amounts stay
distinct; an unknown amount stays unquantified. Immutable events record
`POTENTIAL`, `SELF_REPORTED`, `VERIFIED`, and `REVERSED` transitions. Summaries
use the attempt's current state and expose each state separately per currency.

## Consequences

The product can show progress without making a false financial claim. A future
provider/bank confirmation source or evidence workflow requires a new trust
model, source field, retention/security design, migration, and human approval.
