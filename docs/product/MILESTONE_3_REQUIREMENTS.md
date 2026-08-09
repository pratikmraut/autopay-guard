# Milestone 3 requirements - reminders and notifications

Status: implemented with automated and Codex-delegated local acceptance passed
on 2026-07-27; human approval pending.

## Objective

Let the fake local user explicitly opt in to deterministic reminders for owned
recurring commitments, receive them in an authenticated in-app inbox and the
development-only Mailpit mailbox, inspect safe delivery status, and opt out
again. AutoPay Guard still does not move money, contact a merchant, revoke a
mandate, or send to a real address.

## Authorized deliverables

- Global notification preferences with explicit master, in-app, and local-email
  enablement.
- A preference timezone and optional quiet hours.
- Disabled-by-default household reminder templates and per-commitment
  `INHERIT`, `CUSTOM`, or `DISABLED` behavior.
- Reminder offsets from 0 through 90 days, minute-precision local send times,
  and `IN_APP` or `EMAIL` channels.
- A transactional notification intent, delivery record, and PostgreSQL outbox.
- In-app delivery and development-only SMTP capture in Mailpit.
- Bounded retry, dead-letter state, lease recovery, reconciliation, and
  owner-scoped diagnostics.
- An accessible preference center, rule editor, inbox, notification detail,
  read/unread control, and delivery-state presentation.

## Consent and defaults

- A missing preference record is a disabled synthetic version `0`. The first
  explicit `PUT` with `If-Match: "0"` creates it.
- Existing users, households, and commitments remain opted out after migration
  and startup. Migration never creates a notification or outbox event.
- Missing household rules are disabled and expose suggested 7-, 3-, and 1-day
  templates. Same-day offset `0` is available but not suggested or enabled.
- Missing commitment rules inherit the household default. A custom commitment
  rule set replaces, rather than merges with, the household default.
- A disabled master preference, channel, household rule set, commitment rule
  set, paused commitment, archived commitment, or invalidated occurrence always
  prevents a pending delivery.

## Time semantics

- The occurrence date and rule send time are resolved in the owned household's
  IANA timezone.
- Quiet hours are resolved in the explicitly saved preference timezone.
- Quiet intervals are start-inclusive and end-exclusive. Equal start and end
  are invalid; intervals may span midnight.
- A local time in a DST gap moves to the first valid instant after the gap. A
  local time in an overlap uses the earlier offset consistently.
- Quiet-hour deferral preserves the same logical reminder. If deferral would
  cross beyond the occurrence's local calendar day, the delivery is suppressed.
- Newly activated preferences or rules do not backfill reminders planned before
  their activation. Genuine scheduler downtime may be reconciled only within a
  two-hour catch-up window.
- Clocks are injected. An LLM, browser clock, database default timezone, or
  previous retry timestamp is never the scheduling authority.

## Idempotency and delivery

The stable semantic key is:

`recipient + household + commitment + scheduled date + channel + offset days`.

An occurrence UUID and rule UUID are nullable trace metadata, not deduplication
authority, because future occurrences may be replaced after a schedule edit.
Pending rows may be reconciled to a new rule or occurrence; an already delivered
logical reminder is never sent again because a row UUID changed.

The notification intent, delivery state, and outbox event are inserted in one
database transaction. Workers claim bounded batches with
`FOR UPDATE SKIP LOCKED`, short leases, and expired-lease recovery. Network
calls happen outside the claim transaction. Transient failure uses capped
backoff of 1, 5, 15, 60, and 360 minutes. Permanent or exhausted work becomes
terminal and visible through safe owner diagnostics.

Immediately before provider work, transactional authorization must still match
the exact preference version, active household and commitment versions,
occurrence, effective rules, and original activation cutoff. Rule writes must
serialize against commitment archive. A fresh pre-provider transaction must
own unexpired delivery and outbox leases, renew them, and recheck the two-hour
first-attempt catch-up cutoff. Invalidated work is deferred or suppressed
without calling the provider.

In-app delivery is effectively once through database uniqueness. SMTP is
at-least-once: a crash after SMTP accepts a message but before PostgreSQL records
success can cause a duplicate. A stable `Message-ID` helps Mailpit and operators
identify that ambiguity; the product must never claim absolute exactly-once
email delivery.

## Local email boundary

- SMTP is enabled only in the explicit development Mailpit mode.
- The recipient always comes from the authenticated local identity. Requests
  cannot provide or override an email address.
- Only configured fake suffixes such as `@autopayguard.local` and
  `.example.test` are accepted.
- The subject and body are generic. They exclude amounts, merchant/display
  names, payment rails, masked labels, tokens, and provider diagnostics.
- Recipient, message content, provider response, and raw exceptions are never
  logged or exposed through product APIs.

## API boundary

```text
GET /v1/notification-preferences
PUT /v1/notification-preferences

GET /v1/households/{householdId}/reminder-rules
PUT /v1/households/{householdId}/reminder-rules

GET /v1/commitments/{commitmentId}/reminder-rules
PUT /v1/commitments/{commitmentId}/reminder-rules

GET /v1/notifications
GET /v1/notifications/{notificationId}
PATCH /v1/notifications/{notificationId}

GET /v1/notification-diagnostics
```

Whole-resource preference and rule updates require quoted numeric `If-Match`
values. Missing, malformed, stale, foreign, and nonexistent resources retain
the Milestone 2 non-enumerating behavior. Request bodies never accept an owner,
recipient, provider identifier, delivery state, outbox state, attempt count,
or idempotency key.

Diagnostics are owner-scoped and read-only. They expose bounded counts, safe
states, oldest pending age, retry timing, and an enumerated failure category.
Admin queues, manual retries, raw errors, and role creation remain deferred.

## Non-goals

No renewal decisions, cancellation guides or execution, provider contact,
savings, imports, household sharing, privacy export/deletion, SMS, push,
WhatsApp, Gmail, Account Aggregator, real SMTP, production infrastructure,
payments, mandate revocation, or real data.

## Gate

- Empty-to-V3 and real V2-to-V3 migrations preserve prior data and checksums.
- Sequential and concurrent schedulers create one semantic notification.
- Transaction rollback leaves neither a partial notification nor outbox row.
- Worker leases, retry, dead state, provider outage, and reconciliation pass.
- Quiet-hour, timezone, DST, opt-out, pause/archive/edit, and fake-recipient
  suites pass.
- Every preference, rule, notification, and diagnostic path passes two-subject
  authorization tests.
- Mailpit captures only fake, minimal messages; repeated normal scheduling does
  not create another logical notification.
- OpenAPI/client drift, full tests, production build, desktop/mobile real-OIDC
  accessibility journeys, and prior milestone regressions pass.
- Work stops for human approval before Milestone 4.
