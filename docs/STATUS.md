# Project status

Last updated: 2026-08-09

## Current phase

Milestones 1 through 6 are human-approved. Milestone 6 - controlled CSV import
and hardening - was explicitly authorized on 2026-07-29, completed its bounded
local automated fake-data acceptance, and was explicitly approved and closed
by the user on 2026-08-04.

The approved M1-M6 delivered boundary now includes an owner-only controlled CSV
template, upload, normalized preview, explicit row selection and confirmation
flow. Raw CSV is processed only in bounded request memory and is not committed
to storage; unconfirmed normalized previews expire within 24 hours.

The user authorized **fake-data-only Private Beta readiness implementation and
rehearsal** on 2026-08-09, with no real users, real data, vendors, or production
deployment. This is not Milestone 7. Private Beta is not ready, operational, or
authorized.

## Private Beta readiness implementation and rehearsal

The planning pack now defines:

- the three separate states of planning complete, beta ready and beta
  authorized;
- a proposed maximum 50-adult cohort and staged pause points, without names or
  invitations;
- unassigned accountable roles and daily operations/shutdown proposals;
- fictional-vs-real guide freshness decision and fail-closed workflow;
- a risk register including the unresolved CodeQL/environment/data/ownership
  blockers;
- an unapproved privacy-minimized data/metric purpose map; and
- an execution readiness matrix whose live gates remain blocked.
- the bounded fake-data-only implementation/rehearsal authorization recorded in
  ADR-018; and
- PB-G00 closure with deterministic test time, a remediated dependency advisory,
  and a clean complete delivery gate; and
- ADR-019's bounded PB-G04A/PB-G06 identity and production-configuration
  rejection controls, explicitly classified as PRELIMINARY/PARTIAL.

Local source/test/document changes and seeded rehearsals are authorized. On
2026-08-09 the user separately authorized sanitized public source publication
to `github.com/pratikmraut/autopay-guard` and the resulting external security/
quality workflows. This does not authorize a hosted application, shared/cloud/
production infrastructure, vendors, real identity/email/guides/data,
invitations, or deployment.

## Milestone 6 delivered

- Additive V6 import-job and normalized-item schema with no inferred imports.
- Exact UTF-8, header, extension, MIME, size, row, field, formula-injection,
  money, date, recurrence, category, and payment-rail validation.
- Deterministic in-file and existing-commitment duplicate warnings plus exact
  merchant-alias matching.
- Transactional confirmation of explicitly selected valid rows as private
  `CSV` commitments, with ETags, idempotency, bounded rate limits, rollback,
  stale-write handling, audit, privacy export/deletion, and deterministic
  cleanup.
- Strict multipart BFF allowlisting and a responsive, keyboard-operable
  `/imports` flow with desktop/mobile real-OIDC coverage.
- CSP and cross-origin hardening, accessibility touch-target remediation,
  malicious-corpus coverage, threat-model and retention documentation,
  bounded load evidence, local image/repository security scans, SBOMs, and a
  disposable-database backup/restore exercise.
- All earlier milestone behavior and fake-local safety boundaries remain in
  scope and passed regression coverage.

## Current PB-G00 validation

- Code review confirmed production recurrence semantics are correct: preserve
  history and generate upcoming occurrences from household-local today through
  the 90-day horizon.
- `CommitmentApiIntegrationTest` now imports a class-scoped fixed UTC clock and
  derives its local dates from the same instant. The previously failing method
  and the full four-test class passed in the delivery workspace.
- The first complete rerun found a newly published HIGH `nanoid` advisory via
  Next/PostCSS. It was not suppressed: the workspace override and lockfile now
  require 3.3.17, frozen installation succeeded, and the final production
  dependency audit reported no known vulnerabilities.
- The complete delivery `make check` passed with exit code 0 in 756 seconds:
  262 Surefire tests, 29 Failsafe real-PostgreSQL tests, 455 Vitest tests,
  format/lint/type/contracts/build, Gitleaks, and 24 Playwright passes with six
  documented guarded skips all completed successfully.
- Final Git-ignore-aware canonical/delivery parity covered 675 source files
  with zero missing, extra, or hash-mismatched files.
- PB-G00 is `PASS`. CodeQL and the other human/external readiness gates remain
  blocked; this local result is not production or Private Beta evidence.

## Current PB-G04A/PB-G06 preliminary validation

- Production identity now fails closed when the explicit `prod` profile is
  mixed with another profile, implicit provisioning is enabled, or verified-
  email enforcement is disabled. Existing subjects cannot silently change
  their provisioned email; display-name updates and deletion tombstones remain
  supported.
- API and web authorization require exactly one allowlisted API-client role.
  Token validation also pins the API audience and authorized web client. Static
  and live-local realm checks reject public registration, unsafe grants,
  callback/origin drift and unexpected role mappings.
- API production configuration is checked before application-context auto-
  configuration for disabled external email/probes/docs, exact HTTPS origins,
  bounded health/error/schema settings and distinct configured database
  usernames. Web production mode requires exact HTTPS origins/client identity,
  rejects trusted-host mode, applies HSTS and refuses redirects on web-owned
  outbound requests.
- Anonymous API access is limited to exact aggregate health, liveness and
  readiness paths. Web route inventory keeps authenticated pages under the
  session-requiring layout and rejects route handlers inside that group.
- Independent focused verification passed 45 API tests and 39 web tests, plus
  TypeScript, targeted lint/format, Keycloak-validator syntax and realm JSON
  checks.
- The rebuilt fake-local stack and deterministic seed passed. The complete
  synchronized delivery `make check` then exited 0 in 819.2 seconds: 301
  Surefire tests, 29 Failsafe real-PostgreSQL tests, four raw-request-gate tests,
  488 Vitest tests, format/lint/type/contracts/build, the production dependency
  audit, Gitleaks, and 24 Playwright passes with six guarded skips all passed.
- Final Git-ignore-aware canonical/delivery parity covered 693 source files with
  zero missing, extra, or hash-mismatched files.
- PB-G04A and PB-G06 remain `BLOCKED`. Missing evidence includes `(iss, sub)`
  identity storage/migration, reversible disable/session revocation/MFA/
  recovery/break-glass/offboarding, deployment mode pinning, network egress,
  database grants/object ownership and migration-credential isolation, plus an
  approved India-region TLS/edge/private-network/secrets/KMS/backup/cost model
  with named owners.

## Milestone 6 historical automated evidence

- The complete delivery `.\make.ps1 check` passed with exit code 0 in 747.2
  seconds, including format, lint, strict type, Maven verification,
  contract-generation, production build, dependency/secret scans,
  unit/integration tests, and the standard browser matrix.
- After explicit authorization for dependency-inventory egress,
  `pnpm audit --prod --audit-level=high` reported no known vulnerabilities.
- Backend: 54 Surefire XML suites / 262 tests and 2 Failsafe suites / 29
  real-PostgreSQL tests passed with zero failures, errors, or skips.
- Web: 4 raw-request-gate tests plus 455 Vitest tests passed.
- Standard Playwright: 24 applicable desktop/mobile cases passed; 6 guarded
  live cases were intentionally skipped in that matrix.
- Guarded M6 acceptance: the API/database live gate passed and the dedicated
  real-OIDC UI gate passed 2/2 across desktop and mobile Chromium.
- Bounded load P95 was 339.8 ms for reads and 45.2 ms for writes, both below
  the 400 ms gate.
- Restore exercised 52 tables in the normal and canary paths; the dump digest
  begins `6394f420`.
- A fresh vulnerability database initially detected image runtime CVEs. The
  affected dependencies/images were remediated and rebuilt; final Trivy
  repository and image results contain zero HIGH/CRITICAL vulnerabilities,
  misconfigurations, or secrets. CycloneDX SBOMs contain 190 API components
  and 40 web components.
- Pinned Gitleaks scanned the final source and found no leaks.
- Canonical and private local delivery source matched across 669 compared
  files.

## Post-Milestone 6 boundaries

1. The absence of CodeQL was accepted only for the historical local M6 gate on
   2026-08-04. Public source publication and remote CodeQL were authorized on
   2026-08-09; no CodeQL pass may be claimed until the first remote workflow
   completes and its results are reviewed.
2. Fake-data-only Private Beta readiness implementation and rehearsal are
   authorized. External setup, vendors, real users/data, deployment, and beta
   execution each require later explicit authority. No participant may be
   identified or invited.

## Environment and guardrails

- Canonical and delivery workspaces were private local verification copies.
- All acceptance used fake local identities, fictional merchants, and seeded
  local data. No real financial data was imported.
- Public source publication is authorized; no website deployment or real-user
  account provisioning has occurred.
- There is no payment movement, mandate revocation, bank/payment connection,
  real email, provider contact, cloud storage, production deployment,
  legal-compliance claim, or automated financial advice.
