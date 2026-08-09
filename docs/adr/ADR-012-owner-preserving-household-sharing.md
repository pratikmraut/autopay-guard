# ADR-012: Preserve owner authority while adding consented household sharing

- Status: Accepted and implemented in Milestone 5
- Date: 2026-07-28

## Context

M1-M4 authorize every household mutation through one founder owner and make
every commitment private. Turning membership into co-ownership would silently
broaden commitment, reminder, decision, cancellation, savings, and diagnostic
authority. Sharing can also leak private financial data through derived totals
even when an object endpoint appears protected.

The fake-local stack has no invitation-delivery service. M5 also needs a
versioned record of what each subject acknowledged and whether household
sharing is currently allowed.

## Decision

The existing founder becomes the immutable household `OWNER`; an invited user
becomes `MEMBER`. M5 does not transfer ownership or let a member author or
mutate legacy data. Migration pins every legacy commitment's data author to its
founder, makes it `PRIVATE`, and sets no responsibility. An exact saved M1
notice acceptance is backfilled only as an `ACKNOWLEDGED` snapshot; it never
becomes sharing consent.

Visibility is exactly `PRIVATE` or `HOUSEHOLD`. Private data remains owner-only.
Household data is readable by an active member only while both the owner and
member hold the required current `HOUSEHOLD_SHARING` consent. The same
authorization predicate filters objects and every derived count, total,
calendar, upcoming, decision, cancellation, savings, notification, and
diagnostic view.

An owner may attach one active member to a shared commitment as an optional
responsibility label. It has no authorization effect and is cleared when the
commitment becomes private or that member is removed.

Invitation codes contain 256 cryptographically random bits, expire exactly 24
hours after creation, are bound to the intended authenticated fake subject,
and are accepted at most once. The plaintext is returned once; only its
SHA-256 is persisted. Code creation rejects an idempotency key because replay
cannot recover the plaintext. A single-pending database invariant gives
concurrent creation one code-returning winner. Codes and digests never enter
URLs, logs, audit events, browser storage, notifications, or email. M5 sends no
invitation email.

Notice acknowledgements and `HOUSEHOLD_SHARING` `GRANT`/`WITHDRAW` events are
append-only and notice-version pinned. Current consent is derived, not updated
in place. It gates invitation creation and acceptance, member-visible reads,
and new transitions to household visibility. Withdrawal suspends access
without rewriting membership, commitment, or consent history.

## Consequences

M5 can support useful household visibility without changing the trusted author
of existing financial workflows. The implementation must centralize the
visibility predicate; checking only a commitment detail route is insufficient.

Invitation transfer remains manual and fake-local. Member authoring,
co-ownership, owner transfer, member notification subscriptions, and real
invitation delivery require a later authorization, consent, conflict, and
migration design.

A lost invitation code must be revoked and replaced; it cannot be replayed or
recovered.
