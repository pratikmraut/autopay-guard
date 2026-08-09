# ADR-001: Start with a package-by-feature modular monolith

- Status: Accepted
- Date: 2026-07-26

## Context

The MVP has several domains but one small delivery team, one relational data
model, and no measured need for independent deployment or scaling. Distributed
transactions and service operations would slow the privacy and authorization
work that matters most.

## Decision

Build one Spring Boot API deployable, organized into feature packages with
explicit dependencies and architecture tests where framework compatibility
permits. Keep database ownership conceptually aligned to modules. Use direct
in-process application calls and domain events; use the transactional outbox
only at external/asynchronous boundaries.

## Consequences

Local setup, transactions, testing, and operations stay simple. Module boundary
discipline must be tested because the runtime does not enforce it. A module may
be split only after independent scale, release cadence, failure isolation, or
organizational ownership becomes a measured requirement.
