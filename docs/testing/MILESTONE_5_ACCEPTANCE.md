# Milestone 5 acceptance

Status: implementation and autonomous fake-local acceptance passed on
2026-07-29. The user explicitly approved Milestone 5 and separately authorized
Milestone 6 on 2026-07-29. Fake local data and fictional guides only.

## Preconditions

- Milestones 1 through 4 remain accepted and V1-V4 migrations/checksums are
  unchanged.
- The stack uses separate seeded fake identities for household owner, invited
  member, foreign user, `GUIDE_ADMIN`, `PRIVACY_ADMIN`, `AUDIT_READ`, and
  `SUPPORT_READ`.
- Staff identities receive only the exact role under test. A staff role does
  not imply household membership or any other staff role.
- The canonical demo user is marked deletion-protected. Destructive acceptance
  uses a resettable disposable fake identity and never the canonical demo.
- No test enters real identity, contact, merchant, account, payment, or
  credential data. Invitation and support delivery is manual; no email is
  sent.

## Automated gate

Run from the delivery workspace:

```powershell
.\make.ps1 bootstrap
.\make.ps1 up
.\make.ps1 seed
.\make.ps1 check
```

Before the human gate, a guarded fake-local M5 verifier must also pass against
the canonical local stack:

```powershell
$env:M5_LIVE_ACCEPTANCE_ACK = "I_ACKNOWLEDGE_LOCAL_FAKE_M5_ACCEPTANCE"
.\make.ps1 m5-live
.\make.ps1 m5-ui-live
Remove-Item Env:M5_LIVE_ACCEPTANCE_ACK
```

The guarded verifier and real-OIDC browser suite must refuse another base URL,
a missing/mismatched acknowledgement, a non-fake identity, or deletion of the
canonical demo. They must restore or recreate every disposable fixture and
leave no unexpired export artifact, invitation code, support code, draft, or
multi-member test household.

## API authority matrix

`OWNER` and `MEMBER` are persisted household roles. The other entries are exact
JWT API client roles.

| Surface                                          | Required authority                                                     | Explicit denial                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| Invite/revoke/remove/share/support-code mutation | Household `OWNER` and current required consent                         | `MEMBER`, foreign `USER`, every staff role without ownership |
| Household-shared read                            | Active `MEMBER`, current owner/member sharing consent, `HOUSEHOLD` row | Private, removed, withdrawn, foreign, or staff-only caller   |
| Own notices, consents, requests, export download | Requesting `USER`                                                      | Owner of another household and all staff roles               |
| Correction/deletion execution                    | `PRIVACY_ADMIN`                                                        | `USER`, all other staff roles, stale/ineligible request      |
| Draft/publish/retire/feedback review             | `GUIDE_ADMIN`                                                          | `USER` and every other staff role                            |
| Audit list                                       | `AUDIT_READ`                                                           | `USER` and every other staff role                            |
| Support diagnostic resolution                    | `SUPPORT_READ` plus current owner code                                 | Role alone, code alone, expired/revoked/foreign code         |

Every denial is checked through the direct API and BFF. Navigation visibility
is not acceptance evidence for authorization.

## Acceptance matrix

| ID    | Area                              | Required automated evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M5-01 | Migration                         | Empty-to-M5 and populated V4-to-M5 upgrades preserve V1-V4 checksums and prior rows; every founder becomes immutable `OWNER`; every existing commitment is `PRIVATE` with no responsibility. An exact saved M1 notice acceptance is faithfully backfilled as `ACKNOWLEDGED`; no sharing consent, invitation, request, artifact, audit, or support code is inferred.                                                                                                                                                                                                                                                                                           |
| M5-02 | JWT roles                         | Wrong issuer/audience/signature/expiry fails. Only exact case-sensitive `USER`, `GUIDE_ADMIN`, `PRIVACY_ADMIN`, `AUDIT_READ`, and `SUPPORT_READ` client roles map. Unknown, realm-default, email/name-derived, and case-confused roles grant nothing. Cross-role tests cover every row of the authority matrix.                                                                                                                                                                                                                                                                                                                                               |
| M5-03 | Member isolation                  | A member reads only `HOUSEHOLD` data. A private canary name/amount is absent from object APIs, lists, counts, totals, calendar, upcoming, decisions, cancellation, savings, notifications, diagnostics, DOM, and response-size/count side channels. All legacy mutations remain owner-only. Foreign and private IDs do not enumerate.                                                                                                                                                                                                                                                                                                                         |
| M5-04 | Sharing/responsibility            | Sharing requires current owner consent and ETag. `responsibleMemberId` is null for `PRIVATE`, references one active member for `HOUSEHOLD`, and grants no mutation or delivery authority. Member removal and responsibility clearing are atomic; stale and concurrent writes have one winner.                                                                                                                                                                                                                                                                                                                                                                 |
| M5-05 | Invitations                       | Codes contain 256 random bits, plaintext is returned once, and only its SHA-256 persists. Plaintext is absent from PostgreSQL; digest is absent from product/API reads, URLs, logs, problems, audit, browser storage, Mailpit, notifications, and outbox. Creation rejects idempotency keys; a single-active constraint gives concurrent creation one code-returning winner. Intended-subject binding, exact 24-hour boundary, revocation, acceptance replay, duplicate pending/member, and concurrent acceptance tests pass.                                                                                                                                 |
| M5-06 | Notices/consent                   | Acknowledgements and `HOUSEHOLD_SHARING` grant/withdraw events are append-only and notice-version pinned. Stale or unacknowledged notice fails. Owner withdrawal suspends invitations/member visibility; member withdrawal suspends only that member; regrant restores authorization without rewriting history or visibility fields.                                                                                                                                                                                                                                                                                                                          |
| M5-07 | Export completeness               | A transactionally consistent table/field inventory is reconciled field-for-field to the documented `autopay-guard-export-v1` top-level manifest, including all in-scope historical states, nulls, integer money, timestamps, and provenance. Fixture bytes use lexicographic object keys, documented/stable array ordering, UTC `Z`, no BOM/insignificant whitespace, and a pinned SHA-256. No in-scope row is omitted or truncated.                                                                                                                                                                                                                          |
| M5-08 | Privacy lifecycle/export security | Requester-only cancellation succeeds only before `PROCESSING`; retry, stale ETag, foreign cancel, and cancel/processing races are deterministic. Only the requesting subject can download a ready artifact; `PRIVACY_ADMIN`, owner, other user, audit, and support callers fail. Tokens, code digests, credentials, idempotency internals, raw failures, and foreign-only data are absent. Exact canonical bytes and SHA-256 are stored in PostgreSQL, never exceed 5 MiB, expire and are physically purged at or before 24 hours, and return gone afterward without implicit regeneration. Oversize/incomplete output is `FAILED`, never partial or `READY`. |
| M5-09 | Correction                        | Only an IANA timezone is accepted. `PRIVACY_ADMIN` execution conditionally updates the app user and request plus audit in one transaction. Invalid zone, other field, stale ETag, replay mismatch, concurrent execution, rollback fault, deleted subject, and foreign request tests pass. Historical snapshots remain unchanged.                                                                                                                                                                                                                                                                                                                              |
| M5-10 | Deletion                          | Multi-member membership and the canonical demo each block before mutation. For an eligible disposable user, one transaction cascades every sole-member household/dependent row, removes artifacts/operational rows and the local user row, writes a minimal one-way fake-local-subject tombstone and redacted audit event, and prevents OIDC recreation. The documented terminal retry returns non-enumerating not-found without retaining an idempotency link to erased data. Injected failures roll everything back; concurrent membership/deletion has one safe winner.                                                                                    |
| M5-11 | Guide drafts                      | A draft is a server clone of one published version. Only risk notice, 30-90-day review interval, and existing title/instruction text can change. IDs, merchant, version/status/timestamps, structure, tracks, order, action type, target key/URI, allowlist, head, and lock fields reject mass assignment. Draft ETags and role isolation pass.                                                                                                                                                                                                                                                                                                               |
| M5-12 | Publish/retire                    | Publish validates M4 structure/targets and atomically creates all V4 lock snapshots, head event, current-head update, and audit. Prior/published rows cannot update/delete. Retirement appends an event and changes only the head, never the locked published status. Stale, retry, rollback, publish/publish, publish/retire, and retire/attempt races have deterministic outcomes; pinned attempts remain readable.                                                                                                                                                                                                                                         |
| M5-13 | Feedback/audit                    | The guide-admin queue and DOM never contain feedback note, user, household, commitment, identity, amount, or target content. Every successful M5 mutation has one same-transaction append-only audit event. Audit output contains only allowlisted metadata and stays unchanged on rollback; only `AUDIT_READ` can list it.                                                                                                                                                                                                                                                                                                                                   |
| M5-14 | Support                           | Owner codes are random, digest-only, one-time displayed, revocable, household-scoped, and expire no later than 15 minutes. Creation rejects idempotency keys; a single-active constraint gives concurrent creation one code-returning winner. Both valid code and `SUPPORT_READ` are required at read time. Contract-maximum counts fit; seeded canary IDs, identity, names, amounts, currencies, content, notes, targets, errors, codes, and digests are absent from API, DOM, logs, and audit. No impersonation, lookup, retry, resend, or mutation route exists.                                                                                           |
| M5-15 | API/BFF/contracts                 | Every M5 method/path/query/body/header combination is exact, paginated where applicable, same-origin for mutations, `no-store`, size/time bounded, and generated from OpenAPI. The exact subject-export route passes a contract-maximum 5 MiB canonical JSON artifact and rejects a larger, alternate-media, filename, or arbitrary-download response. Missing/extra/duplicate/encoded/traversal inputs, malformed UUID/cursor/ETag/idempotency, extra JSON properties, unsupported media, bodies on GET/DELETE, and route near-misses fail before upstream use.                                                                                              |
| M5-16 | UI/accessibility                  | Loading, empty, ready, validation, confirmation, success, 401, 403/404, 409, 412, 428, expiry, blocked, and pagination-failure states are keyboard operable and honestly worded. Axe has no serious/critical violations; focus, live announcements, 320px/200% zoom, long text/counts, touch targets, headings, labels, and no page overflow pass on desktop and mobile.                                                                                                                                                                                                                                                                                      |
| M5-17 | Boundary/regression               | No invitation email, real provider/merchant link, payment action, Keycloak deletion, legal-compliance claim, cloud/file/CSV route, browser token storage, or new real-data path exists. Full M1-M4 suites, generated-client drift, production build, dependency/secret gates, deterministic seed, and migration checksum audit pass.                                                                                                                                                                                                                                                                                                                          |

## Real-OIDC browser journeys

Run each journey in desktop Chromium and Pixel 7 projects with serial,
isolated fake fixtures:

1. **Household:** owner acknowledges/grants, creates an invitation, transfers
   the displayed code manually, and a second browser context accepts after its
   own acknowledgement/grant. The owner shares and assigns a commitment; the
   member sees it read-only while private canaries and aggregate effects remain
   absent. Exercise withdrawal, regrant, revoke/expiry, stale ETag, replay, and
   sign-out.
2. **Privacy:** the subject creates export, timezone-correction, and deletion
   requests. Download and machine-parse the complete export, prove foreign and
   staff download denial, advance the injected clock through purge, and execute
   correction as `PRIVACY_ADMIN`. Show the deletion block for a multi-member
   disposable subject.
3. **Deletion:** using a separate sole-member disposable identity, execute
   deletion as `PRIVACY_ADMIN`; prove household data is gone, the user is
   removed locally, the tombstone is minimal, and a new OIDC session cannot
   recreate the user. Separately prove canonical-demo protection.
4. **Guide/audit:** `GUIDE_ADMIN` clones a guide, edits only allowed text/review
   fields, resolves a real stale draft, publishes, reviews redacted feedback,
   retires the head, and confirms immutable history. `AUDIT_READ` sees only the
   corresponding redacted events. Ordinary and cross-role direct navigation
   fails.
5. **Support:** owner generates a code and manually gives it to a
   `SUPPORT_READ` session. The redacted view contains only counts,
   status/version/timestamps. Revocation and the 15-minute boundary fail
   immediately; role-only, code-only, foreign, and canary-data cases fail.

At meaningful ready, empty, confirmation, conflict, blocked, expired, and
forbidden states, assert keyboard focus and Axe. After every identity signs
out, protected routes return to sign-in and local/session storage is empty.

## Required copy assertions

- Invitation success says no email was sent.
- Responsibility says it is a planning label, not ownership, editing, payment
  authority, provider access, or notification subscription.
- Member totals say they cover records visible to that member.
- Export says it is app-owned canonical JSON, is subject-only, and expires
  within 24 hours.
- Correction says only the app timezone changes.
- Deletion distinguishes app data/tombstone from Keycloak-account deletion and
  makes no legal-compliance claim.
- Guide publication says fictional local/current, never merchant/link verified
  or provider contacted.
- Audit says local application audit, not a legal compliance report.
- Support says redacted/read-only/no impersonation and not proof of resolution.

## Recorded result

The bounded M5 implementation and autonomous acceptance passed against the
canonical fake-local stack and a private local delivery workspace.

- The non-registry portions of the complete quality gate passed from the final
  delivery source: `.\make.ps1 lint`, `.\make.ps1 test`,
  `corepack pnpm contracts:check`, `corepack pnpm build`, the pinned Gitleaks
  8.30.1 scan, and `.\make.ps1 e2e`.
- Backend verification passed 164 Surefire tests and 27 real-PostgreSQL
  Failsafe tests: 191 total with zero failures, errors, or skips.
- Web verification passed 55 Vitest files / 406 tests. Prettier, ESLint, strict
  TypeScript, generated OpenAPI-client drift and path/query/header self-tests,
  and the production Next.js build also passed.
- Flyway V1 through V5 succeeded with checksums `-911544944`, `1293017193`,
  `-569287781`, `-491296913`, and `1548389659`. Empty-to-V5 and populated
  V4-to-V5 PostgreSQL paths are covered by the integration gate.
- The guarded `.\make.ps1 m5-live` verifier passed the household,
  consent/suspension, export/expiry/purge, correction, resettable deletion,
  guide publish/retire/reactivation, redacted feedback/support/audit, exact
  staff-role, stale-write, replay, race, rollback, and cleanup assertions.
- The dedicated real-OIDC `.\make.ps1 m5-ui-live` gate passed 4/4 in 3.3
  minutes: desktop and mobile privacy quality smoke plus the complete
  unmocked UI/BFF lifecycle on both projects. Axe coverage applies to the
  quality smoke; the longer lifecycle supplies the real state transitions.
- Independent desktop and mobile lifecycle reruns also passed before the
  official gate. The state matrix, keyboard/focus behavior, responsive
  containment, sign-out/protected-route behavior, and browser console checks
  were exercised automatically by real Chromium.
- The final standard Playwright matrix passed all 24 applicable tests in 8.2
  minutes across desktop and mobile Chromium. Its four real-OIDC M5 cases were
  intentionally skipped because the dedicated guarded gate runs them
  separately.
- The raw BFF traversal boundary gate passed 4/4, including its dedicated
  real-OIDC run and both standard-browser projects.
- A clean production web Docker image was rebuilt from the final delivery
  source. `.\make.ps1 seed` then reconciled eight distinct M5 identities, five
  narrow staff roles, four canonical commitments, explicit M3 settings, 20
  fictional M4 guides, private household state, redacted staff reads, and no
  invitation/member residue.
- Gitleaks 8.30.1 scanned the final source and found no leaks.
- PostgreSQL, Keycloak, Mailpit, API, and web are healthy. The sign-in route and
  Keycloak discovery returned HTTP 200 and API health returned `UP`.
- The in-app browser security policy did not permit access to localhost, so no
  in-app manual-review claim is made. The desktop/mobile review evidence is the
  automated real-browser Playwright evidence above.
- A fresh dependency-advisory upload was not repeated because permission to
  transmit the package inventory to the registry was not obtained. The prior
  audit of the same lockfile passed; every non-registry quality stage was
  rerun against the final source.

## Human gate

Gate passed. The user explicitly approved Milestone 5 and separately authorized
Milestone 6 on 2026-07-29.
