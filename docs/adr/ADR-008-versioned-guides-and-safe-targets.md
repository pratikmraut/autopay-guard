# ADR-008: Use immutable guide versions and exact safe-target allowlists

- Status: Accepted for Milestone 4 implementation
- Date: 2026-07-27

## Context

Cancellation instructions become unsafe when mutable history rewrites an
attempt, a stale guide remains actionable, or an arbitrary URL becomes a
redirect/deep-link primitive. M4 has no trusted admin identity, real merchant
verification, or reason to fetch an external target.

## Decision

Published guide versions and their ordered service/mandate steps are immutable.
An attempt records the exact guide ID and version it used. M4 seeds twenty
fictional `.example` guides; it does not claim that a real merchant was
verified. Admin authoring, publication, retirement, and operational feedback
queues remain Milestone 5.

Non-information steps contain only repository-seeded targets. At read and
attempt time, the API reparses and validates the target against an exact
scheme/host/path-prefix allowlist. Canonicalization rejects user-info, ports,
queries, fragments, traversal, encoded authority delimiters, suffix confusion,
and non-approved schemes. The API never follows the URI and the BFF never
redirects to it. Review-due guides and a version reported unsafe by the current
user expose no targets and cannot start a new attempt.

## Consequences

Attempt history remains explainable after a new guide version appears, and a
browser cannot turn guide data into an open redirect. A real catalog will need
human verification ownership, expiry operations, link monitoring, and an
admin/audit model in a later approved milestone.
