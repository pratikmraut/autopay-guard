# ADR-016: bounded owner-controlled CSV import

Status: accepted for the authorized Milestone 6 implementation boundary on
2026-07-29 and implemented. Bounded local automated acceptance passed on
2026-08-03. The dependency-registry audit and complete delivery quality gate
passed on 2026-08-04. The externally unavailable CodeQL run has a documented
user-accepted deferral and is not claimed as a pass. The user explicitly
approved and closed Milestone 6 on 2026-08-04.

## Context

AutoPay Guard needs a faster way for an owner to enter recurring commitments
without adding bank, provider, email, SMS, spreadsheet, document, or account
aggregation access. A file boundary increases attack surface: parsers can
amplify input, formula-like cells can become dangerous in downstream tools,
raw rows can contain secrets, and a preview can accidentally become an
implicit write.

The product also needs deterministic replay, duplicate guidance, concurrency
control, retention, privacy export/deletion, and operational recovery without
weakening the owner-only model established in earlier milestones.

## Decision

Milestone 6 accepts only one exact eight-column CSV contract:

```text
name,category,amount,currency,frequency,next_due_date,payment_rail,masked_payment_label
```

The server is the sole parser and authority. It rejects any file outside the
exact extension, media type, UTF-8, header, row-count, column-count, field,
size, and safe-content bounds. It parses rupees with exact decimal arithmetic
and stores paise. Invalid rows retain only row numbers and allowlisted error
codes; rejected values, file names, multipart details, and digests are never
returned or logged.

Upload creates only a `PREVIEW_READY` job with normalized rows. It cannot create
a commitment. Duplicate detection uses one deterministic normalized schedule
fingerprint and is advisory. Duplicate rows begin unselected, and the owner
must explicitly select every row to confirm.

Raw input exists only in bounded request memory. The upload transaction writes
only normalized safe rows, byte-count metadata, and a keyed internal
integrity/replay fingerprint; the schema constrains `raw_payload` to SQL `NULL`
in every state. Request references are released when request processing
returns. This is a storage non-retention guarantee, not a claim that the JVM
zeroizes every internal buffer before garbage collection.

Confirmation revalidates and locks the job, then creates private, active,
fixed-amount `CSV` commitments, occurrences, audit evidence, idempotency
evidence, and terminal job state in one transaction. Discard and expiry create
no commitments. Unconfirmed preview availability ends no later than 24 hours
after upload.

Import operations are owner-only, non-enumerating across households, protected
by ETags, bounded idempotency, and database-serialized one-way actor rate
limits. Rate evidence commits in a separate user-fenced transaction before the
domain transaction, avoiding nested-connection starvation. Every import
mutation locks the subject user before its job, matching deletion lock order.
An already committed replay is free. Across application instances, truly
simultaneous attempts can each consume one bounded rate event before they
converge on the single durable idempotent domain result.
The BFF allowlists only the four import routes and independently caps multipart
requests.

Local verification uses guarded fake identities and reserved fixture names.
Load is bounded and treats 400 ms P95 as a recorded local beta hypothesis, not
a production service-level objective. Restore validation targets a generated
disposable database and never the canonical database.

## Implementation checkpoint

The implemented design preserved the central decision: raw CSV existed only
in bounded request memory and was never persisted. Normalized safe preview
rows remained owner-scoped; preview authority ended on confirmation, explicit
discard, or expiry within 24 hours, while safe terminal provenance may remain
until eligible deletion.

On 2026-08-03, refreshed Trivy repository and exact-image scans reported zero
high/critical findings, CycloneDX recorded 190 API and 40 web components, and
Gitleaks was clean. The first fresh image pass found fixable Alpine CVEs and
CVEs in unused npm tooling. The final Dockerfiles apply Alpine upgrades in both
runtimes with `apk upgrade` and remove unused npm/corepack from the web
runtime. The clean exact images are
`sha256:ca2ef11ae0f3e5a69f284c09467d6540c86f1d03ef2b9dd12a7c824cfaf3d943`
and
`sha256:988460eac8e103d498402ecdee0a465911528f9118a0ed4f27d7aa6307fc40a3`.

After explicit user authorization for dependency-inventory egress, the npm
advisory-registry audit reported no known vulnerabilities and the complete
delivery quality gate passed. External CodeQL still cannot run without a
commit/remote or a local installation, and commit/push has not been authorized.
The user accepted that documented deferral; no CodeQL pass is claimed. Explicit
human approval of Milestone 6 was recorded on 2026-08-04.

## Consequences

- Owners gain a controlled bulk-entry path without financial connectivity.
- Preview and confirmation are visibly separate, making creation deliberate.
- Raw input is not committed to product storage; normalized provenance can
  remain for privacy and audit purposes.
- Exact duplicates may produce false negatives when text differs; fuzzy or
  model-based matching is intentionally excluded.
- CSV variants outside the fixed contract must be corrected before upload.
- Import rate-lock rows and normalized provenance add schema and cleanup work.
- New ingestion formats require a later authorized ADR and threat review.

## Rejected alternatives

- Browser-side parsing: it would create two authorities and expose raw values
  to more client state.
- Immediate creation during upload: it removes meaningful preview and consent.
- XLSX, PDF, URL, inbox, SMS, bank, or provider ingestion: each adds a distinct
  parser, credential, privacy, or network trust boundary.
- Fuzzy or LLM duplicate detection: its outcomes are not sufficiently
  deterministic for this local financial control surface.
- Retaining raw CSV for support: the support value does not justify the
  sensitive-data and deletion burden.
