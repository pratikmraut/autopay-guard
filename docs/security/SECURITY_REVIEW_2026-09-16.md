# Security review: demo-only source candidate

Date: 2026-09-16. Scope: this repository's working source, all fetched Git
history, dependencies, local images and targeted fake-local regressions.
This is a source-assisted automated review, not an independent penetration test
or proof that a breach cannot happen. Public hosting remains unauthorized.

## Findings and remediation

1. **P1: public session action alias.** The old exact `/api/auth/session` check
   missed a trailing slash accepted by Auth.js. The session callback includes
   API access/refresh tokens intended only for server callers. A signed-in
   same-origin browser could reach that JSON endpoint; no cross-origin read or
   anonymous credential theft was established. The public route now permits only
   exact canonical operation/method pairs for the configured provider. Session
   and unknown aliases fail closed. Internal server `auth()` remains intact.
   Added 46 policy/handler regressions and authenticated alias browser checks.
   No real token was printed, published or retained by the review.
2. **P2: privacy export memory limits.** The 5 MiB check previously happened
   after complete database loading/serialization. A sufficiently large owned
   dataset could exhaust memory before safe rejection. No live exhaustion test
   was attempted. Per-request database-side sentinel limits now cap each
   collection at 1,000 rows, total rows at 10,000, inventory queries at 2,000,
   retained text at 5 MiB characters and serialized JSON at 5 MiB bytes. Excess
   data fails with no partial successful artifact. Consent/notice lookups are
   additional queries, separately bounded by the household-row cap. The existing exact canonical
   export fixture is unchanged. General per-owner storage quotas and public
   traffic controls remain hosting work, not solved by this export bound.
3. **Development dependency advisories.** An all-dependency audit found eight
   advisory matches (one critical, five high, two moderate) omitted by the old
   production-only check. Patched Vitest 4.1.11, scoped brace-expansion 1.1.18 /
   5.0.9 and js-yaml 4.3.2 overrides remove the reported matches. Local/CI audit
   now includes development dependencies at moderate-or-higher failure level.
   These advisories concern tooling; no evidence showed a production runtime
   exploit. Primary details: [Vitest UI](https://github.com/advisories/GHSA-5xrq-8626-4rwp),
   [Vitest mock paths](https://github.com/advisories/GHSA-82fw-gwwq-j7x9),
   [brace expansion](https://github.com/advisories/GHSA-rgw5-rvv9-x895),
   [YAML merge processing](https://github.com/advisories/GHSA-2883-xcg3-v3hh).
4. **Packaged Java dependency advisories.** The all-severity source scan found
   five MEDIUM matches in shipped Jackson 2/3 and Log4j API libraries, not merely
   unused Maven inventory. Same-line BOM overrides upgrade Jackson 2 to 2.21.5,
   Jackson 3 to 3.1.5 and Log4j to 2.25.5. Current DTO/mapper usage and Logback
   logging do not establish the advisory exploit prerequisites; that is not a
   reason to dismiss real vulnerable versions. Backend and packaged-image
   verification were repeated after the dependency changes. The final packaged
   API image scan reports zero vulnerabilities at every scanned severity.
   Primary advisory details: [Jackson case-insensitive binding](https://github.com/FasterXML/jackson-databind/security/advisories/GHSA-5jmj-h7xm-6q6v),
   [Jackson unwrapped views](https://github.com/FasterXML/jackson-databind/security/advisories/GHSA-5gvw-p9qm-jgwh),
   [Jackson external-property views](https://github.com/FasterXML/jackson-databind/security/advisories/GHSA-mhm7-754m-9p8w)
   and [Log4j MapMessage formatting](https://logging.apache.org/security.html#CVE-2026-49844).

## Review coverage and current evidence

- Fresh fetch included main and all 12 Dependabot branches: 17 reachable commits.
  Gitleaks 8.30.1 scanned 5.43 MB of history with no detected leaks. No Git history
  was rewritten. This is pattern-based detection, not proof that all personal
  information or every possible secret is absent.
- Fresh Trivy database repository scan found zero HIGH/CRITICAL findings for
  dependencies/configuration/secrets. The full JavaScript audit after patching
  reports no known vulnerabilities, including development dependencies.
- The final Git-selected, source-only all-severity rescan found no dependency
  vulnerabilities or secrets. Only the two LOW configuration recommendations
  below remain. The repository CI gate now fails on MEDIUM/HIGH/CRITICAL; image
  gates retain their HIGH/CRITICAL threshold.
- The all-severity configuration scan also notes two LOW Dockerfile healthcheck
  recommendations. Both runtime services already have explicit Compose
  healthchecks. A third LOW entry belonged to an ignored local build-helper file,
  not published source; it is excluded from the source-only final inventory.
- Source review covered JWT issuer/audience/authorized client/single-role
  validation, explicit enrollment, tenant ownership, imports, export download,
  BFF method/path/query/header/body controls, same-origin writes, redirects,
  token storage, guide URL allowlists, React rendering and redacted diagnostics.
- The original main commit `18dbaf6` has successful CodeQL workflow runs but 18
  open high-severity alerts. These must be triaged individually; a successful
  scanner run alone is not a clean result. No alert is silently dismissed.
- GitHub Dependabot alerts API returned 403 for the existing credential. The
  independent registry audit above is available; no claim is made that the
  remote Dependabot alert list was read or cleared.

## GitHub CodeQL triage on original main

No remote alerts were dismissed or scanner rules suppressed. Re-run CodeQL on
the patched PR before claiming remote closure.

| Original alerts                   | Evidence and action                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1–#8, JavaScript temporary files | Local coordination locks already used exclusive creation, not credential storage. Replaced direct predictable-temp opens with a private `mkdtemp` directory, exclusive `0600` owner file and atomic shared hard-link claim. Preserves cross-process exclusion. Five filesystem regressions cover contention, symlink/junction rejection and ownership-safe release. Windows uses inherited user temp-directory ACLs. |
| #17–#18, pagination arithmetic    | Controller validation already limits input to 1..100. Added explicit service-level bounds before identity/database access and `limit + 1`; fourteen regressions include integer extremes and valid boundaries.                                                                                                                                                                                                       |
| #9, disabled API CSRF             | The API is stateless and accepts only explicit Authorization bearer headers, not browser-managed cookie/session, Basic, query or form credentials. Pinned that resolver configuration and added negative tests. The cookie-authenticated web BFF separately enforces origin on writes. This is an architectural review decision, not an unconditionally exploitable CSRF finding.                                    |
| #10, audit GET                    | Role-protected reading records an access-audit event; it cannot modify returned audit entries.                                                                                                                                                                                                                                                                                                                       |
| #11–#12, invitation GETs          | Authenticated/scoped lists may expire already-due invitations. They cannot create, accept or revoke an invitation. Owner list authority is checked before scoped expiry.                                                                                                                                                                                                                                             |
| #13–#16, privacy GETs             | Owned/admin reads may audit access/download and clean already-expired artifacts. They cannot create/cancel/execute a privacy request. Some expiry housekeeping is global but limited by the due timestamp and also runs periodically.                                                                                                                                                                                |

Eleven new authentication integration tests prove all seven flagged GET paths
reject cookie/query credentials before decoding/resolving an identity, plus
form/Basic/HTTP-session rejection and valid-bearer role limits. These GETs are
not completely write-free: trusted display-name synchronization, reserved-fixture
mapping, auditing and time-based expiry are intentional incidental writes.
Cross-site navigation through the BFF can trigger incidental effects but does
not grant cross-origin response access or authorize business mutations.

## Infrastructure findings are not application-source findings

The fresh packaged API and patched web-image scans report no HIGH/CRITICAL
findings. Infrastructure images are also scanned separately, including their
bundled tools; no unneeded dependency is assumed safe solely because the
application uses PostgreSQL rather than SQL Server or localhost HTTP rather
than TLS. Findings require reachability and vendor-version review.

Keycloak 26.7.0 has a reported critical reset-credentials account-takeover issue.
The checked-in pin and running local service are updated to the official 26.7.3
patch release. Private local application/identity-database backups preceded
activation; existing identities, passwords and roles are preserved. The 26.7.3
scan still reports three entries:

- `CVE-2026-75595` in Netty handler: critical SNI/TLS-routing issue; local
  Keycloak uses HTTP, so that TLS/SNI prerequisite is absent in this local
  configuration. It remains an unresolved bundled-component finding for any
  hosting design; do not substitute unsupported JARs merely to silence a scan.
- `CVE-2026-22020` in the image's OpenJDK/libpng: the scanner still labels this
  high, but the assigning authority has **rejected** the CVE. The scanner's
  description and [vendor record](https://bugzilla.redhat.com/show_bug.cgi?id=2460045)
  both record that rejection. It is stale advisory metadata, not a confirmed
  unresolved vulnerability. The raw finding is retained, not suppressed.
- `CVE-2025-59250` in SQL Server JDBC: high scanner match. The artifact filename
  is `mssql-jdbc-13.2.1.jre11.jar`, while detected version metadata drops the
  `.jre11` suffix; the advisory lists that exact suffixed version as fixed.
  This is strong metadata-mismatch evidence, not a silently suppressed alert.
  The local configured database is PostgreSQL, not SQL Server.

The PostgreSQL pin moves from 18.4-alpine to 18.6-alpine, incorporating the
[official same-major security fixes](https://www.postgresql.org/docs/release/18.6/).
The candidate image still reports 31 HIGH/CRITICAL entries: 22 in the bundled
`gosu` Go runtime, seven in libuuid and two in OpenSSL. Their reachability has
not been established sufficiently to dismiss them. Trivy also warns that one
advisory has incomplete details and Alpine 3.24 end-of-life metadata is unknown.
Mailpit moves from 1.30.0 (36 HIGH entries) to the official
[1.31.1 patch](https://github.com/axllent/mailpit/releases/tag/v1.31.1), whose
candidate scan reports zero HIGH/CRITICAL entries.

The CI now includes separate fail-closed gates for the checked-in PostgreSQL,
Keycloak and Mailpit images. It must surface remaining vendor findings rather
than report only the clean application images. Image scan completion is not an
authorization to expose the local Compose stack.

## Remaining verification and deployment limits

The initial published candidate is draft PR #24, commit `6b57b0f`. Remote Maven,
frontend, both application-image builds/scans, Gitleaks, repository Trivy and
Mailpit scanning passed. The PostgreSQL/Keycloak failures match the documented
upstream findings. Dependency review reports an unavailable Dependency Graph;
this configuration gate remains open rather than being disabled.

GitGuardian's two reported secrets point to one deliberately fictional Basic
header in the negative authentication test, not a usable provider credential.
The test now generates ephemeral non-enrolled values; the rejection assertions
are unchanged. A new CodeQL check/reopen alert in the lock test is addressed
using one FileHandle. Neither scanner was suppressed or remotely dismissed.
Re-check the follow-up commit before claiming either remote alert is closed.

Windows Testcontainers could not connect, so 39 PostgreSQL integration cases
were skipped. The combined local gate passed with 32 browser cases and eight
explicit skips; final Java patches received a separate fresh Maven verify and
artifact scan. Precise final activation/browser results are in CODEX_RESULT.md.
Existing inline-script CSP allowance remains a defense-in-depth limitation;
no exploitable injection sink was confirmed. Provider revocation/MFA, production
database grants, infrastructure egress, TLS, monitoring and public shared-demo
abuse controls remain separately gated. The local HTTP Compose stack, Mailpit
and generated demo password must not be exposed to the internet.

For the P1 issue, no evidence of exploitation was found or claimed. This review
does not inspect personal browsing activity or incident logs. If an operator
has exposed this app beyond localhost, patch first and separately review/revoke
affected sessions; do not rotate every credential or delete users blindly.
