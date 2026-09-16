# Codex result - demo-only security review

Date: 2026-09-16. Scope: preserve the existing password-required fictional demo,
close registration, review source/history/dependencies and prepare sanitized
GitHub publication. No production hosting, real-user enrollment or real data.

## Current changes

- Demo-first landing/sign-in and closed signup. Existing credentials, accounts,
  ordinary USER features and saved workspace data are preserved. Staff roles
  remain separate; reserved demo deletion protection remains enabled.
- Branded inherited Keycloak login, exact-local demo username hint and narrow
  realm operators. No password in source/UI and no authentication bypass.
- Fixed a public Auth.js session-path alias that could expose server-intended
  token fields to an authenticated browser. Canonical method/path allowlisting
  now denies session aliases; internal server authentication remains intact.
- Bounded privacy-export database reads and serialization. Added paging bounds,
  header-only bearer regressions and safer cross-process fixture locks.
- Patched eight development dependency advisory matches; expanded audits to
  include development dependencies and added infrastructure-image CI gates.
- Patched five MEDIUM Java inventory matches with Jackson 2/3 and Log4j BOM
  patch overrides. The rebuilt API JAR and runtime image use the fixed versions.
- Updated local pins/runtime to Keycloak 26.7.3, PostgreSQL 18.6-alpine and
  Mailpit 1.31.1. No scanner suppressions or remote alert dismissals were added.

## Fresh evidence and limits

- Fresh full-history Gitleaks scan: 17 fetched commits, 5.43 MB, no detected
  secrets. Pattern-based detection is not proof that every possible secret or
  personal datum is absent. No Git history rewriting was performed.
- All-dependency JavaScript audit reports no known vulnerabilities. The final
  Git-selected source scan has no dependency/secret findings and two LOW
  Dockerfile healthcheck recommendations (Compose already defines checks).
  Final API image scanning reports zero vulnerabilities at all severities;
  patched web and Mailpit image scans report zero HIGH/CRITICAL findings.
- Keycloak has three raw scanner entries: one unresolved bundled Netty finding,
  one rejected CVE and one strong version-metadata mismatch. PostgreSQL retains
  31 raw HIGH/CRITICAL bundled-component findings. They remain visible and the
  new CI infrastructure gates are expected to fail until properly resolved.
- Original main has 18 open high CodeQL alerts. Source fixes and explicit
  architectural triage are documented; remote closure requires the new PR scan.
  The Dependabot alert API was inaccessible (403); its alert list was not cleared.
- Independent source review found no additional blockers in these fixes.
  This is not an independent penetration test or a guarantee against breaches.
- Fresh local checks passed: 347 Surefire tests, 640 Vitest tests across 72 files,
  nine web request-gate/lock tests and 35 root operator/policy/restore tests.
  Formatting, ESLint, TypeScript and generated-contract verification passed.
  The 39 PostgreSQL Failsafe cases remain skipped by the Windows Testcontainers
  availability guard; they are not fresh PostgreSQL integration passes.
- `make check` completed with exit 0 for the demo/authentication fixes:
  all checks above, production build, dependency audit, a 5.15 MB source secret
  scan and 32 desktop/mobile browser cases passed. Eight browser cases were
  intentionally skipped: six pre-existing opt-in M5/M6 real-data-path fixtures
  and two signup cases because registration is now closed. They are not passes.
- The final Jackson/Log4j patch overrides were added during that combined run,
  after its Maven phase. A separate fresh Maven verify on those final versions
  passed all 347 tests (the same 39 PostgreSQL skips), built the executable JAR
  and passed OpenAPI drift verification. The exact rebuilt API image has zero
  all-severity dependency matches. Post-activation demo browser retesting passed
  all four desktop/mobile cases: branded forms, closed registration, existing
  password-required OIDC, six blocked session aliases, profile read and sign-out.
  The combined run is not misrepresented as a fresh
  all-in-one check of dependencies added after its Maven phase.
- Earlier attempts exposed an obsolete enabled-registration expectation
  (corrected) and interrupted Vitest worker startup (clean rerun passed). No
  test assertion or security gate was removed to obtain the final results.

## Local activation and preservation

- Private application/identity database backups were made before upgrades.
  Post-upgrade counts are unchanged: eight application identities, three
  households, 37 commitments and 11 provider identities (including local staff
  fixtures). Only aggregate counts were inspected for preservation evidence.
- All five services are healthy. Registration remains false and the existing
  realm retains the `autopay-guard` theme. No seed/reconciliation, password reset
  or account deletion was used.
- Due to registry build-path timeouts, verified host-built `.next` application
  assets and the Java JAR were packaged into retained Linux runtime images.
  No Windows dependencies, `.env`, database content or credentials were copied.
  Previous image tags were retained. This is not a clean network-backed build;
  fresh CI must build the checked-in Dockerfiles independently.
- Main branch protection is unchanged pending the user's requested exact-rule
  approval after the safety review blocked the permission change. Do not claim
  that a source commit alone resolves the GitHub warning.

Detailed findings: `docs/security/SECURITY_REVIEW_2026-09-16.md`.
The loopback-only stack, Mailpit and generated local password must not be
exposed publicly. Sanitized source publication is not deployment approval.

## Publication and remote security checks

Published the initial reviewed commit `6b57b0f` to
`codex/portfolio-accounts-demo` and opened draft PR #24. Main is unchanged;
there is no merge or deployment. A post-commit Gitleaks scan of 18 reachable
commits (5.61 MB) found no detected leaks.

The initial PR's Maven, frontend, both clean Dockerfile builds/image scans,
repository Trivy, Mailpit image and Gitleaks jobs passed. Thus the earlier local
cached-runtime packaging limitation now has independent fresh CI build evidence
for that commit. Real-OIDC remote browser testing was still running at inspection.

The remote checks also exposed two follow-up test-fixture improvements:

- GitGuardian matched the static fictional Basic-auth rejection fixture twice
  (plain/basic and base64 detectors). It was never an enrolled or usable account
  credential. The test now creates ephemeral random values, still asserting 401
  and no identity/decoder interactions. No real credential reset or history
  rewriting was performed; no warning was silently dismissed. All eleven
  focused authentication tests passed after the fixture change.
- CodeQL flagged a check/reopen pattern in the new lock test. One FileHandle now
  supplies both metadata and content, with guaranteed close. Five focused tests,
  scoped lint and formatting passed. This follow-up changes tests, not runtime.

These fixes require fresh remote check results on the follow-up commit before
claiming alert closure. Dependency-review CI reports that the repository's
Dependency Graph is unavailable; that is a repository configuration gate,
not an additional package finding. PostgreSQL/Keycloak image gates fail on the
documented upstream findings. Main protection still requires explicit approval.
Keep the PR draft and do not bypass failing checks to merge or host it.

---

# Historical result - branded local login and existing demo shortcut

Date: 2026-09-16. Scope: local login presentation and password-required access
to the existing fictional demo account, as selected by the user. No push,
deployment, real-user enrollment, fixture seed or existing fixture credential
reset performed. Generated signup-test identities may exercise their own
password-recovery flow; they are not existing user accounts.

## Implemented

- Inherited Keycloak 26.7.0 theme with forest/cream styling, local SVG branding,
  responsive controls and separate sample/local-account links. Upstream forms,
  password toggles, registration, verification and recovery remain inherited.
- Browser accessibility testing found upstream positive `tabindex` values.
  A small same-origin script restores DOM tab order, without reading credentials
  or modifying authentication actions. Four focused tests cover that script.
- A server-only helper offers `demo@autopayguard.local` as `login_hint` and
  requires `prompt=login`. Exact LOCAL mode and canonical app/issuer URLs are
  checked at render and submission. The existing password stays private and
  unchanged; the independent `/demo` still needs no login.
- A guarded operator command updates only the existing realm's `loginTheme`.
  Review found and fixed malformed-response/transport diagnostic leakage; tests
  cover redaction, canonical endpoint checks and minimal/idempotent updates.
- Runbook and ADR-021 explain account persistence, local-only boundaries and
  theme activation without broad user/password/fixture reconciliation.

## Fresh verification and local runtime

- 585 Vitest tests across 68 files, 315 Surefire tests, four raw-request tests,
  and 23 root script tests passed. Formatting, lint, TypeScript, generated
  contracts and the Next.js 16.3.3 production build passed.
- A fresh production dependency audit reported no known vulnerabilities.
- The 39 PostgreSQL Failsafe cases were skipped by the existing Docker
  availability guard: Rancher's Windows engine connection is unavailable.
  These are not fresh PostgreSQL integration passes.
- The normal image rebuild hit registry metadata timeouts. A pinned-cache
  retry also could not obtain build packages. For this local, dependency-
  unchanged UI update, the verified frontend build's `.next` application/static
  output was packaged into the existing patched Linux runtime image. No Windows
  `node_modules`, secrets or runtime configuration were copied. The previous
  image is retained as `autopay-guard-web:pre-branded-login`; this is not a claim
  that a clean network-backed image build or refreshed image scan passed.
- Only Keycloak and web were recreated/restarted, using Rancher's working
  internal WSL engine. Database and Mailpit volumes and existing identities were
  retained. The scoped theme update was verified without seed reconciliation.

- The new demo shortcut passed two real-provider browser cases across desktop
  and mobile: correct username hint, fresh login, state/PKCE/nonce, blank password
  before entry, normal existing-account authentication, protected profile read,
  sign-out and subsequent 401. No business records were changed by those cases.
- The other two new desktop/mobile cases passed branded login, invalid-login
  error, password visibility, registration and recovery rendering, zero serious/
  critical Axe findings, natural tab order and no horizontal overflow. A fresh
  script probe confirmed the accessibility asset loads successfully. Provider
  navigation polling was made resilient to local load while preserving exact
  origin/path assertions and excluding secret query strings from diagnostics.
  Clean desktop and mobile screenshots were visually reviewed.
- Existing portfolio regressions passed 6/6 (no skips) in 2.7 minutes:
  independent memory-only samples with exact add/edit/archive/reset totals;
  verified signup/password setup; private workspaces and cross-account denial;
  password recovery with old-password rejection and replacement-password login.
  All four generated fictional accounts completed application privacy deletion
  and exact Keycloak identity removal with no cleanup failures. Captured Mailpit
  messages and expected deletion/audit evidence remain as designed by that
  existing suite; no broader cleanup was performed.
- Together the targeted browser runs passed 10/10 across desktop and mobile.
  Authentication traces/videos are disabled. Only clean pre-credential page
  screenshots are used as visual evidence; raw provider URLs, error-context
  artifacts and credentials must not be published.
- All five local containers are healthy; homepage, sign-in, signup, isolated
  sample, API readiness and identity discovery respond successfully. The current
  web image is
  `sha256:cc3dc5b50b477944cc694ce644dcb29a9c729abebfd798c55440334ee897380d`.
- `make check` was attempted. The first restricted run hit a compiler-resource
  access error. The normal-access retry passed formatting/lint/types, 315
  Surefire tests, frontend tests/contracts/build and dependency auditing, but
  exited at the Git-aware secret step because the repository is owned by the
  sandbox identity. Its 39 guarded PostgreSQL cases were skipped, and its
  standard browser matrix was not reached. No full-gate pass is claimed.
- A separate source-only Gitleaks scan used a process-scoped exact-repository
  Git trust setting and native Windows copying. It examined 5.06 MB from 740
  Git-selected source files and found no leaks. A preliminary zero-byte scan
  under the excluded tools directory was rejected, not counted as evidence.
  No global Git trust setting or machine security policy was changed.

No production-readiness or independent security-assessment claim is made. Full
PostgreSQL acceptance, a clean network-backed image build and publication/remote
checks remain separate from this local UI verification.

# Historical result - portfolio accounts and isolated demo

Date: 2026-09-12. Status: local implementation, review and complete fake-data
acceptance passed. No deployment or real-user processing.

The approved slice adds a no-login memory-only sample workspace, verified
Keycloak registration, explicit consent-based app enrollment, private workspace
onboarding, provider-owned recovery, issuer-bound new accounts, local least-
privilege realm reconciliation, and desktop/mobile integration coverage.

Runbook: `docs/PORTFOLIO_ACCOUNTS_AND_DEMO.md`. Decision: ADR-020. Sanitized source
publication is authorized to `github.com/pratikmraut/autopay-guard`; Git history
and the checks attached to the actual commit are the publication/remote-CI
evidence. Earlier milestone results below are historical, not this candidate's
acceptance evidence.

### Issues found and addressed during rehearsal

- Real Keycloak forms and Next.js route announcers required correctly scoped
  browser locators and explicit navigation waits, without weakening assertions.
- The live recovery test now clears cookies and proves that the previous
  password fails, the replacement succeeds, and private data is preserved.
- V7's email uniqueness exposed an older notification test fixture that reused
  an email for multiple distinct users. Fixtures now use UUID-derived fictional
  emails; the constraint was not relaxed.
- A repeated PostgreSQL run exposed a reminder-generation race: a candidate
  query could acquire row locks after another transaction committed while still
  returning an older anti-join result. Generation now rechecks the semantic key
  under those locks with a fresh READ_COMMITTED snapshot. A deterministic stale-
  candidate replay reproduced the original uniqueness failure before the fix;
  the notification, delivery and outbox remain one atomic transaction.
- Disabling new local registration now preserves existing USER authority and
  recovery, but cannot silently provision an unconsented ordinary identity.
- Enrollment and privacy deletion share a first database lock to prevent a
  concurrent deletion from being undone by registration. Real PostgreSQL tests
  cover this interleaving and concurrent duplicate enrollment.
- The restore drill now inventories all 53 V7 tables and checks the enrollment
  singleton. Normal and deliberately failed restore drills both cleaned up their
  disposable databases and temporary dumps, leaving the canonical data intact.
- Source secret scanning now fails closed when Git cannot inspect the repository
  instead of risking an empty source selection on Windows ownership errors.
- Publication-time dependency auditing identified new upstream advisories.
  Next.js and its ESLint configuration are now 16.3.3, nanoid is pinned at
  3.3.18, and sharp at 0.35.4. Frozen installation and a fresh production audit
  passed with no known vulnerabilities; the running web image reports 16.3.3.
- The refreshed September 11 vulnerability database also identified Tomcat
  advisories. The embedded server is pinned to the fixed 11.0.25 patch without
  changing Spring Boot's major version. Node is pinned to 22.23.2, and the fresh
  web runtime contains OpenSSL packages 3.5.8-r0. The global Windows Node
  installation was not changed; the launcher can use the ignored portable
  project-local runtime.
- Public CI no longer uploads authentication browser diagnostics. The signup
  and recovery rehearsal also disables retry traces; generated credentials and
  action links must not become public test artifacts.

### GitHub configuration note

Read-only inspection of earlier public checks found that Dependency review
cannot run while the repository's Dependency graph is disabled or unsupported.
That PR-only configuration issue is not a dependency scan result, and no
repository setting was changed or security gate suppressed. Earlier CodeQL
successes are historical; the new source must be judged by its own checks.

### Verification evidence

- Patched backend: 315 Surefire tests and 39 real-PostgreSQL Failsafe tests
  passed, with zero failures, errors or skips. The notification concurrency
  methods also passed a separate focused repeat after the full affected class.
- Patched Node 22.23.2 toolchain: 564 Vitest tests across 66 files, four raw-
  request-gate tests and nine local-policy/restore-inventory tests passed.
  Formatting, lint, strict types, contract-generation checks, frozen install and
  the Next.js 16.3.3 production build passed. Production dependency audit found
  no known vulnerabilities.
- September 11 Trivy vulnerability, Java and configuration-check data produced
  zero HIGH/CRITICAL findings in the source-only repository snapshot and both
  final application images. This is a scoped automated scan, not an independent
  penetration test or a production security approval.
- Final API image: `sha256:7656e745efb7dda49d7f54bbd95e90ec8122e4ebed8078cc7f5feec6a4e3b0b2`.
  Final web image: `sha256:caebd718fc572d47930711ada8bedbddd330e6dc336bbd9dd8899df7ed473b3c`.
- The mobile demo and desktop signup screens were visually inspected; local-
  only boundaries and working sample controls remain visible and readable.
- The complete post-patch `.\make.ps1 check` exited 0. Gitleaks found no leaks;
  Playwright passed 30 desktop/mobile cases in 9.4 minutes. Six existing guarded
  M5/M6 live cases were intentionally skipped in the standard matrix; they are
  not claimed as rerun or passed here. Both new signup/recovery cases and all
  four isolated-demo cases ran and passed, with accessibility and isolation
  assertions intact.
- New-account journeys used only generated fictional local identities and
  Mailpit messages. They verified explicit enrollment, private workspace
  isolation, old-password denial, replacement-password login, retained account
  data and cleanup through the actual privacy workflow. No real email was sent.

## Historical result - PB-G04A/PB-G06 preliminary local hardening (2026-08-09)

Status: **bounded fake-data-only implementation and rehearsal passed;
PB-G04A and PB-G06 remain BLOCKED; Private Beta execution is NO-GO**

- Date: 2026-08-09
- Canonical workspace: private local development workspace
- Delivery workspace: private local verification workspace

## Authorization used

The user approved PB-G00 and explicitly directed work to start PB-G04A/PB-G06
inside the already authorized fake-data-only Private Beta readiness
implementation/rehearsal phase. No real user/data, vendor, domain, external
identity system, shared/cloud/staging/production resource, deployment, commit,
remote or push was used.

## Outcome

The bounded provider-independent slice now fails closed on important identity
and production-configuration drift:

- API production startup rejects mixed profiles, implicit provisioning,
  disabled verified-email enforcement, insecure identity/JWK destinations,
  wrong audience/authorized party, extra outbound origins, development email/
  probes/docs, excess management/error/schema behavior, Flyway clean and shared
  configured database usernames. The check is registered before application-
  context auto-configuration when `prod` is explicitly active.
- Existing users retain their immutable local subject and provisioned email;
  unexpected email changes, tombstoned subjects and unknown production
  subjects are rejected. Only the display name may synchronize.
- API and web accept exactly one allowlisted API-client role. Tokens also
  require the exact API audience and web-client `azp`; role drift grants no app
  authority.
- The fake-local Keycloak fixture and live reconciliation reject public
  registration, unsafe grants/callbacks/origins, external identity providers
  and unexpected API-client role mappings.
- Web production mode requires exact HTTPS destinations, client identity,
  declared outbound origins and disabled host trust; it applies HSTS and
  rejects redirects on web-owned outbound requests.
- Anonymous API access is limited to exact aggregate health, liveness and
  readiness paths. Web route inventory proves the authenticated page layout
  calls the session guard and contains no route handlers.

## Verification

| Check                  | Result                                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent review     | Final security review found no P0/P1 code defect or compile blocker and confirmed the remaining items are external/human blockers.                                                                                        |
| Focused API            | 45/45 production-guard, JWT audience/authorized-party/role, user-reconciliation, realm-fixture and endpoint-inventory tests passed.                                                                                       |
| Focused web            | 39/39 role, environment, HSTS, redirect and route-inventory tests passed; TypeScript, targeted ESLint and Prettier passed.                                                                                                |
| Fake stack and seed    | API/web images rebuilt; eight reserved identities, five exact roles, four commitments, reminder settings, 20 fictional guides and zero import residue were reconciled and verified.                                       |
| Complete quality suite | Delivery `make check` exited 0 in 819.2 seconds: Surefire 301/301, Failsafe 29/29, raw-request gate 4/4 and Vitest 488/488 passed; format, lint, type, contracts, production build, dependency audit and Gitleaks passed. |
| Browser matrix         | Playwright recorded 24 desktop/mobile passes and six documented guarded skips against the running fake-local stack.                                                                                                       |
| Synchronization        | Git-ignore-aware comparison covered 693 canonical/delivery source files with zero missing, extra or hash-mismatched files.                                                                                                |

## Gate result

| Gate         | Result                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| PB-G04A      | `BLOCKED`; local controls are PRELIMINARY/PARTIAL only.                                                       |
| PB-G06       | `BLOCKED`; local controls are PRELIMINARY/PARTIAL only.                                                       |
| PB-G05       | `BLOCKED`; CodeQL, immutable candidate and accountable security review are absent despite clean local checks. |
| PB-G01A      | `PASS`; 693 source files match across canonical and delivery workspaces.                                      |
| Private Beta | `NO-GO`; execution was neither requested nor authorized.                                                      |

## Remaining blockers

PB-G04A still needs issuer-aware `(iss, sub)` storage and migration, reversible
disablement, live session/token revocation, staff MFA, recovery, break-glass,
offboarding, an approved real IdP and named identity/security/operations owners.

PB-G06 still needs deployment-level mode/profile pinning, network-enforced
egress and framework redirect/DNS evidence, actual database grants/object
owners, an isolated migration credential, and an approved India-region TLS/
ingress/edge/WAF/private-network/secrets/KMS/backup/cost design with named
owners. Different configured usernames alone are not proof of least privilege.

## Preserved boundaries and stop condition

No real identities, financial records, messages, credentials, merchant targets
or outbound email were used. The test host strings were never resolved or
contacted. No payment, mandate, bank/card/UPI/Account Aggregator/SMS/inbox action
exists. No commit or push was part of this bounded rehearsal; public source
publication was authorized separately afterward and does not change the gate
verdict.

Stop now for human review of this bounded preliminary result. Do not configure
an external IdP/domain/vendor, create infrastructure, change external network or
database grants, deploy, recruit/invite anyone, or process real data without a
separate explicit authorization.
