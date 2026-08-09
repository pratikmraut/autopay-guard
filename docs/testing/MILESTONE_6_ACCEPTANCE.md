# Milestone 6 acceptance

Status: authorized for implementation on 2026-07-29. Bounded local evidence
was recorded on 2026-08-03, and the permission-bound dependency advisory audit
plus the complete delivery quality gate passed on 2026-08-04. The user accepted
the documented external CodeQL deferral; no CodeQL pass is claimed. The user
explicitly approved Milestone 6 on 2026-08-04. Fake local data and controlled
CSV fixtures only.

## Preconditions

- Milestones 1 through 5 are human-approved.
- The user separately authorized Milestone 6.
- The canonical and delivery workspaces are synchronized.
- `.env` contains only generated fake-local credentials.
- PostgreSQL, Keycloak, Mailpit, API, and web run on loopback.

## Required commands

Windows PowerShell:

```powershell
$env:M6_LIVE_ACCEPTANCE_ACK = "I_ACKNOWLEDGE_LOCAL_FAKE_M6_ACCEPTANCE"
$env:M6_LOAD_ACCEPTANCE_ACK = "I_ACKNOWLEDGE_BOUNDED_LOCAL_FAKE_M6_LOAD"

.\make.ps1 bootstrap
.\make.ps1 up
.\make.ps1 seed
.\make.ps1 check
.\make.ps1 m6-live
.\make.ps1 m6-ui-live
.\make.ps1 m6-load
.\make.ps1 m6-restore

Remove-Item Env:M6_LOAD_ACCEPTANCE_ACK
Remove-Item Env:M6_LIVE_ACCEPTANCE_ACK
```

The guarded M6 commands must require the canonical fake-local environment,
serialize concurrent runs, use only reserved fixture names/IDs, clean all
created commitments/jobs/items/rate/idempotency/audit residue, and reassert the
four canonical M2 commitments and M1-M5 baseline.

## Acceptance matrix

| ID    | Area                         | Required evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M6-01 | Migration                    | Empty-to-V6 and populated V5-to-V6 migrations pass on H2 compatibility and PostgreSQL 18. V1-V5 checksums/rows are unchanged; no import job/item/audit/idempotency/rate event or `CSV` commitment is inferred.                                                                                                                                                                                                                                                                                                                                                                                                            |
| M6-02 | File boundary                | Only `.csv` plus exact `text/csv`, strict UTF-8, exact ordered header, 1-100 rows, eight columns and <=256 KiB pass. Empty/header-only, MIME/extension mismatch, malformed quoting, BOM misuse, invalid UTF-8, NUL/binary/control content, embedded newline, formula-like cells, oversize, excess rows/columns/field lengths, and archive/other file types fail without any import job/item, idempotency completion, audit, commitment, or content-bearing persistence and without logs containing content. One-way actor rate metadata may remain so rejected malicious uploads still consume the bounded upload budget. |
| M6-03 | Row normalization            | Names, categories, exact decimal rupees-to-paise, ISO currency, bounded frequency/date/rail, final-day policy, optional masked label, and sensitive-content rejection match commitment rules. Invalid rows retain only row number and allowlisted errors; raw CSV and invalid values are absent from committed tables/browser storage/temporary files/API/logs/audit, including before confirmation.                                                                                                                                                                                                                      |
| M6-04 | Merchant and duplicate logic | Only one exact category-compatible canonical/alias match attaches a merchant. In-file and active-existing exact schedule duplicates are deterministic. No fuzzy/LLM result, URL, host, guide target, or unsafe field is accepted.                                                                                                                                                                                                                                                                                                                                                                                         |
| M6-05 | Preview authority            | Upload creates a `PREVIEW_READY` job and normalized items only. No commitment/occurrence is created before confirmation. Owner reads return no-store, bounded fields and ETag; foreign/member/staff access fails without enumeration.                                                                                                                                                                                                                                                                                                                                                                                     |
| M6-06 | Upload replay/rate           | Upload requires a safe idempotency key and import rate budget. Same key/file/household replay is stable; key mismatch conflicts. Committed replay is free; truly simultaneous cross-instance attempts may each consume one bounded rate event before converging on one durable result. Parallel equivalent uploads have deterministic bounded results. Rate data uses only one-way actor keys. Rate and domain transactions do not nest database connections; concurrency at or above the configured pool size completes without starvation.                                                                              |
| M6-07 | Confirmation                 | Only 1-100 distinct valid item IDs are accepted. In one transaction, selected items are revalidated and created as active/private/CSV/fixed commitments with occurrences, unselected valid rows are skipped, the already-null raw-payload invariant is verified, the job is confirmed, and audit/idempotency snapshots commit. Unknown/invalid/duplicate IDs, stale/missing ETags, replay mismatch, injected rollback, and concurrent confirmation fail safely with no partial commitments.                                                                                                                               |
| M6-08 | Discard/expiry               | Discard requires current ETag, creates no commitments, preserves the upload-time raw-processing-completed timestamp and is terminal. A preview is unavailable after its deadline; the scheduler after startup or the first subsequent read/confirm/discard transitions an overdue row to `EXPIRED`, verifies no raw payload exists, and races deterministically with confirm/discard.                                                                                                                                                                                                                                     |
| M6-09 | Privacy/audit                | Privacy export includes safe import job/item provenance but no raw bytes, file name, digest, invalid cells, idempotency/rate internals, lock internals, or foreign data. Eligible local deletion removes imports. A common subject-user fence makes deletion race deterministically with upload/confirm/discard/expiry; no subject import/audit/control residue survives. Each successful import mutation has one allowlisted same-transaction redacted audit event.                                                                                                                                                      |
| M6-10 | BFF                          | Exact import routes/methods/query/header/body rules pass. Multipart type/boundary/size and timeouts are bounded; JSON-only routes stay JSON-only. Origin, traversal, duplicate JSON-property names, ETag/idempotency and bearer-token boundaries remain intact.                                                                                                                                                                                                                                                                                                                                                           |
| M6-11 | UI                           | Template download, upload, preview counts/errors, duplicate-default-off selection, explicit confirm, discard, success, stale/conflict/retry, expired and API-error states pass in component tests and real OIDC Chromium. Copy states private creation, no bank/provider action, raw non-persistence, and preview expiry.                                                                                                                                                                                                                                                                                                 |
| M6-12 | Accessibility/responsive     | Axe smoke, keyboard-only flow, label/error associations, focus/live-region transitions, minimum target size, zoom/narrow mobile containment, no page overflow, reduced-motion behavior, and sign-out/protected-route handling pass.                                                                                                                                                                                                                                                                                                                                                                                       |
| M6-13 | Security headers/scans       | CSP and bounded cross-origin resource/opener headers are present and compatible with sign-in/import; COEP is not enabled blindly across the OIDC boundary. Gitleaks, dependency checks with permission, static checks, production/container builds and generated-client drift pass. No unresolved high/critical finding remains without a written human decision.                                                                                                                                                                                                                                                         |
| M6-14 | Load/resilience              | Bounded local load returns only correct responses and reports P50/P95/max. On the recorded accepted local environment, normal read/write P95 is below the 400 ms beta hypothesis; shared CI records the measurement without treating machine speed as a universal invariant. Restart/rollback/concurrency and scheduler/outbox regressions pass without duplicate user-visible effects.                                                                                                                                                                                                                                   |
| M6-15 | Backup/restore               | A canonical read-only dump restores into a validated unique disposable database. V1-V6 checksums and allowlisted table counts match. Cleanup removes the dump and disposable database even after a forced validation failure; the canonical database is never dropped or overwritten.                                                                                                                                                                                                                                                                                                                                     |
| M6-16 | Regression/cleanup           | Complete M1-M5 backend, PostgreSQL, web, contract and browser gates pass. Seed ends with eight fake identities, five narrow staff roles, four canonical commitments, no invitation/member/import/raw/job residue, and five healthy services.                                                                                                                                                                                                                                                                                                                                                                              |

## Real-OIDC browser journey

Run on desktop and mobile Chromium with fresh, phase-scoped sessions:

1. Sign in as the fake owner and open the import screen from More or
   Commitments.
2. Download the exact template and verify its fixed name/header.
3. Upload a controlled fixture containing valid, invalid, catalog-matched,
   in-file duplicate and existing-duplicate rows.
4. Verify no commitment was created during preview, errors do not echo unsafe
   input, duplicates start unselected, and raw non-persistence/preview-expiry/
   no-provider copy is visible.
5. Select the intended valid rows using only the keyboard and confirm.
6. Verify the success summary, private/CSV provenance on created commitments,
   dashboard/occurrence reconciliation, and absence of unselected rows.
7. In a second owner tab, submit a stale confirmation/discard and verify the
   conflict preserves the committed result.
8. Upload another valid fixture, discard it, and verify no commitment, terminal
   preview state, and the always-null raw-payload invariant.
9. Verify member, foreign and each staff role cannot read/operate the owner's
   import.
10. Run Axe quality smoke, mobile containment, console, sign-out and protected
    route checks.
11. Clean all reserved M6 rows/commitments and reassert canonical M1-M5 state.

## Required copy

- "Preview only. Nothing is created until you confirm selected rows."
- "Imported commitments are private by default."
- "AutoPay Guard does not contact a bank or provider."
- "Raw CSV content is processed in bounded request memory and is not committed
  to storage."
- "Unconfirmed previews expire no later than 24 hours after upload."
- Duplicate warnings are advisory and require an explicit user selection.
- Invalid rows say what field/rule failed without echoing unsafe content.

## Recorded result

The bounded local M6 implementation and the evidence below completed on
2026-08-03 against a private local delivery workspace.

- The final filtered source comparison covered 669 source files and reported
  no copied, mismatched, failed, or extra files after synchronization.
- `.\make.ps1 test` passed. The backend reports contained 54 Surefire XML
  suites / 262 tests and two real-PostgreSQL Failsafe XML suites / 29 tests,
  with zero failures, errors, or skips. The web raw request gate passed four
  tests, and Vitest passed 58 files / 455 tests.
- `.\make.ps1 lint`, `corepack pnpm contracts:check`, and
  `corepack pnpm build` passed, including formatting, lint, strict TypeScript,
  generated-client drift/self-checks, and the production Next.js build.
- The standard Playwright matrix passed 24 tests and intentionally skipped six
  guarded cases that run through their dedicated live acceptance commands.
- The final guarded `.\make.ps1 m6-live` API/database journey passed. It
  covered preview-only upload with no committed raw payload, deterministic row
  errors and duplicate warnings, stable replay, atomic private `CSV`
  confirmation, stale-version preservation, formula rejection, restart-safe
  normalized preview state, exactly-once discard, and deterministic cleanup.
- The guarded real-OIDC `.\make.ps1 m6-ui-live` journey passed 2/2 across
  desktop and mobile Chromium, including the controlled import lifecycle and
  its responsive, accessibility, authorization, stale-state, sign-out, and
  cleanup assertions.
- The bounded `.\make.ps1 m6-load` run measured 120 reads at P50 63.8 ms,
  P95 339.8 ms, and maximum 396.0 ms. Its six measured upload/discard writes
  were P50 29.5 ms, P95 45.2 ms, and maximum 45.2 ms. Both P95 values remained
  below the recorded local 400 ms beta hypothesis.
- `.\make.ps1 m6-restore` passed both its normal restore and intentional
  forced-validation-failure canary. It matched all 52 allowlisted table counts,
  preserved the migration history, removed its disposable database and dump,
  and recorded dump SHA-256
  `6394f4200d7c5c8d3ca512a17dcd8b0066c975a8e9118730758bf5eafb81be7e`.
- The refreshed 2026-08-03 Trivy repository scan found zero high/critical
  vulnerabilities, zero misconfigurations, and zero secrets. Exact final API
  and web image scans also found zero high/critical vulnerabilities. CycloneDX
  SBOM generation recorded 190 API components and 40 web components, and the
  final Gitleaks scan found no leaks.
- The scanned images were API
  `ca2ef11ae0f3e5a69f284c09467d6540c86f1d03ef2b9dd12a7c824cfaf3d943`
  and web
  `988460eac8e103d498402ecdee0a465911528f9118a0ed4f27d7aa6307fc40a3`.
  Runtime vulnerabilities discovered during acceptance were remediated by
  upgrading Alpine packages and removing npm/Corepack from the final web
  runtime image before the passing scans.
- The restore exercise exposed a verifier-side `psql` variable-interpolation
  defect. The verifier was corrected and both the normal and forced-cleanup
  paths then passed; this was a test-harness defect, not a canonical-database
  restore failure.
- The final seed exposed the same pre-hydration sign-in race previously found
  in the dedicated browser runner. Every duplicated local seed/live sign-in
  helper now waits for the loaded sign-in page and its bounded server-action
  response. The delivery seed then passed with eight fake identities, four
  canonical commitments, and zero Milestone 6 import residue.
- After the user authorized production dependency-inventory egress on
  2026-08-04, `corepack pnpm audit --prod --audit-level=high` completed with
  `No known vulnerabilities found`.
- The complete delivery `.\make.ps1 check` then passed with exit code 0 in
  747.2 seconds. It reran format/lint/type checks, Maven verification, 58 web
  test files / 455 tests, generated-client checks, the production build,
  dependency and secret scans, and the standard Playwright matrix (24 passed,
  six intentionally guarded skips).
- GitHub CodeQL is not recorded as passing. This workspace has no commit or
  remote, no local CodeQL installation, and no authorization to commit or
  push, so the external workflow could not be run. On 2026-08-04 the user
  accepted this documented deferral for the local Milestone 6 gate. The
  passing local static, contract, build, dependency, secret, Trivy, image, and
  browser evidence does not replace a CodeQL result.

## Human decision

The user explicitly approved Milestone 6 on 2026-08-04 after reviewing the
evidence above. The dependency advisory audit is complete, and the unavailable
external CodeQL run has a documented user-accepted deferral rather than a pass.
Milestone 6 is closed.

Stop there. Private beta, post-MVP ingestion, real users/data/email, cloud,
production, legal decisions, and payment/provider capability remain blocked
until separately authorized.
