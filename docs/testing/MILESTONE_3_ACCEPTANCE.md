# Milestone 3 acceptance

Status: automated and Codex-delegated acceptance passed on 2026-07-27; human
approval pending; fake local data only.

## Preconditions

- Milestone 1 and Milestone 2 remain accepted.
- V1 and V2 migration files and checksums are unchanged.
- The selected household is explicitly owned by the fake local user.
- Email capture uses only the loopback Mailpit service and an allowlisted fake
  recipient. Never enter or use a real address.

## Deterministic policy

- Preferences and household rules are disabled until an explicit versioned
  save.
- Suggested household rules are 7, 3, and 1 days before the occurrence for
  `IN_APP` and `EMAIL`; offset 0 is optional and off.
- Commitment rules either inherit, fully replace the household rules, or
  disable reminders for that commitment.
- The stable semantic key is recipient, household, commitment, scheduled local
  date, channel, and offset. Occurrence UUID replacement must not create a new
  logical reminder for the same key.
- Quiet hours, DST resolution, activation cutoffs, catch-up bounds, retry, and
  SMTP ambiguity follow `docs/product/MILESTONE_3_REQUIREMENTS.md`.

## Automated gate

Run from the delivery workspace:

```powershell
.\make.ps1 bootstrap
.\make.ps1 up
.\make.ps1 seed
.\make.ps1 check
```

Acceptance evidence must cover:

- empty-to-V3 and real V2-to-V3 PostgreSQL migrations with prior rows and V1/V2
  checksums preserved and no migration/startup notification;
- preference and rule validation, explicit opt-in, synthetic version 0,
  missing/malformed/stale ETags, inheritance/replacement/disabled behavior, and
  duplicate-rule rejection;
- household timezone, preference timezone, half-hour zones, quiet boundaries
  spanning midnight, DST gaps/overlaps, activation cutoff, and bounded catch-up;
- sequential and concurrent scheduler deduplication, including replacement of
  a future occurrence UUID;
- atomic notification/delivery/outbox insertion and rollback;
- bounded `SKIP LOCKED` claims, abandoned-lease recovery, deterministic capped
  backoff, permanent failure, exhausted retry, and terminal diagnostics;
- opt-out, pause, archive, schedule/rule edit, and invalidated-occurrence
  suppression before provider delivery;
- allowlisted fake recipient enforcement, generic email content, stable
  `Message-ID`, Mailpit capture, and provider-outage recovery;
- two-subject object authorization for preferences, household rules,
  commitment rules, notification list/detail/read state, and diagnostics;
- strict BFF method/path/query/body/ETag rules and generated OpenAPI-client
  drift;
- accessible desktop and mobile preference, rule, inbox, detail, failure,
  empty, loading, conflict, and sign-out states; and
- all Milestone 1 and Milestone 2 regression checks.

## Recorded result

- Final `.\make.ps1 check`: passed in 666.0 seconds.
- Backend: 25 Surefire suites / 71 tests and 2 Failsafe suites / 25 PostgreSQL
  tests; 96 total with zero failures, errors, or skips.
- Web: 29 Vitest files / 137 tests; formatting, ESLint, strict TypeScript,
  generated-client drift, and production build passed.
- Real-OIDC/BFF/Axe browser matrix: M2 and M3 on desktop and mobile passed 4/4
  in 7.4 minutes.
- The post-hardening guarded live acceptance passed in 802.8 seconds: one
  direct Mailpit delivery, cross-minute semantic deduplication, a real Mailpit
  stop with transient retry/recovery, and quiet-hour defer followed by in-app
  opt-out suppression.
- The final guarded run added exactly two live-test messages. Mailpit contains
  four preserved messages across two successful runs. All are generic,
  fake-local, attachment-free, and use distinct stable semantic message IDs;
  no commitment, amount, rail, recipient diagnostic, or raw failure data is in
  their content.
- Cleanup passed: Mailpit healthy, all reserved live fixtures archived,
  preferences restored to enabled in-app/email with `Asia/Kolkata` and
  `22:00–07:00` quiet hours, no active lease, and canonical projections restored
  to ₹4,500 monthly and ₹54,000 for the 12-month forward schedule.
- Final concurrency audits found preference, commitment/rule-context,
  lease-expiry, and catch-up boundary races. The worker now validates and locks
  the exact preference and version, active household and commitment versions,
  occurrence, effective rules, and activation cutoff at its authorization
  linearization point. Rule writes serialize against commitment archive. A
  fresh pre-provider lease renewal and catch-up recheck close the remaining
  provider boundary. Five blocking PostgreSQL concurrency tests and two
  focused no-provider unit tests cover the hardening; the final re-audit found
  no remaining M3 blocker.
- Local Gitleaks was unavailable; no local scan pass is claimed. The
  checksum-pinned CI history scan remains required.

## Human flow

1. Sign in with the fake local identity and explicitly select the seeded
   household.
2. Open notification settings. Review the explicitly saved enabled in-app and
   fake-local email state, `Asia/Kolkata`, and `22:00–07:00` quiet hours.
   Synthetic disabled version-0 and first-save opt-in are covered by the
   automated tests; the canonical seed is intentionally already enabled.
3. Review the 7-, 3-, and 1-day household defaults. Confirm StreamBox and
   FitClub inherit, CloudNest is disabled, and Monsoon Utility uses custom
   2-day `10:00` rules.
4. Review the in-app inbox and detail state. Mark an item read/unread if
   desired; stale-write rejection is recorded by the automated two-tab flow.
5. Open Mailpit at <http://localhost:8025>. Confirm the four preserved messages
   use the generic subject/body, fake sender/recipient, and distinct stable
   `apg-…@autopayguard.local` IDs. The final guarded run added the most recent
   two.
6. Inspect diagnostics. No raw error, recipient, amount, merchant, token, body,
   or manual retry action may appear.
7. Review the recorded quiet deferral, opt-out suppression, outage retry, and
   cross-minute dedup evidence above.
8. Sign out and confirm protected notification settings, inbox, and detail
   routes return to sign-in.
9. Explicitly approve or reject Milestone 3.

Stop after this flow. Milestone 4 cancellation, provider-link, evidence, and
savings work remains blocked until explicit human approval.
