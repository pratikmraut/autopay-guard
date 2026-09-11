# Codex result - portfolio accounts and isolated demo

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
