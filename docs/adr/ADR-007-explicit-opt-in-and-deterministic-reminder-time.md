# ADR-007: Require explicit opt-in and deterministic reminder time

- Status: Accepted (implemented in Milestone 3; human gate pending)
- Date: 2026-07-26

## Context

A stored reminder template is not permission to contact a user. Local send time,
household timezone, preference timezone, quiet hours, daylight-saving
transitions, downtime, and later rule edits can otherwise produce surprising or
irreproducible delivery. An occurrence UUID cannot be the logical identity
because Milestone 2 deliberately replaces future occurrence rows after a
schedule edit.

## Decision

Migration and startup never enable notifications or create reminder work.
Delivery requires an explicitly enabled global preference, enabled channel, and
enabled effective rule. A missing preference and missing household rule set are
synthetic disabled version `0` resources; their first conditional write creates
version `1`. Commitment rule mode is `INHERIT`, `CUSTOM`, or `DISABLED`, and a
custom set replaces rather than merges with household defaults.

Offsets are zero through ninety days and send time is a validated local
`HH:mm`. The occurrence local date and send time are resolved in the household
timezone. A daylight-saving gap moves to the transition's first valid instant;
an overlap chooses the earlier offset. Quiet hours are evaluated in the saved
preference timezone with start-inclusive and end-exclusive bounds. Overnight
intervals are supported and equal start/end is invalid. If quiet-hour deferral
would pass the occurrence's local calendar date, the reminder is suppressed.

Activation does not backfill work that was due before activation. At final
authorization, the effective rule and rule-set activation are revalidated
against the reminder's original planned instant, while trace data retains the
quiet-hour-adjusted scheduled instant. A later `INHERIT` override cannot
authorize older inherited work. Genuine downtime catch-up is limited to two
hours and is rechecked at the fresh pre-provider boundary for a first attempt.
All scheduling and worker decisions use injected clocks. One logical reminder
is keyed by recipient, household, commitment, scheduled local date, channel,
and offset; replaceable occurrence and rule UUIDs are trace metadata only.

## Consequences

Users must make an affirmative versioned change before any in-app or local
email delivery occurs. Scheduling is reproducible across retries and Java
runtime environments, including daylight-saving boundaries. Rule edits and
occurrence replacement cannot create a second logical reminder.

The two-hour catch-up and suppress-at-occurrence-date rules intentionally prefer
avoiding a surprising late notification over guaranteed eventual delivery.
Changing timezone, quiet-hour, opt-in, or semantic-key behavior requires an
explicit contract and migration review rather than a silent scheduling change.
