# Milestone 2 acceptance

Status: automated and delegated browser gates passed on 2026-07-26; approved
for progression to Milestone 3; fake local data only.

## Deterministic dashboard fixture

Acceptance starts from one owned fake household in `Asia/Kolkata`, currency
`INR`, with these four active monthly commitments:

| Display name                    | Kind                | Amount (minor INR) | Anchor     | Policy       |
| ------------------------------- | ------------------- | -----------------: | ---------- | ------------ |
| M2 Fixture StreamBox Demo       | fixed               |             50,000 | 2024-01-31 | `LAST_DAY`   |
| M2 Fixture CloudNest Demo       | fixed               |            120,000 | 2024-01-15 | `ANCHOR_DAY` |
| M2 Fixture FitClub Demo         | fixed               |             80,000 | 2024-01-05 | `ANCHOR_DAY` |
| M2 Fixture Monsoon Utility Demo | variable, estimated |            200,000 | 2024-01-25 | `ANCHOR_DAY` |

Every household-local calendar month therefore has four projected
occurrences:

- fixed: `250000`;
- estimated variable: `200000`;
- known total: `450000`;
- unknown variable count: `0`; and
- `containsEstimates`: `true`.

The matching 12-calendar-month projection has 48 occurrences:

- fixed: `3000000`;
- estimated variable: `2400000`;
- known total: `5400000`;
- unknown variable count: `0`; and
- `containsEstimates`: `true`.

Unlike currencies must appear in separate buckets. An unknown variable amount
increments its explicit count and contributes nothing to a money total; the UI
must never present that as a known zero.

The seeder signs in through the normal local authorization-code flow and uses
only the authenticated BFF/API. Sequential reruns preflight every reserved
fixture and do not duplicate it. A host lock rejects concurrent seeders; the
script never steals or releases another process's lock. Conflicting, archived,
duplicate, or unrelated active rows cause a safe failure without deletion or
overwrite.

## Automated gate

From the repository root:

```powershell
.\make.ps1 bootstrap
.\make.ps1 up
.\make.ps1 seed
.\make.ps1 check
```

Acceptance evidence must cover:

- empty PostgreSQL migration and a real V1 user/household snapshot upgraded
  through V2 without changed V1 data;
- month-end clamp recovery, last-day behavior, leap years, every standard and
  custom interval unit, timezone-local horizon boundaries, and deterministic
  recurrence properties;
- 90-day idempotent reconciliation, concurrent uniqueness, transactional
  future-occurrence replacement, and archive exclusion;
- exact integer money, overflow bounds, fixed/estimated/unknown separation, and
  per-currency summaries;
- create, list, get, update, archive, occurrence, upcoming, calendar, summary,
  and merchant-search validation;
- missing, malformed, and stale `If-Match` handling;
- two-subject attempts against foreign households, commitments, occurrences,
  lists, summaries, and calendars;
- strict BFF dynamic path/query/method rules, server-side tokens, origin checks,
  and generated OpenAPI-client drift;
- responsive keyboard/axe coverage plus empty, loading, validation, upstream
  failure, and optimistic-conflict states; and
- the retained real-Keycloak sign-in/onboarding/sign-out smoke flow.

The final Windows acceptance run completed in 131.1 seconds from the requested
STS workspace. It passed 30 backend tests, 2 PostgreSQL 18.4 migration tests, 21
Vitest files / 94 tests, formatting, ESLint, strict TypeScript, generated-client
drift, the Next.js production build, and the serial desktop Chrome plus Pixel 7
real-OIDC/BFF journeys with serious/critical Axe checks.

## Human flow

1. Sign in as the fake local user and select the owned household explicitly.
2. Create a fixed monthly commitment with a fictional catalog merchant.
3. Confirm the detail, upcoming list, calendar, current calendar-month totals,
   and 12-calendar-month projection.
4. Edit its amount and schedule; confirm the version changes and future
   projections reconcile without duplicate dates.
5. Simulate a stale edit from a second tab and confirm the newer value is not
   overwritten.
6. Create or inspect EMI/loan, insurance, and investment categories and confirm
   there is no cancellation, pause, downgrade, or switch recommendation.
7. Archive the test commitment and confirm it disappears from active lists,
   upcoming/calendar results, and summaries.
8. Sign out and confirm protected routes return to sign-in, browser storage has
   no bearer/refresh token, and prior Milestone 1 behavior still works.

Stop after this flow. Reminders, cancellation, imports, savings, household
sharing, real data, payments, and production remain blocked until a separate
human approval.

## Delegated browser result

The user performed the initial create/edit/archive review, then explicitly
delegated the remaining acceptance work to Codex and instructed it to proceed
to Milestone 3. Codex completed the real local browser flow against the exact
seeded household:

- four active canonical commitments, `₹4,500` monthly, and `₹54,000` for the
  forward 12-calendar-month schedule;
- August list and calendar contained only the four canonical dates, with the
  archived manual date absent;
- EMI/loan, insurance, and investment selections showed the required
  readiness/coverage/not-advice boundaries;
- a new fictional commitment was opened in two independently loaded edit tabs;
  tab A advanced version `1` to `2`, tab B received `412` as
  **A newer version exists**, and **Reload latest version** replaced both the
  stale name and amount;
- the fictional row was archived and disappeared from active tracking; and
- sign-out returned to the public landing page and a direct dashboard request
  redirected to `/signin?callbackUrl=%2Fdashboard`.

The autonomous test row was archived. The four canonical fixtures remained the
only active commitments.
