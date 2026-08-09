# ADR-013: Execute real privacy operations inside a bounded fake-local model

- Status: Accepted and implemented in Milestone 5
- Date: 2026-07-28

## Context

A request ledger alone would not prove that an export was complete or that
local data was deleted. M5 therefore needs real app-owned operations while
remaining honest about its fake-local scope, identity-provider boundary, and
lack of a legal-compliance determination.

Deletion is especially unsafe when a subject shares a household: cascading
the subject's data could destroy another member's records. Deleting the local
identity mapping without a tombstone could also let the same OIDC subject
silently recreate itself at the next sign-in.

## Decision

Privacy requests are subject-only, idempotent, append-oriented resources with
server-controlled `REQUESTED`, `PROCESSING`, `READY`, `EXECUTED`, `BLOCKED`,
`EXPIRED`, `FAILED`, or `CANCELLED` state. Only the requester may cancel, and
only before processing.

An export is a transactionally consistent, complete, at-most-5-MiB
`autopay-guard-export-v1` canonical UTF-8 JSON representation of all app-owned
data linked to the requesting subject. Object keys and array rows use
documented deterministic ordering; SHA-256 covers the exact bytes. It preserves
typed values and history and excludes security material and data belonging only
to someone else. Canonical bytes and digest are stored in PostgreSQL. Only the
requesting subject may download them. Artifact bytes are physically removed no
later than 24 hours after generation; no staff role can download them and
expiry never regenerates an artifact implicitly. Oversize or incomplete work
becomes `FAILED` and stores no partial artifact.

Correction is limited to the app-owned user timezone. A `PRIVACY_ADMIN`
conditionally executes a valid request; the timezone update, request
transition, and redacted audit event share one transaction. Historical
timezone snapshots are not rewritten.

Deletion is a `PRIVACY_ADMIN` execution against a fake user. The transaction
locks and rechecks the user and every membership. It fails before mutation if
any containing household has another active member or if the subject is the
canonical deletion-protected demo.

For an eligible subject, one transaction cascades each sole-member household
and its dependent records, removes export and subject-only operational data,
removes the local user, and writes a minimal tombstone and
redacted audit event. The tombstone keeps only a one-way, domain-separated
digest bounded to fake-local OIDC subjects, a random execution reference, and
a timestamp. Future sign-in checks the
tombstone and cannot silently recreate the local user. M5 does not mutate or
claim to delete the Keycloak account.

Successful deletion is the deliberate terminal exception to normal response
replay: its execution idempotency record is not retained because that record
would preserve a link to the erased privacy request. The idempotency key still
serializes the in-flight transaction. A later retry receives the same
non-enumerating not-found response as any erased request. Blocked deletions and
all non-deletion transitions retain normal durable idempotent replay.

Normal notice, consent, request, and audit history is append-only. The approved
deletion transaction is its explicit erasure boundary. Request
states describe work that actually occurred; an ungenerated export is not
`READY` and an unexecuted deletion is not `EXECUTED`.

## Consequences

Acceptance must reconcile every in-scope database row to the canonical export,
exercise artifact purge, inject transactional failures, and prove both
multi-member and canonical-demo deletion blocks. UI copy must distinguish app
data, the minimal tombstone, and the external identity-provider account.

Real identities, legal response periods, production retention, object/cloud
storage, identity-provider deletion, backups, restoration erasure, and
regulatory compliance determinations remain outside M5.
