# Threat model

Status: the Milestone 6 STRIDE update and bounded local automated acceptance
are complete for the authorized controlled CSV import, raw-data lifecycle,
accessibility/security hardening, load exercise, and non-destructive restore
drill, including the unchanged M1-M5 controls. The dependency-registry audit
and complete delivery quality gate passed on 2026-08-04. The user accepted the
documented external CodeQL deferral; no CodeQL pass is claimed. The user
explicitly approved and closed Milestone 6 on 2026-08-04. This is an
engineering artifact, not a certification.

## Assets and trust boundaries

Protected assets are OIDC sessions/tokens, immutable identity mapping, exact
staff-role authority, household ownership and membership, recurring financial
metadata and private-visibility isolation, adult/privacy consent history, local
development secrets, one-time invitation/support-code secrecy, canonical
subject-export integrity/confidentiality, deletion-tombstone minimality,
notification consent and read state, delivery integrity, append-only redacted
audit, renewal-decision history, immutable fictional guide versions and
lifecycle heads, safe-target allowlists, cancellation-attempt integrity, user
attestation provenance, savings-event integrity, idempotency bindings, optional
note/feedback confidentiality, and the integrity of source/dependencies.
Milestone 6 additionally protects import ownership, preview integrity,
confirmation atomicity, normalized provenance, raw CSV confidentiality and
bounded deletion, parser availability, and backup/restore isolation.

Trust boundaries:

1. Untrusted browser to the Next.js BFF.
2. BFF to Keycloak.
3. BFF to the Spring API.
4. API to PostgreSQL.
5. Outbox worker to the development-only Mailpit SMTP boundary.
6. Developer browser to the local Mailpit inspection UI.
7. Developer host to local Compose containers.
8. Source checkout to dependency registries and CI.
9. An explicit browser user gesture to a reserved fictional `.example` or
   `autopayguard-demo` target. The API and BFF do not cross this boundary:
   neither resolves, fetches, follows, nor redirects to a guide target.
10. Manual transfer of a one-time invitation code from an owner to the intended
    fake-local member. No email, URL, notification, or outbox crosses it.
11. Manual transfer of a one-time support code from an owner to a separately
    authenticated `SUPPORT_READ` operator. Role or code alone is insufficient.
12. Exact fake-local staff sessions to guide administration, privacy execution,
    redacted audit, or support; each role is isolated from every other role.
13. Untrusted multipart and CSV bytes crossing browser, BFF, and bounded API
    request parsing. Raw content is not committed to PostgreSQL or product
    storage. The feature does not cross into an application-controlled
    filesystem, object store, remote URL, email/SMS inbox, bank, merchant, or
    provider.

No real financial data is an allowed test asset.

## STRIDE analysis and controls

| Threat                                      | Foundation controls                                                                                                                                                                                                                                                                                                       | Verification                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Spoofing an identity                        | OIDC authorization code + PKCE, issuer/audience JWT validation, immutable `sub` mapping, state/nonce handled by the OIDC library                                                                                                                                                                                          | sign-in smoke test; invalid/missing JWT tests                            |
| Session theft or fixation                   | encrypted HttpOnly cookie, Secure outside local HTTP, SameSite, rotated provider tokens, no browser token storage, no token logging                                                                                                                                                                                       | cookie/config review; browser storage inspection                         |
| Cross-site request forgery                  | SameSite cookie plus framework/provider CSRF protection for BFF mutations; API is bearer-token based and not directly cookie authenticated                                                                                                                                                                                | negative request tests and manual review                                 |
| Household IDOR                              | authenticated local user ID included in every household query/write; request-supplied owner IDs ignored                                                                                                                                                                                                                   | two-subject object-authorization tests                                   |
| Private household-data disclosure           | membership, current owner/member sharing consent, and `HOUSEHOLD` visibility are applied in repository/projection queries; private rows cannot influence member counts, totals, calendars, decisions, notifications, or diagnostics                                                                                       | private-canary API, DOM, and side-channel tests                          |
| Invitation theft, replay, or enumeration    | 256-bit plaintext is returned once for manual transfer; only SHA-256 persists; subject binding, 24-hour expiry, revocation, one-active uniqueness, and atomic acceptance prevent reuse or substitution                                                                                                                    | digest-absence, boundary-clock, and race tests                           |
| Consent inference or history rewriting      | notice acknowledgements and purpose/version-pinned grant/withdraw events are append-only; V5 infers only an exact prior notice acknowledgement and never sharing consent                                                                                                                                                  | migration, stale-version, and lock tests                                 |
| Token or secret disclosure                  | `.env` ignored, secret scan, redacted structured logs, no request bodies/headers, problem details omit submitted values                                                                                                                                                                                                   | Gitleaks and log review                                                  |
| Claim tampering                             | signatures and algorithm constraints are handled by the resource-server library; authorization never trusts email                                                                                                                                                                                                         | JWT configuration tests                                                  |
| Database tampering                          | parameterized JPA access, isolated non-superuser local DB role, Flyway checksums, ownership predicates; production must separate migration ownership from a runtime DML-only role                                                                                                                                         | repository/integration tests                                             |
| Commitment IDOR or mass assignment          | every commitment and occurrence query is scoped by authenticated local user and owned household; server controls IDs, owners, versions, timestamps, source, and generated occurrences                                                                                                                                     | two-subject API and repository tests                                     |
| Lost or replayed commitment updates         | conditional writes require the current version/ETag; stale writes fail safely without changing the row                                                                                                                                                                                                                    | optimistic-lock integration tests                                        |
| Recurrence or projection manipulation       | bounded enums and intervals, deterministic local-date arithmetic, original-anchor preservation, a fixed 90-day horizon, and database uniqueness prevent unbounded or duplicate schedules                                                                                                                                  | boundary/property tests and reconciliation tests                         |
| Notification preference or rule tampering   | owner-scoped lookups, exact DTO allowlists, bounded offsets/times/channels, and required ETags prevent cross-owner or lost updates                                                                                                                                                                                        | two-subject and stale-write integration tests                            |
| Unwanted notification activation            | migration and startup do not opt users in; missing preferences and household rules are disabled; recipient address is never accepted from a client                                                                                                                                                                        | migration/default/negative delivery tests                                |
| Duplicate or lost reminders                 | one transaction creates intent, delivery, and outbox rows; a stable semantic key, database uniqueness, short leases, and expired-lease recovery make in-app effects effectively once                                                                                                                                      | rollback, duplicate scheduler/worker tests                               |
| Notification timing manipulation            | injected clocks, bounded two-hour catch-up, deterministic timezone/DST policy, and quiet-hour suppression prevent unbounded backfill or ambiguous wall-clock behavior                                                                                                                                                     | gap/overlap/quiet-hour boundary tests                                    |
| Email exfiltration or relay abuse           | explicit fake-email mode, identity-derived recipients, strict fake-domain allowlist, generic content, and no public send/retry/Mailpit proxy endpoint                                                                                                                                                                     | recipient allowlist and API inventory tests                              |
| SMTP or diagnostic information disclosure   | email bodies omit commitment metadata; logs and diagnostics expose only sanitized categories/counts; raw SMTP responses and addresses are excluded                                                                                                                                                                        | content, log, and diagnostics assertions                                 |
| Outbox denial of service                    | bounded claim batches, `SKIP LOCKED`, short leases, capped attempts/backoff, and terminal dead state prevent a single failure from blocking the queue                                                                                                                                                                     | concurrency, retry, and lease-recovery tests                             |
| Unsafe category action                      | category-to-action policy is deterministic; loan, insurance, and investment commitments never expose a cancellation recommendation                                                                                                                                                                                        | policy unit tests and UI assertions                                      |
| Renewal-decision tampering                  | the server derives allowed actions, snapshots owned occurrence context, makes decisions append-only, and never accepts owner, amount, currency, or policy fields from the client                                                                                                                                          | policy, mass-assignment, replacement tests                               |
| Cancellation-resource IDOR                  | every decision, guide reachability check, attempt, verification, feedback, and savings query joins through the authenticated owner and exact household/commitment path                                                                                                                                                    | two-subject API and repository tests                                     |
| Guide-history rewriting                     | published fictional versions and ordered steps are immutable; attempts pin exact guide ID/version; one current published version is selected deterministically                                                                                                                                                            | database constraints and version-pinning tests                           |
| Stale or owner-reported-unsafe guide use    | review-due or owner-reported-unsafe versions remain readable without targets and cannot create an attempt; feedback cannot mutate global fixture content                                                                                                                                                                  | fixed-clock freshness and unsafe-feedback tests                          |
| Unsafe target, open redirect, or SSRF       | targets are persisted fixtures; strict canonical scheme/host/path validation rejects user-info, ports, query, fragment, traversal, delimiter encoding, and suffix confusion; no server fetch or BFF redirect exists                                                                                                       | malicious URI corpus and no-network assertions                           |
| Lost or forged attempt transition           | exact transition allowlists, server-derived completion, one unresolved attempt, full-resource ETag replacement, and immutable terminal states reject stale or illegal changes                                                                                                                                             | state-machine, stale-tab, and concurrency tests                          |
| Replayed or substituted mutation            | 16-to-100-character ASCII idempotency keys are scoped to authenticated owner and operation and bound to a canonical request fingerprint; same-payload replay is stable and mismatch conflicts safely                                                                                                                      | replay, mismatch, rollback, and race tests                               |
| False verification claim                    | after-date checks use the owned occurrence date and household calendar; required tracks gate attestation; every surface labels `VERIFIED` as user-confirmed rather than independent                                                                                                                                       | boundary-clock, contract, copy, and E2E tests                            |
| Savings manipulation or double counting     | recurrence and money snapshots are server-owned; exact checked minor-unit arithmetic, immutable events, legal supersession, state/currency buckets, and uniqueness prevent inflation                                                                                                                                      | recurrence, overflow, currency, retry tests                              |
| Unknown or estimated amount misstatement    | estimated values retain an estimate flag; unknown-variable attempts create no money event and increment an explicit unknown count; neither becomes exact or zero                                                                                                                                                          | response and summary reconciliation tests                                |
| Note or feedback injection/disclosure       | optional text is length-bounded, treated as text, rejects obvious credentials/identifiers, cannot supply a URI, is output-encoded, and is absent from logs/diagnostics                                                                                                                                                    | credential, XSS, log-injection, redaction tests                          |
| Unsafe-feedback denial of use               | suppression is limited to the reporting owner and exact guide version; feedback cannot retire, edit, republish, or globally disable a fixture                                                                                                                                                                             | cross-owner isolation and scope tests                                    |
| Guide-admin privilege or history tampering  | exact `GUIDE_ADMIN` only; drafts clone a published version and allow only bounded text/review changes; publish revalidates M4 structure/targets and writes immutable locks/events; retirement changes only the head                                                                                                       | role, mass-assignment, stale/race, lock tests                            |
| Privacy export disclosure or corruption     | subject-only download; documented complete inventory; deterministic canonical bytes and SHA-256; 5 MiB cap; under-24-hour expiry and physical purge; oversize/incomplete generation becomes `FAILED`, never partial or `READY`                                                                                            | fixture digest, inventory, denial, purge tests                           |
| Unsafe correction or deletion               | exact `PRIVACY_ADMIN`; current ETag/idempotency; fake-local subject and IANA-zone revalidation; one-transaction update/erasure; multi-member/canonical blocks; minimal tombstone blocks silent reprovisioning                                                                                                             | rollback, concurrency, role, eligibility tests                           |
| Audit disclosure or rewriting               | same-transaction append-only events expose only allowlisted metadata; lock rows detect mutation; only exact `AUDIT_READ` can page the local application audit                                                                                                                                                             | rollback, immutability, redaction, role tests                            |
| Support impersonation or standing access    | exact `SUPPORT_READ` plus current owner code; one-time plaintext display, digest-only persistence, household scope, revocation, and a 15-minute maximum; output is bounded read-only status/count/time data with no lookup, retry, resend, impersonation, or mutation route                                               | dual-control, expiry, canary, DOM/log tests                              |
| CSV/file boundary escape                    | One exact multipart route accepts only `householdId` plus a `.csv`/`text/csv` part; BFF and API independently cap bytes/time/parts, strict UTF-8 and a fixed eight-column parser reject binary/archive/control/malformed input, and no remote URL, download, object store, attachment renderer, or arbitrary proxy exists | malicious corpus, boundary, and route tests                              |
| Formula or content injection                | Cells beginning with `=`, `+`, `-`, or `@` after normalization are rejected; invalid values are discarded and never echoed; valid names/labels pass shared sensitive-content checks and render only as text                                                                                                               | parser, API, DOM, and log-redaction tests                                |
| Import mass assignment or IDOR              | Owner and household come from the authenticated owner check; state, source, status, visibility, responsibility, merchant attachment, duplicate kind, timestamps, versions, commitments, and occurrences are server-derived; foreign/member/staff/nonexistent lookups fail uniformly                                       | role/owner matrix and mass-assignment tests                              |
| Preview or duplicate manipulation           | Exact normalization, integer minor-unit conversion, category-compatible exact merchant matching, deterministic fingerprints, in-file/existing classification, and confirmation-time revalidation prevent a preview from becoming authority                                                                                | corpus, stale, duplicate, and revalidation tests                         |
| Partial/replayed import confirmation        | Current ETag plus operation-scoped idempotency, user-first mutation fencing, locked job/household scope, one transaction for commitments/occurrences/item/job/audit/replay, and terminal states give confirm/discard/expiry a single winner                                                                               | rollback, replay, stale-tab, pool-size, deletion, and race tests         |
| Raw CSV disclosure or retention             | Raw bytes exist only during bounded request parsing and are never committed/returned/downloaded/logged/exported; invalid cells are not stored; the schema requires SQL `NULL` in every job state; preview availability expires within 24 hours; subject deletion removes normalized import rows                           | pre-confirm DB canaries, lifecycle, privacy export/delete, and log tests |
| Restore-target destruction                  | The local drill generates and regex-validates a unique disposable database name, accepts no target input, dumps the canonical database read-only, restores transactionally, verifies allowlisted state, and traps cleanup of only the exact disposable database/archive                                                   | success and forced-failure restore tests                                 |
| Financial metadata disclosure               | no bank connection or payment credential fields; labels are bounded and masked; API responses are ownership-scoped; logs omit bodies and financial values                                                                                                                                                                 | validation, IDOR, and log-review tests                                   |
| Repudiation                                 | immutable decision/attempt/guide snapshots, attestation/savings transitions, lifecycle events, correlation IDs, and same-transaction redacted application audit preserve bounded local history without claiming a legal or infrastructure audit                                                                           | history, lock, rollback, and audit tests                                 |
| Information disclosure via actuator/OpenAPI | only health/info and explicit readiness/liveness exposure; no env/configprops/heapdump                                                                                                                                                                                                                                    | endpoint inventory test/manual curl                                      |
| Denial of service                           | BFF rejects JSON bodies above 64 KiB and import files above 256 KiB under total read deadlines, bounds responses including 5 MiB exports, caps CSV rows/fields, and times out upstream work; high-risk operations have bounded rate events; edge-wide limits remain a production requirement                              | stream/parser timeout, size, row, load, and rate-limit tests             |
| Elevation to admin/support                  | only exact case-sensitive client roles map; every staff role is isolated; no role is inferred from email/name/default/unknown claims; support additionally requires a current owner code                                                                                                                                  | JWT and complete cross-role authority matrix                             |
| Supply-chain compromise                     | pinned direct dependencies, lockfile, Dependabot, Maven/Node dependency review, CI secret scan                                                                                                                                                                                                                            | reproducible bootstrap and CI                                            |

## Milestone 6 local security checkpoint

The final local evidence was recorded on 2026-08-03 after refreshing Trivy's
vulnerability and Java databases. The repository scan reported zero
high/critical vulnerabilities, zero high/critical misconfigurations, and zero
detected secrets. Exact-image scans reported zero high/critical findings for
API image
`sha256:ca2ef11ae0f3e5a69f284c09467d6540c86f1d03ef2b9dd12a7c824cfaf3d943`
and web image
`sha256:988460eac8e103d498402ecdee0a465911528f9118a0ed4f27d7aa6307fc40a3`.
Their CycloneDX inventories contained 190 and 40 components respectively, and
the final Gitleaks scan was clean.

The first fresh image scan found Alpine CVEs with available fixes and CVEs in
unused npm tooling bundled in the web runtime. The final runtime Dockerfiles
run `apk upgrade` in both images, and the web runtime removes npm and corepack
after the application is assembled. The zero-finding result
therefore applies to the remediated exact images above, not to the earlier
images.

After explicit user authorization for inventory egress on 2026-08-04,
`pnpm audit --prod --audit-level=high` reported no known vulnerabilities and
the complete delivery `make check` passed with exit code 0. CodeQL did not run:
the workspace has no commit, no remote, no local CodeQL installation, and no
authorization to commit or push. The user accepted this documented deferral;
it is not a CodeQL pass. The user explicitly approved Milestone 6 on
2026-08-04.

The import privacy boundary remained intact throughout acceptance: raw CSV
bytes were never persisted, returned, logged, exported, or included in scan
artifacts. Persisted preview rows contain only normalized safe fields or
allowlisted invalid-row issues. Preview authority ends on confirmation,
explicit discard, or expiry within 24 hours; safe terminal provenance may
remain, and eligible subject deletion removes the normalized import records.

On 2026-08-09 the user separately authorized sanitized public source
publication and repository-triggered security/quality workflows. That later
authorization does not retroactively create a CodeQL pass for the historical M6
gate, and it authorizes neither a hosted service nor real-user/data processing.

## OIDC/BFF-specific abuse cases

- Redirect targets are local relative paths or configured allowlisted origins;
  user input must not become an arbitrary callback or post-login redirect.
- M5 BFF handlers use an exact, case-sensitive
  method/path/query/body/header allowlist. JSON reads have a 64 KiB cap and a
  total deadline. No BFF route accepts a guide target or implements a general
  redirect/proxy/download surface.
- HTTPS guide targets render only from the authenticated API response, require
  an explicit user gesture, and use `rel="noopener noreferrer"`. Demo deep
  links also require an explicit gesture and cannot be opened automatically.
- The BFF preserves `Idempotency-Key` and `If-Match` only on the exact mutation
  routes that require them; neither value enters rendered props, client
  telemetry, or logs.
- The exact subject-export route alone may pass the canonical JSON media type,
  fixed filename, SHA-256, and at most 5 MiB; alternate media, filename,
  oversized, duplicate, encoded, traversal, and near-miss routes fail closed.
- Invitation and support plaintext codes are never put in a URL, rendered
  server prop, browser storage, notification, Mailpit message, or general
  telemetry. They exist only in the one-time authenticated response and the
  user's manual transfer.
- Production startup must reject placeholder auth secrets and insecure cookie
  settings. Development exceptions are explicit and local-only.
- Access/refresh tokens remain server-side and must not appear in rendered page
  props, client bundles, error pages, telemetry, or browser storage.
- Sign-out clears the local session and requests provider logout when configured.
- The API must reject tokens for a wrong issuer, audience, expiry, or signature.

## API/data abuse cases

- A client cannot set `ownerUserId`, timestamps, IDs, or OIDC subject during
  household creation.
- A client cannot set commitment household ownership, generated occurrence
  state, optimistic version, timestamps, or server-derived action policy.
- Commitment reads, writes, archive operations, occurrence lists, summaries,
  and calendar queries all combine object ID with authenticated ownership.
- Money accepts only bounded non-negative integer minor units and a supported
  ISO currency; floating-point amounts never cross the API boundary.
- Recurrence intervals and query horizons are bounded. The 90-day projection
  job is idempotent and protected by a commitment/date uniqueness constraint.
- Display names, merchant queries, and masked payment labels are length-bounded
  and treated as text. Full card/account numbers, UPI IDs, and
  high-confidence secret/token patterns are rejected rather than stored; this
  is a bounded guard, not general DLP.
- A stale update or archive request produces a safe conflict/precondition
  problem response and cannot overwrite a newer version.
- A renewal decision accepts only the chosen action and optional bounded note.
  The server resolves ownership, current allowed actions, occurrence snapshot,
  amount kind, currency, scheduled date, actor, and timestamps. A later
  occurrence replacement cannot rewrite that snapshot.
- An ordinary user cannot create, edit, publish, retire, or re-review a guide;
  set a guide target; choose track applicability; or claim a guide is current.
  `GUIDE_ADMIN` may clone a server-selected published version, edit only
  existing title/instruction text, risk notice, and a 30-to-90-day review
  interval, then publish or retire through ETag/idempotency-protected
  transitions. IDs, merchant, structure, tracks, order, action types, target
  keys/URIs, locks, status, version, and timestamps remain server-controlled.
- URI validation reparses every actionable target at read and attempt time.
  Only exact lowercase `.example` HTTPS hosts beneath configured paths and
  `autopayguard-demo://mandates/service/` paths are valid. HTTP, UPI, intent,
  JavaScript, data, file, protocol-relative, user-info, port, query, fragment,
  suffix-only, encoded-delimiter, traversal, and mixed-case spoof inputs fail
  before a response can expose the value.
- A cancellation attempt requires the exact owned non-archived commitment and
  occurrence, current cancel decision, current guide, and one unused
  operation-scoped idempotency binding. Owner, snapshots, money, recurrence,
  guide version, track applicability, savings period, verification date,
  completion, lifecycle, and version are server-controlled.
- Attempt PATCH replaces the complete mutable track state and requires the
  quoted current ETag. Only documented track transitions and conditional
  abandonment are legal; confirmed, not-required, abandoned, and disputed
  terminal states cannot be reopened.
- Verification requires both a bounded idempotency key and current ETag.
  `SELF_REPORTED` requires completed tracks; `VERIFIED` and `DISPUTED` use the
  household-local date and cannot occur before the saved follow-up date.
  Verification does not alter commitment or occurrence state.
- Savings never accepts a client amount, currency, period, state, reason, or
  verification source. The server uses the pinned recurrence and money
  snapshot, checked integer addition, and exact recurrence dates. Fixed,
  estimated, unknown, currency, and state buckets cannot be mass assigned or
  silently combined.
- A retry or concurrent request cannot append a second event for the same
  attempt and transition. A reversal points to the current quantified state
  and carries only the server-derived `ABANDONED` or `DEBIT_OCCURRED` reason.
- Unknown-variable savings remain unquantified. Unlike currencies and
  potential, self-reported, verified, and reversed states have no combined
  total.
- Notes and feedback are optional bounded plain text. They reject obvious PIN,
  OTP, full account/card, full UPI ID, and credential patterns; cannot carry a
  guide target; are output-encoded; and are omitted from problem details,
  logs, diagnostics, metrics, traces, and analytics.
- Feedback is reachable only through an owned commitment/guide pair. An
  `UNSAFE_LINK` report suppresses that version only for that owner; it cannot
  mutate or globally disable the fictional guide.
- M5 exposes no multipart, attachment, object-storage, remote-content preview,
  provider-callback, import/CSV/file, bank-feed, payment, refund, or
  mandate-action endpoint.
- A client cannot provide a notification recipient, message body, provider
  identifier, semantic key, attempt count, scheduled instant, or outbox state.
- Missing notification preferences and household defaults are inert. Enabling
  email requires an explicit current-version write by the authenticated owner.
- Reminder rules accept only the supported channels, offsets from zero through
  ninety days, valid local times, and non-duplicated channel/offset pairs.
- Every preference, household rule, commitment override, notification, read
  mutation, and diagnostic query is resolved through the authenticated user.
  Foreign and nonexistent object identifiers remain indistinguishable.
- A notification semantic key uses recipient, household, commitment, scheduled
  date, channel, and offset rather than replaceable occurrence or rule UUIDs.
- Cursor and page limits are bounded. Filter values are exact allowlisted enums.
- Quiet-hour start equals end is rejected. Overnight intervals, daylight-saving
  gaps/overlaps, suppression, and downtime catch-up are deterministic.
- SMTP addresses come from the immutable identity mapping and must pass the
  local fake-domain allowlist. API payloads cannot override them.
- Mail content is generic and cannot expose commitment name, merchant, amount,
  payment label, token, or credential. Raw provider failures are not persisted
  or returned.
- Names, locale, currency, and timezone are bounded and validated. Error payloads
  do not echo unsafe input.
- Database uniqueness races become a safe conflict/problem response, not a
  stack trace.
- Correlation IDs accept a conservative character set and length so they cannot
  inject log lines.
- A member sees a commitment only when their membership is active, both owner
  and member have current sharing consent, and the row is `HOUSEHOLD`.
  Responsibility references one active member but grants no write, payment,
  notification, provider, decision, cancellation, or savings authority.
- Invitation acceptance locks the household/membership scope, binds the
  intended fake-local subject, and has one winner at concurrent acceptance or
  member-removal/deletion boundaries. Plaintext and digest never appear in a
  later product read.
- Privacy export arrays use documented stable ordering and lexicographic object
  keys; integer money, nulls, provenance, and UTC timestamps are preserved.
  Tokens, code digests, idempotency internals, raw failures, and foreign-only
  data are absent.
- Correction execution revalidates the fake-local identity and exact IANA
  timezone immediately before its one-transaction update. Deletion first locks
  membership scope and fails closed for the canonical demo, non-fake identity,
  multi-member household, stale request, or injected failure.
- Privacy and support diagnostic reads append their redacted audit event in the
  same transaction. Audit responses exclude actor identity, household,
  commitment, content, money, guide targets, codes/digests, and request bodies.
- Support resolution accepts only the one-time code, not a household/user lookup
  field. It returns contract-bounded counts, statuses, versions, and timestamps
  and exposes no impersonation or state-changing support route.
- Import upload accepts exactly one household ID and one bounded CSV part.
  Filename and media type are validation signals only and are never retained.
  Strict UTF-8 decoding, exact header/column count, bounded quoting and fields,
  formula-prefix rejection, shared sensitive-content validation, exact decimal
  conversion, and allowlisted enums reject the complete file or isolate a row
  without echoing submitted cells.
- A preview is not a commitment. Only an owner can select valid opaque item IDs,
  and duplicate rows begin unselected. Confirmation locks and revalidates the
  job, duplicate state, merchant match, and commitment rules before creating
  private `CSV` commitments and deterministic occurrences in one transaction.
- Raw import content has no read/download endpoint and is not committed to
  product storage. Request-scoped references become unreachable when request
  processing returns; this does not claim JVM/container buffer zeroization.
  Scheduled and access-time checks end preview availability within 24 hours.
  Privacy exports include only safe normalized provenance, and user-first
  mutation fencing ensures eligible deletion removes subject-owned jobs/items
  without racing import audit or control state.
- The local restore exercise never accepts a destination name. It restores a
  read-only dump only into a generated, validated disposable database and uses
  a failure-safe trap; it does not claim production point-in-time recovery,
  backup erasure, Keycloak recovery, or disaster-recovery readiness.

## Private Beta readiness implementation boundary

The 2026-08-09 authorization permits local fake-data-only source,
dependency/configuration, test, documentation, and seeded-rehearsal work. PB-G00
used a test-only fixed clock and a patched transitive dependency; it did not
change production recurrence semantics, the deployed architecture, data
boundary, external threat controls, or CodeQL status. The proposed Private Beta
remains NO-GO.

### Preliminary PB-G04A/PB-G06 local delta

ADR-019 adds local application-layer fail-closed controls. For identity,
production startup rejects any profile set other than only `prod`, implicit
provisioning, and disabled verified-email enforcement. Token provisioning requires
`email_verified=true`; subject lookup cannot rebind by email; deletion
tombstones remain effective; and both API and web reject zero, unknown,
duplicate, or multiple API-client roles instead of selecting one. Static and
live-local realm reconciliation rejects public registration, permissive
recovery/account flags, external identity providers, unsafe client grants/
redirects/origins, and unexpected role mappings.

That is PRELIMINARY/PARTIAL, not a closed enrollment lifecycle. The current user
key stores `sub` without `iss`; a real or multi-issuer IdP requires explicit
`(iss, sub)` storage, uniqueness and migration. Reversible disablement, live
session/token revocation, staff MFA, recovery, break-glass, offboarding, a real
approved IdP and named identity/security/operations owners remain blockers.

For environment configuration, explicitly selected API/web production guards
validate modes and profiles, require non-local HTTPS destinations and exact declared origins,
disable unapproved trusted-host/forwarded-header and development surfaces,
reject excess management/error/schema exposure, and require distinct configured
runtime/Flyway database usernames. Web-owned dependency fetches reject
redirects. Those checks do not enforce network egress or prove redirect behavior
inside framework/dependency-managed OIDC/JWK traffic, database grants or
schema/object owners. The API process still receives the Flyway credential, and
an omitted/misspelled profile cannot activate a profile-scoped guard; a future
deployment must isolate migration authority and pin production mode. India-
region placement, TLS/HSTS/edge/WAF/rate controls, private networking/data
plane, managed secrets/KMS/encryption, backup/recovery, cost authority, real
hosts and accountable owners are unapproved or absent. Endpoint strings used
by pure tests are never resolved or contacted.

PB-G04A and PB-G06 therefore remain `BLOCKED`; the controls above may not be
presented as candidate, environment, deployment, or Private Beta evidence.

`docs/security/PRIVATE_BETA_RISK_REGISTER.md` records the unresolved candidate
risks, including CodeQL, development-stack exposure, real-data purpose and
retention, fictional guide expectations, operations/incident ownership,
observability, recovery, external email, analytics minimization,
authorization regression and supply-chain controls. That register accepts no
risk and assigns no human owner.

Any external/shared environment or material new flow requires a threat-model
delta for the selected identity, network, secrets, encryption, vendor, logging,
backup, email, guide, and data paths plus seeded security/incident evidence.
Local implementation completion is not security approval.

## Local-environment risks

Compose configuration is for a single developer machine only. Published ports,
fake credentials, Mailpit, realm import, development SMTP, and TLS exceptions
make it unsuitable for shared or internet-exposed hosts. Mailpit captures
messages without production-grade access control and must contain only fake
addresses and generic content. The non-superuser application role owns the
local application database and `public` schema so the same development process
can run Flyway and the API; this is deliberately not a production privilege
model. A production milestone must introduce a separate migration owner and
runtime DML-only role. `.env` must not be copied into images or CI artifacts.
Container volumes contain only fake data and can be removed by the explicit
reset command. The twenty guide fixtures use reserved `.example` hosts and the
non-production `autopayguard-demo` scheme. A manual acceptance flow must not
replace them with a resolvable host, real merchant, production app scheme, or
real payment destination. The M5 owner, member, foreign, four isolated staff,
and deletion identities are fake local fixtures only. Invitation/support codes
must be transferred only within the acceptance session and the guarded runner
must leave no active code, artifact, draft, or multi-member test household.

## Deferred risks

The bounded M4 cancellation and M5 fake-local sharing, privacy, guide-admin,
audit, and support threats are covered above. Before real merchant guides,
target monitoring, independent provider confirmation, or production
cancellation/support/privacy operations, add operator identity governance,
case management, abuse response, externally monitored link ownership,
production retention/key management, and a new perimeter review.

The bounded M6 CSV import threats are covered above. Before binary evidence,
archives, spreadsheets, remote/cloud files, OCR, email/SMS ingestion, bank or
Account Aggregator feeds, or object storage, add malware scanning, content
disposition/download policy, signed access, sandboxing, parser isolation,
production encryption/key management, deletion/backup propagation, vendor
review, and a new approved threat model.

Before production email, add authenticated-domain configuration, bounce and
complaint handling, provider webhook authentication and replay protection,
recipient suppression, retention, rate limiting, abuse monitoring, deliverability
operations, and a documented response to SMTP acceptance ambiguity.

Before public beta: independent penetration test, ASVS Level 2 evidence review,
restore drill, incident-response tabletop, production identity hardening,
centralized alerts, WAF/rate limiting, dependency/container/SBOM scanning, and
written remediation/risk decisions.
