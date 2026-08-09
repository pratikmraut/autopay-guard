# ADR-014: Use exact staff roles, immutable guide heads, and redacted audit

- Status: Accepted and implemented in Milestone 5
- Date: 2026-07-28

## Context

M4 deliberately has no staff authority and protects published guide versions,
steps, and targets with full-row lock references. Updating a published row to
retire it would violate that immutability. A broad administrator role would
also combine guide content, privacy execution, audit, support, and household
authority without need.

Guide feedback notes and household identity are unnecessary to decide whether
a fictional guide needs review. Audit records must preserve accountability
without becoming a second store of personal, financial, code, target, or note
content.

## Decision

The resource server maps only exact case-sensitive API client roles:
`USER`, `GUIDE_ADMIN`, `PRIVACY_ADMIN`, `AUDIT_READ`, and `SUPPORT_READ`.
Unknown, realm-default, differently cased, email-derived, or name-derived
claims grant nothing. Each route declares its exact authority; no role implies
another role, household membership, export download, or super-admin access.

`GUIDE_ADMIN` asks the server to clone an immutable published guide into a
draft. The server clones tracks, order, action types, and target key/URI.
Draft edits are conditional and limited to risk-notice text, the 30-90-day
review interval, and existing step title/instruction text. Structural-review
and publication fields remain server controlled. Drafts are absent from owner
guide reads and cannot start an attempt.

Publication locks the current head and, in one transaction, validates all M4
structure and target rules, publishes the draft, creates the matching existing
V4 published-version/step/target lock snapshots, appends a head event and
redacted audit event, and advances a separate current-head pointer. Earlier
published versions remain unchanged and attempts remain pinned.

Retirement appends a retirement head event and changes the current-head pointer
in one transaction. It never changes a locked published row's status. A later
publication creates another immutable version and head event.

The guide-admin feedback view contains only feedback ID, guide ID/version,
outcome, time, and review state. It excludes note and all user, household,
commitment, amount, and target content. Reviewing feedback cannot mutate or
retire a guide.

Every successful invitation, membership, visibility, consent, privacy, guide,
feedback-review, and support-code mutation appends an allowlisted, redacted
audit event in the same transaction. Privacy and support diagnostic reads
append bounded access events. Events contain only event ID, time, actor role,
action, resource type, opaque resource reference, outcome, and correlation ID.
They are append-only and readable only by `AUDIT_READ`; audit access does not
confer mutation authority.

## Consequences

Guide history stays compatible with M4 lock rows, stale or concurrent head
operations have a deterministic winner, and staff compromise is bounded by
function. Publishing means only that a fictional local version is current; it
does not verify a merchant, link, cancellation, or provider action.

Production identity governance, staff provisioning/review, dual control,
external guide verification, target monitoring, full infrastructure audit,
and legal-compliance reporting require later approval.
