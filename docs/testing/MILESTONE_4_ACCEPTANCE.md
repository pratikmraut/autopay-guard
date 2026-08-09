# Milestone 4 acceptance

Status: implementation and autonomous fake-local acceptance passed on
2026-07-27. The user explicitly approved Milestone 4 and separately authorized
Milestone 5 on 2026-07-27.
Fake local data and fictional `.example` guides only.

## Preconditions

- Milestones 1 through 3 are human-approved.
- V1, V2, and V3 migration files and checksums remain unchanged.
- Only the fake local identity and its owned household are used.
- No real merchant link, provider contact, payment app, bank, credential,
  payment action, or independent financial data is used.

## Automated gate

Run from the delivery workspace:

```powershell
.\make.ps1 bootstrap
.\make.ps1 up
.\make.ps1 seed
.\make.ps1 check
```

The recorded result must cover every acceptance item in
`docs/product/MILESTONE_4_REQUIREMENTS.md`, including migration, authorization,
category policy, link canonicalization, guide freshness/version pinning,
idempotency, concurrency, attempt transitions, after-date verification, honest
savings states, unknown/estimated amounts, BFF allowlists, accessibility, and
all M1-M3 regression checks.

Run the separate guarded mutation/reconciliation verifier only against the
canonical fake-local stack:

```powershell
$env:M4_LIVE_ACCEPTANCE_ACK = "I_ACKNOWLEDGE_LOCAL_FAKE_M4_ACCEPTANCE"
.\make.ps1 m4-live
Remove-Item Env:M4_LIVE_ACCEPTANCE_ACK
```

## Autonomous local flow

1. Sign in with the fake local identity and select the canonical household.
2. Open the decision inbox and record a category-safe cancel decision for a
   reserved fake consumer commitment.
3. Review the fictional guide, structural-review/review-due dates, risk notice,
   and separate service and mandate tracks. Confirm no link leaves the
   allowlist and no copy calls the fixture merchant-verified.
4. Start an idempotent attempt, complete both tracks, and record a
   `SELF_REPORTED` outcome. Confirm the UI does not call it independently
   verified.
5. Confirm potential and self-reported totals remain separate and that
   canonical M2 projections are unchanged.
6. Exercise a true stale-tab ETag conflict and an idempotency replay/mismatch.
7. Submit `UNSAFE_LINK` feedback and confirm targets are suppressed for that
   user and a new attempt using that guide version is blocked.
8. Exercise a test-clock after-date `VERIFIED` outcome and later
   `DISPUTED`/`REVERSED` outcome through deterministic integration coverage.
9. Confirm a foreign identity receives uniform not-found behavior for every
   new object endpoint.
10. Sign out and confirm all decision, guide, attempt, and savings routes
    return to sign-in.
11. Archive all reserved live commitments and confirm no unresolved reserved
    attempt remains.

## Recorded result

- `.\make.ps1 check` passed from the delivery workspace in 675.9 seconds.
  Formatting, ESLint, strict TypeScript, generated-client drift, the production
  build, and every M1-M4 regression gate passed.
- Backend verification passed 105 Surefire tests and 26 PostgreSQL Failsafe
  tests: 131 total with zero failures, errors, or skips. This includes the real
  V3-to-V4 PostgreSQL upgrade, empty-history migration, catalog
  immutability/tamper detection, ownership, idempotency, concurrency, unsafe
  target suppression, attempt transitions, after-date verification, and
  savings-state coverage.
- Web verification passed 38 Vitest files / 227 tests. Six serial real-OIDC/BFF
  Playwright journeys passed on desktop and mobile Chromium in 7.5 minutes.
  The focused M4 journey also passed 2/2 after adding real maximum-length name
  and contract-maximum Indian-formatted amount containment checks.
- The additive V4 migration succeeded without changing V1-V3. Recorded
  checksums are V1 `-911544944`, V2 `1293017193`, V3 `-569287781`, and V4
  `-491296913`.
- `.\make.ps1 m4-live` passed in 5.6 seconds with the explicit fake-local
  acknowledgement. It verified stable decision and attempt idempotency,
  mismatch rejection, independent service/mandate tracks, self-reporting, a
  stale ETag conflict, unsafe-target suppression, separated savings states,
  and complete reserved-record cleanup.
- `.\make.ps1 seed` then idempotently reconfirmed four canonical commitments,
  explicit M3 preferences/rules, all 20 migration-backed fictional M4 guides,
  and authenticated M4 read surfaces without creating user records.
- Codex completed a human-style in-app review at desktop and mobile sizes:
  canonical totals, category-safe decisions, fictional safe targets, separate
  tracks, immutable attempt history, user-attested wording, state-separated
  savings, sign-out/protected-route behavior, and the absence of browser
  console warnings/errors all passed. The review exposed one mobile savings
  overflow; it was fixed and covered by maximum-length/maximum-amount browser
  regression checks.
- Independent backend, frontend, and integrated read-only reviews found no
  remaining Milestone 4 blocker after the responsive regression assertion was
  hardened to detect per-card overflow.
- The canonical household ends with four active commitments, ₹4,500 for July
  2026, ₹54,000 across the forward 12-month schedule, and no unresolved
  reserved attempt. API, web, PostgreSQL, Keycloak, and Mailpit are healthy.
- Local Gitleaks was unavailable, so no local Gitleaks pass is claimed. The
  checksum-pinned history scan remains mandatory in CI.
- Production deployment must use separate migration/schema-owner and runtime
  DML database roles. The local development stack intentionally does not claim
  that production privilege separation.

## Human gate

Gate passed. The user explicitly approved Milestone 4 and separately authorized
Milestone 5 on 2026-07-27.
