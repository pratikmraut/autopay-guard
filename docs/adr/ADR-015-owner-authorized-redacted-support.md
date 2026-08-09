# ADR-015: Require owner authorization for redacted support diagnostics

- Status: Accepted and implemented in Milestone 5
- Date: 2026-07-28

## Context

A support role alone would create standing access to household data and invite
account lookup or impersonation. Raw logs, notification bodies, names, amounts,
notes, targets, and identity fields are unnecessary for the bounded diagnostic
question in M5 and would enlarge the disclosure surface.

The household owner needs a short, explicit way to authorize one diagnostic
view without sharing credentials or changing household state.

## Decision

Only the household `OWNER` may create or revoke a household-scoped support
code. It is cryptographically random, displayed once, persisted only by
digest, revocable, and expires no later than 15 minutes after creation. The
plaintext and digest never enter a URL, log, audit event, metric, trace,
browser storage, or later API response. Creation rejects an idempotency key
because the plaintext cannot be replayed. A single-active database invariant
gives concurrent creation one plaintext-returning winner.

A diagnostic read requires both the exact `SUPPORT_READ` JWT authority and a
currently valid owner code. Role alone and code alone grant nothing. The API
checks digest, scope, expiry, revocation, and owner/household state at read
time; a stale cached decision is not sufficient.

The response schema contains only explicitly allowlisted counts, enumerated
status, resource versions, and timestamps. It contains no identity/contact
data, reusable object identifiers, names, amounts, currencies, commitment or
notification content, notes, guide/feedback text, targets, raw errors, tokens,
codes, or digests.

Support resolution is read-only and appends a redacted access event without
the code or response. M5 exposes no impersonation, view-as-user, arbitrary
account search, raw-log or Mailpit proxy, retry, resend, provider contact, or
state-changing support operation.

## Consequences

Support access becomes explicit, short-lived, revocable, and narrowly scoped
rather than standing account access. Acceptance must use sensitive canaries to
prove absence from API, UI, logs, and audit, and must test the exact expiry and
revocation boundaries.

Production support identity governance, case management, emergency access,
incident evidence, remote logs, user impersonation, and remediation controls
remain deferred.

The UI must say that diagnostics are redacted and read-only and are not proof
of incident resolution.
