# Milestone 6 requirements - controlled CSV import and hardening

Status: explicitly authorized on 2026-07-29 after human approval of Milestone 5.
The bounded implementation is complete and its local automated acceptance
exercises passed on 2026-08-03. The dependency-registry audit and complete
delivery quality gate passed on 2026-08-04. The user accepted the documented
external CodeQL deferral; no CodeQL pass is claimed. The user explicitly
approved and closed Milestone 6 on 2026-08-04.

The field/lifecycle reconciliation is
`docs/compliance/MILESTONE_6_IMPORT_INVENTORY.md`; the verification contract is
`docs/testing/MILESTONE_6_ACCEPTANCE.md`.

## Outcome

An owner can download one controlled CSV template, upload a fake-local CSV,
review normalized rows and deterministic duplicate warnings, select valid rows,
and explicitly confirm creation of private recurring commitments. No
commitment is created during upload or preview. Raw CSV bytes exist only in
bounded request memory while the API parses the upload and are never committed
to PostgreSQL, browser storage, application-controlled temporary files, logs,
audit, or product responses. The preview itself remains available for no more
than 24 hours.

Milestone 6 also closes the bounded local hardening scope: malicious-upload
coverage, import rate limits and BFF boundaries, accessibility remediation,
threat-model and ADR updates, a reproducible beta-load hypothesis check, and a
non-destructive local PostgreSQL backup/restore drill.

## Implementation checkpoint

- The controlled owner-only import lifecycle, malicious corpus, regression,
  load, restore, cleanup, and local browser/API acceptance exercises passed
  with fake-local data. Raw CSV remained request-memory-only and was never
  persisted. Only normalized safe preview data was stored; preview authority
  ended on confirmation, explicit discard, or expiry within 24 hours, while
  safe terminal provenance may remain until eligible deletion.
- A refreshed Trivy 0.70.0 run on 2026-08-03 reported zero high/critical
  repository vulnerabilities, misconfigurations, or secrets and zero
  high/critical findings in the exact API and web runtime images. CycloneDX
  SBOMs contained 190 API components and 40 web components, and the final
  Gitleaks scan was clean.
- The first fresh image scan exposed remediable Alpine CVEs and CVEs in bundled
  npm tooling. Both runtime images now apply the available Alpine package
  fixes with `apk upgrade`, and the web runtime no longer contains its unused
  npm/corepack tooling. The clean final image IDs are
  `sha256:ca2ef11ae0f3e5a69f284c09467d6540c86f1d03ef2b9dd12a7c824cfaf3d943`
  and
  `sha256:988460eac8e103d498402ecdee0a465911528f9118a0ed4f27d7aa6307fc40a3`.
- After the user authorized production package-inventory egress,
  `pnpm audit --prod --audit-level=high` reported no known vulnerabilities and
  the complete delivery `make check` passed with exit code 0 in 747.2 seconds.
  No CodeQL pass is claimed because there is no commit, remote, or local CodeQL
  installation and commit/push authorization remains absent; the user accepted
  that documented deferral on 2026-08-04.

## Boundary

- CSV is the only import source. There is no XLS/XLSX, archive, PDF, URL,
  receipt-forwarding, Gmail, SMS, Account Aggregator, bank, card, UPI, provider,
  or cloud ingestion.
- Only an active household `OWNER` with the normal `USER` role may create,
  read, confirm, or discard an import for that household.
- Members and foreign users receive non-enumerating not-found responses.
  Staff-only roles receive authorization denial and gain no import power.
- Imported commitments remain app-local, owner-authored, `PRIVATE`, active,
  fixed-amount commitments with source `CSV`. Sharing is never inferred.
- The file cannot supply a merchant ID, URL, guide target, visibility,
  responsible member, status, source, confidence, version, or any
  server-owned field.
- The parser rejects formula-like content, full account/card/UPI identifiers,
  PINs, OTPs, and high-confidence credential/token patterns. Users are
  instructed not to upload secrets; the bounded parser is not a general
  data-loss-prevention system.
- This remains fake-local software. Nothing contacts a provider, initiates a
  payment, revokes a mandate, sends an import email, or claims legal
  compliance.

## Controlled file contract

The downloadable template contains exactly this ordered header:

```text
name,category,amount,currency,frequency,next_due_date,payment_rail,masked_payment_label
```

Upload policy:

- file name ends in exactly `.csv`, case-insensitively;
- media type is exactly `text/csv`;
- raw size is between 1 byte and 256 KiB;
- encoding is strict UTF-8, with at most one optional UTF-8 BOM;
- the exact header appears once and is followed by 1 through 100 data rows;
- every row has exactly eight fields;
- quoted fields and doubled quotes are parsed deterministically, while
  embedded CR/LF, NUL, malformed quoting, duplicate headers, trailing
  non-record data, and binary/control content fail safely;
- every field is bounded before normalization;
- any cell whose trimmed value begins with `=`, `+`, `-`, or `@` is rejected
  as formula-like content; and
- file name, media type, raw payload, digest, multipart boundary, and
  parser-internal detail never appear in product logs, audit, errors, URLs, or
  retained preview rows.

A file-level failure creates no job, item, idempotency completion, audit event,
or commitment. A structurally valid file may create a preview containing
row-level errors.

## Row normalization

- `name` is NFKC-normalized, trimmed, whitespace-collapsed, limited to 160
  characters, and passed through the existing sensitive-content policy.
- `category` is one existing commitment category.
- `amount` is a positive plain decimal rupee value with at most two fractional
  digits. It is parsed with `BigDecimal`, converted exactly to paise, and must
  fit the existing maximum commitment amount. Exponents, signs, grouping
  separators, NaN/infinity, and rounding are rejected.
- `currency` is a supported uppercase ISO 4217 code.
- `frequency` is `WEEKLY`, `MONTHLY`, `QUARTERLY`, `HALF_YEARLY`, or `YEARLY`.
  CSV does not create custom intervals.
- `next_due_date` is a strict ISO local date inside the existing supported
  commitment range. It becomes the recurrence anchor. A month-based date on
  the final day of its month uses `LAST_DAY`; every other row uses
  `ANCHOR_DAY`.
- `payment_rail` is one existing payment rail.
- `masked_payment_label` is optional and uses the existing masked-label and
  sensitive-content validation.
- A category-compatible merchant is attached only for one exact normalized
  canonical-name or alias match. Ambiguous or absent matches remain
  merchant-less. No target or website value is copied from CSV.

Invalid rows retain only row number and allowlisted error codes/messages. Raw
invalid cell values are not stored or echoed.

## Deterministic duplicate detection

Duplicate detection is advisory and deterministic:

- the first valid occurrence of a new normalized schedule key is `NONE`
  unless it matches an active owned commitment; a later same-file occurrence
  is `IN_FILE`;
- an exact normalized schedule key matching an active owned commitment is
  `EXISTING` and takes precedence for that row;
- otherwise the row is `NONE`.

The key uses normalized name, category, exact amount/currency, frequency, date,
and payment rail. There is no fuzzy model or LLM. Invalid rows cannot be
selected. Valid duplicate rows are unselected by default in the UI but may be
explicitly selected by the owner.

## Persistence and retention

Additive V6 tables store an import job and normalized preview items. V1 through
V5 rows and checksums are unchanged.

An import job records only bounded metadata, the original byte count, an
internal domain-separated HMAC-SHA-256 integrity/replay fingerprint, preview
expiry, the timestamp at which bounded raw processing completed, counts,
status, optimistic version, and timestamps. The raw payload column is
constrained to SQL `NULL` in every state. The fingerprint and its independently
generated local key are never returned, exported, logged, or audited.

Job states are:

- `PREVIEW_READY`: no commitment has been created;
- `CONFIRMED`: selected valid rows were atomically created;
- `DISCARDED`: the owner explicitly discarded the preview; and
- `EXPIRED`: an unconfirmed preview passed its availability deadline.

Raw bytes are processed in bounded request memory and never written by the
upload transaction:

- a `PREVIEW_READY` row already has `raw_payload = NULL` and a non-null
  `raw_processed_at`, which records completion of bounded request processing
  and does not claim physical JVM-memory erasure;
- confirmation and discard preserve that original processing-completed
  timestamp; and
- a preview is unavailable after its deadline; scheduler/startup processing or
  the first later read, confirmation, or discard transitions an overdue
  persisted row to `EXPIRED` while verifying that no raw payload exists.

Safe normalized job/item metadata may remain for local provenance and privacy
export. Invalid raw cells, original file name, multipart metadata, and raw
payload never enter committed product storage. Deleting an eligible subject
removes their import jobs/items through the existing local-erasure workflow.

## API contract

```text
POST   /v1/imports
GET    /v1/imports/{importId}
POST   /v1/imports/{importId}/confirm
DELETE /v1/imports/{importId}
```

- Upload consumes bounded `multipart/form-data` with exactly `householdId` and
  one `file`, requires `Idempotency-Key`, and returns `201`, a safe `Location`,
  and ETag.
- Get returns the owner-only preview and ETag with `Cache-Control: no-store`.
- Confirm consumes JSON containing 1 through 100 distinct selected item IDs,
  requires current `If-Match` and `Idempotency-Key`, and returns a bounded
  confirmation summary and new ETag.
- Discard requires current `If-Match`, has no request body, and returns `204`.
- Upload and confirmation idempotency is scoped to actor and operation and
  bound to canonical fingerprints. Same-key/same-request replay is stable;
  same-key/different-request conflicts.
- A replay of an already committed result does not consume rate budget. On
  multiple application instances, truly simultaneous attempts may each consume
  one bounded rate event before the single domain winner is known; they still
  converge on one durable idempotent result.
- Stale ETags return `412`, missing ETags return `428`, and foreign resources
  do not enumerate.
- Upload and confirmation are separately rate limited using one-way actor
  keys. Failed or rolled-back domain work does not leave commitments.
- Upload, confirmation, discard, lazy/scheduled expiry, and eligible local
  deletion share a subject-scoped mutation fence. The durable rate transaction
  and domain transaction acquire that fence separately, so rate evidence
  remains durable without holding an outer database connection or racing
  deletion.
- Confirmation locks the job, validates every selected item again, creates all
  selected commitments and occurrences, records decisions and audit, updates
  counts/status, and verifies the already-null raw payload in one transaction.
- Every successful create, confirm, discard, and automatic preview-expiry
  transition appends one allowlisted same-transaction audit event with resource
  type `IMPORT_JOB`.

## Web and BFF

- `/imports` provides the static controlled template, one file input, upload,
  preview, duplicate warnings, row selection, confirmation, discard, and
  completion state.
- The browser never parses money or decides validity. API preview data is
  authoritative.
- File objects and CSV text are not placed in local/session storage, URLs,
  cookies, telemetry, or persistent client state after upload.
- The BFF allowlists only the four import operations, caps multipart bytes,
  validates multipart media type/boundary, preserves same-origin and
  idempotency/ETag policy, and never exposes bearer tokens.
- The template is a fixed same-origin static file with a fixed download name.
- Confirmation copy states that selected rows become private commitments and
  that no bank/provider action occurs.
- Raw-input copy states that bytes are not committed to storage and that an
  unconfirmed preview expires within 24 hours.
- Status/error feedback uses focused live regions; keyboard users can operate
  file selection, row selection, confirm, discard, retry, and navigation.
- Desktop and narrow mobile layouts have no horizontal page overflow and all
  interactive targets meet the existing minimum-size rule.

## Hardening and operational exercises

- Add malicious CSV/file corpus tests for MIME/extension mismatch, oversize,
  empty/header-only, BOM, invalid UTF-8, NUL/binary, malformed quotes, embedded
  newline, excess rows/columns/field length, formula prefixes, amounts,
  currencies, dates, enums, secrets, and duplicate manipulation.
- Extend BFF traversal, body-size, content-type, header, body, and upstream
  response tests to the multipart route.
- Add a bounded Content Security Policy and compatible cross-origin
  resource/opener headers. Do not enable COEP blindly across the OIDC boundary.
  Production HSTS remains a deployment
  requirement because local development is HTTP.
- Fix any M1-M5 regression found during M6 hardening and add a focused test.
- Exercise transactional rollback, concurrent upload/confirmation, stale
  confirmation, cleanup races, privacy export/deletion, scheduler idempotency,
  and API restart-safe persistence.
- A local beta-load hypothesis runner warms the API, uses bounded concurrency,
  reports latency percentiles, asserts zero incorrect responses, and checks
  normal read/write P95 below 400 ms on the accepted local environment.
- A local backup/restore drill creates a temporary dump, restores only into a
  uniquely named disposable database, validates migration checksums and
  allowlisted table counts, then removes both dump and database in a trap. It
  never overwrites or drops the canonical database.
- Update the STRIDE threat model, architecture/data inventory, retention notes,
  local restore runbook, and an ADR for the bounded import design.
- Secret, dependency, generated-contract, migration, production build, and
  container-build gates remain mandatory. Any unresolved high/critical finding
  requires a written human risk decision; otherwise the gate fails.

## Stop condition

The executable evidence matrix is
`docs/testing/MILESTONE_6_ACCEPTANCE.md`.

The bounded implementation and local automated acceptance evidence have
reached this stop condition. The dependency-registry audit is complete.
External CodeQL remains explicitly deferred by user decision and is not
represented as a pass. The user explicitly approved Milestone 6 on 2026-08-04,
so the milestone is closed. Private-beta operations, real users/data/email,
cloud resources, production deployment, and every post-MVP ingestion source
remain blocked without a new approved milestone.
