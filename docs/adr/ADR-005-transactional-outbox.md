# ADR-005: Use a transactional outbox for durable notifications

- Status: Accepted (implemented in Milestone 3; human gate pending)
- Date: 2026-07-26

## Context

Writing reminder state and sending email in separate, non-atomic operations can
lose or duplicate a user-visible reminder. A message broker would add premature
operations for the MVP.

## Decision

Write a notification intent, delivery row, and outbox row in the same
PostgreSQL transaction. A worker claims bounded batches with
`FOR UPDATE SKIP LOCKED`, commits a short lease before network work, and
publishes with bounded exponential retry. Expired leases are recoverable.
Delivery is at least once; a stable uniqueness key makes the logical
user-visible result effectively once.

The reminder key includes recipient, household, commitment, scheduled local
date, channel, and offset. An occurrence UUID is trace metadata rather than key
authority because future occurrence rows may be replaced after a schedule
edit. Permanent or retry-exhausted failures enter a terminal state. A
reconciliation job repairs stalled work and suppresses work invalidated by
opt-out, rule changes, pause, archive, or occurrence replacement.

Immediately before provider work, the worker locks and version-checks the exact
preference snapshot, master switch, and selected channel. It also locks stable
household and commitment parents, requires the commitment to remain active at
the claimed version, and validates the exact occurrence, effective household
or commitment rules, and original activation cutoff. These parent locks
serialize all supported commitment, occurrence, and rule writers. Commitment
rule writes also lock the mutable commitment so archive cannot race a new rule
version.

This committed reconciliation transaction is the delivery-authorization
linearization point. A relevant change committed before it invalidates stale
work and requeues without consuming an attempt. Immediately before provider
I/O, a fresh transaction requires the exact claim token and unexpired leases,
renews both delivery and outbox leases, and rechecks the two-hour first-attempt
catch-up cutoff. Work authorized before a later mutation may already be in
flight; the worker deliberately does not hold a database transaction over
network I/O.

In-app delivery is effectively once through the database key. SMTP has an
unavoidable ambiguous-success window: the process can fail after the provider
accepts a message but before PostgreSQL records success. Local email therefore
remains at-least-once and uses a stable `Message-ID`; the product must not claim
absolute exactly-once email delivery.

## Consequences

PostgreSQL remains the only durable messaging dependency and Mailpit remains a
development-only capture service. Claim concurrency, crash recovery,
idempotency, quiet-hour deferral, retry, terminal state, fake-recipient
enforcement, and safe diagnostics require deterministic tests. A production
email provider, delivery contract, retention policy, and operational admin role
remain separately gated.
