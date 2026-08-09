# Private Beta readiness gate

Status: **fake-data-only readiness implementation/rehearsal and sanitized public
source publication were authorized on 2026-08-09. Private Beta execution is
NO-GO.** Local source/test changes, seeded rehearsals, the public Git repository
and repository-triggered CI are allowed. No real users/data, hosted application,
shared/cloud/production environment, vendor, real email, or deployment is
authorized.

## State model

- `PASS`: evidence exists, is current, and has the required accountable human
  sign-off.
- `DEFINED`: the planning requirement is documented but execution evidence does
  not exist.
- `BLOCKED`: evidence, authority, or accountable ownership is missing.
- `NOT APPLICABLE`: allowed only with a written scope reason and approval; it is
  never a synonym for skipped.

PB-G02 through PB-G12 must be `PASS` before a Private Beta go/no-go request.
PB-G13 records the later authorization decision; no invitation or real-data
processing may begin until it also passes.

## Current gate matrix

| Gate    | Requirement              | Required evidence                                                                                                                                                                                                                                                       | Current status                                           |
| ------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| PB-G00  | Current M1-M6 baseline   | Historical human approval plus synchronized source and a fresh complete repository quality run with zero unexplained failures                                                                                                                                           | PASS on 2026-08-09                                       |
| PB-G01  | Planning authority       | Explicit planning instruction and preserved exclusions                                                                                                                                                                                                                  | PASS as of 2026-08-09                                    |
| PB-G01A | Source parity            | Current Git-ignore-aware canonical/delivery source comparison after all phase edits                                                                                                                                                                                     | PASS: 693 files, zero differences on 2026-08-09          |
| PB-G01B | Implementation authority | Explicit fake-data-only implementation/rehearsal instruction and preserved exclusions                                                                                                                                                                                   | PASS as of 2026-08-09                                    |
| PB-G02  | Charter and cohort       | Approved scope, feature allowlist, 18+ policy, cohort cap, staged pause and shutdown rules                                                                                                                                                                              | DEFINED; human approval pending                          |
| PB-G03  | Accountable ownership    | Named product, engineering, security, privacy, operations, support, data, and guide owners                                                                                                                                                                              | BLOCKED; all unassigned                                  |
| PB-G04  | Source/release control   | Authorized repository, immutable commit/digests, protected main, reviewed pinned CI, rollback identifier                                                                                                                                                                | BLOCKED; public source push authorized, evidence pending |
| PB-G04A | Invite-only identity     | Closed provisioning/deprovisioning, public-registration and dev-auto-provisioning rejection, immutable subject binding, staff MFA/role review, recovery, session revocation, break-glass and offboarding tests                                                          | BLOCKED; local controls PRELIMINARY/PARTIAL              |
| PB-G05  | Security closure         | CodeQL Java and JS/TS, fresh dependency/secret/repository/image scans, authorization tests, risk review with no unresolved high-risk issue                                                                                                                              | BLOCKED; local audit clean, CodeQL/owner absent          |
| PB-G06  | Environment design       | Approved India-region architecture, public ingress/origin/trusted-proxy/exposed-endpoint and edge abuse/rate controls, outbound egress allowlist, TLS/HSTS, private data plane, managed secrets/keys, encryption, role separation, feature rejection and cost authority | BLOCKED; local controls PRELIMINARY/PARTIAL              |
| PB-G07  | Privacy/legal/data       | Purpose map, participant notice/consent, retention, export/correction/deletion/offboarding, backup and IdP treatment, vendor review, counsel decision                                                                                                                   | BLOCKED; real-data basis is unapproved                   |
| PB-G08  | Guide mode/freshness     | Approved mode: disabled surfaces with UI/route/metric-exclusion proof; or isolated fictional training with the same exclusions; or separately authorized real catalog with reviewers, sources, expiry, monitoring, unsafe escalation and kill switch                    | BLOCKED; mode and evidence unapproved                    |
| PB-G09  | Operations/support       | Service hours, RACI, daily review, dashboards/alerts, severity matrix, incident/support/rollback/restore runbooks                                                                                                                                                       | BLOCKED; owners and production model absent              |
| PB-G10  | Feedback/measurement     | Approved first-party event inventory, minimization, access/retention, metric queries and feedback process                                                                                                                                                               | BLOCKED; not implemented or approved                     |
| PB-G11  | Candidate rehearsal      | Seeded non-real-data rehearsal of access, migration, rollback, restore, incident, support and capacity paths                                                                                                                                                            | DEFINED; local pre-rehearsal authorized, not run         |
| PB-G12  | Evidence review          | Indexed candidate evidence signed by product, engineering, security, privacy and operations                                                                                                                                                                             | BLOCKED; no candidate exists                             |
| PB-G13  | Beta execution decision  | Explicit human approval naming candidate, environment, cohort cap and time window                                                                                                                                                                                       | BLOCKED; not requested                                   |

## PB-G00 closure evidence

The failure was a test-clock defect, not a production recurrence defect.
Production continues to use the injected clock and household timezone, preserve
historical occurrences, and regenerate only from household-local today through
the 90-day horizon. `CommitmentApiIntegrationTest` now imports a class-scoped
fixed UTC clock and derives its local test date from that same instant. The
previously failing method passed 1/1 and the full integration class passed 4/4
in the delivery workspace.

The complete delivery quality gate then passed with exit code 0 in 756 seconds:
262 Surefire tests and 29 Failsafe real-PostgreSQL tests passed with no failure,
error, or skip; 455 Vitest tests passed; format, lint, strict type, contracts,
and the production build passed; Gitleaks found no leak; and Playwright recorded
24 desktop/mobile passes with six documented guarded skips. A newly published
HIGH `nanoid` advisory was not suppressed: the workspace override and lockfile
were raised to 3.3.17, frozen installation succeeded, and the final production
dependency audit reported no known vulnerabilities.

## Security evidence rule

The accepted M6 local evidence may be referenced as historical regression
evidence, but it cannot satisfy environment, capacity, recovery, or live-beta
gates. CodeQL remains deferred rather than passed. A high/critical result must
be fixed or determined non-applicable through specific written evidence and
human review; a silent ignore, severity downgrade, expired exception, or generic
risk acceptance fails PB-G05.

## PB-G04A/PB-G06 preliminary local controls

ADR-019 records a bounded provider-independent hardening slice. It is
PRELIMINARY/PARTIAL local evidence, not candidate or environment evidence.

The identity slice rejects production startup with development profiles,
implicit provisioning, or disabled verified-email enforcement. It requires an
exact verified-email claim, preserves immutable subject binding and deletion
tombstones, pins the provisioned email while allowing display-name updates,
accepts exactly one allowlisted API-client role in both API and web, and makes
the local realm fixture/reconciliation fail on public registration, permissive
recovery/account flags, external identity providers, unsafe client
configuration, or unexpected role mappings.

PB-G04A remains `BLOCKED`: storage and migration for an explicit `(iss, sub)`
identity key, reversible disablement, live session/token revocation, staff MFA,
recovery, break-glass, offboarding, a real approved IdP, and named accountable
owners do not exist.

When explicitly selected, the environment slice validates API/web production
modes and profiles, requires non-local HTTPS destinations and exact declared
origins, disables unapproved forwarded/trusted-host behavior and development
surfaces, fails web-owned dependency fetches on redirects, limits management/
error/schema behavior, and requires distinct configured runtime and Flyway
usernames.

PB-G06 remains `BLOCKED`: application declarations are not a network egress
policy, and framework/dependency-managed redirect behavior still needs
environment evidence. Database grants and object/schema owners are not proven,
and the API process still receives the Flyway credential. An approved
deployment manifest/entrypoint must pin production mode because an omitted or
misspelled API profile does not activate a profile-scoped guard. No India-region
architecture, TLS/HSTS/edge/WAF/private-network design, managed secrets/KMS,
backup model, cost authority, real host, or human owner is approved. Host
strings used in pure tests are never resolved or contacted.

The rebuilt fake-local stack and deterministic seed passed with eight reserved
identities, five exact API-client roles, four commitments, explicit reminder
settings, 20 fictional guides and zero import residue. The complete synchronized
delivery gate passed in 819.2 seconds: 301 Surefire and 29 Failsafe tests, four
raw-request-gate tests and 488 Vitest tests, format/lint/type/contracts/build,
the production dependency audit and Gitleaks all passed; Playwright recorded 24
desktop/mobile passes and six documented guarded skips. Git-ignore-aware parity
then covered 693 canonical/delivery source files with zero differences.

## Authorized local work and future candidate checks

The fake-data-only phase may implement and rehearse provider-independent local
controls. A future candidate still must record at minimum:

- immutable source commit and API/web image digests;
- required CI results, including CodeQL Java and JavaScript/TypeScript;
- dependency, license, secret, repository, image, and SBOM evidence;
- migration from the accepted prior release and rollback/forward-fix decision;
- closed-enrollment identity provisioning, staff MFA/roles, recovery/session/
  break-glass and offboarding tests with public registration/dev reconciliation
  rejected;
- cross-household, staff-role, support-code, privacy and import authorization
  matrices;
- exact public endpoint inventory, origin/trusted-proxy behavior, edge abuse/
  rate controls, outbound egress allowlist, TLS/security headers and
  development-feature rejection checks;
- bounded capacity results against a declared beta load model;
- backup/restore evidence against declared RPO/RTO hypotheses;
- seeded incident, guide-disable, invitation-pause, notification-failure and
  participant-offboarding rehearsals; and
- zero real credentials, messages, financial records, or participant details in
  test artifacts and logs.

## Go/no-go record template

| Field                          | Required value |
| ------------------------------ | -------------- |
| Candidate commit/images        | Unassigned     |
| Environment and region         | Unassigned     |
| Cohort cap and dates           | Unassigned     |
| Product owner decision         | Unassigned     |
| Engineering owner decision     | Unassigned     |
| Security owner decision        | Unassigned     |
| Privacy/counsel decision       | Unassigned     |
| Operations/support decision    | Unassigned     |
| Open high/critical risks       | Must be zero   |
| Final human beta authorization | Not granted    |

## Stop condition

PB-G00 is complete and the PB-G04A/PB-G06 preliminary local rehearsal is ready
for human review, but the matrix does not establish beta readiness. Stop before
external setup, vendors, real identity/data, deployment, or operations. No
participant may be named, invited, or onboarded until PB-G02 through PB-G13 are
all `PASS` and a final explicit human decision is recorded.
