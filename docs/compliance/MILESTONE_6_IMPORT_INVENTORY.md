# Milestone 6 controlled-import inventory

Status: implementation was authorized on 2026-07-29 and is complete. Bounded
local automated acceptance passed on 2026-08-03, including the lifecycle and
non-retention assertions in this inventory. The dependency-registry audit and
complete delivery quality gate passed on 2026-08-04; the user accepted the
documented external CodeQL deferral, which is not claimed as a pass. The user
explicitly approved and closed Milestone 6 on 2026-08-04. This is a bounded
fake-local product inventory, not a legal or regulatory-compliance claim.

## Purpose and boundary

Milestone 6 lets an authenticated household owner upload one controlled CSV,
inspect a server-produced preview, select valid rows, and explicitly create
private recurring commitments. The feature does not connect to a bank,
Account Aggregator, payment rail, email inbox, SMS service, merchant, provider,
remote URL, cloud drive, object store, or payment mandate.

The accepted CSV header is exactly:

```text
name,category,amount,currency,frequency,next_due_date,payment_rail,masked_payment_label
```

No user, household-owner, status, visibility, responsibility, source,
confidence, merchant ID, URL, guide target, payment credential, or provider
action may be supplied by the file.

## Acceptance checkpoint

The guarded API, database, privacy, deletion, browser, load, and restore
exercises confirmed that raw CSV bytes are never persisted. They exist only in
bounded request memory while parsing. A retained preview contains normalized
safe fields for valid rows or only a row number and allowlisted issues for an
invalid row. Confirmation consumes selected normalized rows, discard makes the
preview terminal without creating commitments, and an unconfirmed preview is
unavailable after its deadline within 24 hours.

The 2026-08-03 local hardening evidence used refreshed Trivy databases. The
repository and exact final API/web images reported zero high/critical findings,
the two CycloneDX inventories contained 190 and 40 components, and Gitleaks was
clean. An initial fresh image scan found fixed Alpine CVEs and CVEs in unused
bundled npm tooling; both runtime images now run `apk upgrade`, and the web
runtime removes npm/corepack. This security evidence contains dependency and
image metadata only and does not contain uploaded CSV content or normalized
preview records.

After explicit user authorization for package-inventory egress, the npm
advisory-registry audit reported no known vulnerabilities and the complete
delivery quality gate passed. CodeQL remains unavailable because this workspace
has no commit, remote, local CodeQL installation, or commit/push authorization.
The user accepted that documented deferral; no CodeQL pass is claimed, and
the user explicitly approved Milestone 6 on 2026-08-04.

## Data lifecycle

| Phase                      | Stored data                                                                                                                                                                                               | Retention and authority                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload validation          | Bounded multipart bytes in request processing only                                                                                                                                                        | A file-level rejected upload creates no import job/item, idempotency completion, audit event, commitment, or content-bearing persistence; one-way actor rate metadata may remain. A structurally accepted file may create invalid-row items containing only row number and allowlisted issue codes. Rejected content must not enter logs or error responses and must not remain in application-controlled temporary storage after request completion. |
| Preview                    | Internal keyed fingerprint/byte-count metadata, owner/household IDs, expiry and state metadata; valid rows retain normalized safe fields; invalid rows retain only row number and allowlisted issue codes | Owner-only, no-store response. Raw bytes exist only in bounded request memory and are never committed; the database constrains `raw_payload` to SQL `NULL` in every state. Request references are released when request processing returns. The preview is unavailable after its deadline, which is less than 24 hours after upload.                                                                                                                  |
| Confirmation               | Selected valid rows become active, private, fixed, `CSV` commitments and deterministic occurrences; safe import job/item provenance records the selection result                                          | The transaction verifies the raw payload remains SQL `NULL`, preserves the upload-time processing-completed timestamp, and marks unselected valid rows skipped. Invalid values were never retained.                                                                                                                                                                                                                                                   |
| Discard                    | Terminal job metadata and safe item provenance only                                                                                                                                                       | The transaction verifies the raw payload remains SQL `NULL`, preserves the upload-time processing-completed timestamp, and creates no commitment.                                                                                                                                                                                                                                                                                                     |
| Expiry                     | Terminal job metadata and safe item provenance only                                                                                                                                                       | The deadline ends preview availability. Scheduler/startup processing or the first later read/confirm/discard observation transitions an overdue row while verifying the raw payload remains SQL `NULL`; the job cannot later confirm or discard.                                                                                                                                                                                                      |
| Eligible app-data deletion | No subject-owned import job, item, or raw payload remains                                                                                                                                                 | The local deletion transaction removes subject-owned import data. Backup propagation remains a production-policy decision and is not claimed by this local exercise.                                                                                                                                                                                                                                                                                  |

## Normalized preview fields

For a valid row, the preview may return only:

- opaque import-item ID and one-based source row number;
- normalized display name and allowlisted category;
- exact integer minor amount derived from a positive decimal with at most two
  fractional digits;
- uppercase supported ISO currency;
- allowlisted frequency, ISO next-due/anchor date, and server-derived
  month-day policy;
- allowlisted payment rail and optional bounded masked label;
- an optional exact, unique, category-compatible fictional merchant reference;
- deterministic `NONE`, subsequent-row `IN_FILE`, or active-existing
  `EXISTING` duplicate classification;
- valid/imported/skipped state and, after confirmation, the opaque created
  commitment ID.

For an invalid row, all supplied cell values are discarded. The preview may
return only the row number and allowlisted issue codes. Issue messages describe
the failed rule without echoing the cell.

## Deliberately excluded data

The following never enters a product response, audit payload, structured log,
privacy export, diagnostic response, analytics event, or support response:

- raw CSV bytes, original filename, multipart boundary, media-type parameters,
  file digest, parser exception, or invalid cell value;
- idempotency keys/hashes, duplicate fingerprint internals, rate-limit actor
  keys, database lock state, or request bodies;
- detected full account/card numbers, UPI IDs, PINs, OTPs, high-confidence
  credential/token patterns, or arbitrary URLs. Users are instructed not to
  upload secrets; this bounded guard is not general DLP.

## Privacy export reconciliation

New exports use `autopay-guard-export-v2`; previously generated, still-retained
`autopay-guard-export-v1` artifacts remain immutable until their existing
expiry. Version 2 adds subject-owned safe import job/item provenance in stable
order while excluding raw bytes, digests, filenames, invalid cells,
idempotency/rate internals, and foreign household imports.

The export records enough safe metadata to explain that the subject uploaded,
confirmed, discarded, or allowed an import to expire and which normalized
valid rows were imported or skipped. It does not reproduce the source file and
does not claim to be a bank, merchant, or provider record.

## Operational limits

- exact `.csv` filename suffix and `text/csv` file-part media type;
- strict UTF-8 with at most one leading BOM;
- 1 byte through 256 KiB and 1 through 100 data rows;
- exact ordered header and eight fields per row;
- no NUL, binary/control content, embedded CR/LF, malformed quoting, or
  formula-leading cell;
- owner-only upload/read/confirm/discard, current ETag on terminal mutation,
  bounded idempotency keys, and rate enforcement;
- no partial confirmation: commitment, occurrences, item/job state, the
  already-null raw-payload invariant, audit, and replay snapshot commit together
  or roll back together;
- one subject-scoped database fence serializes import mutation/expiry with
  eligible local deletion, while the durable rate transaction runs separately
  from the domain transaction to avoid connection-pool starvation.

Production retention, encryption/key management, backup erasure, malware
operations, independent privacy/legal review, and real-user ingestion remain
outside this milestone and require separate approval.
