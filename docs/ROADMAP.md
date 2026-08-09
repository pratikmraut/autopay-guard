# Delivery roadmap

The milestone sequence is intentionally gated. Finishing one milestone does not
authorize the next.

## Milestone 1 - Foundation (completed and human-approved)

- Monorepo and pinned toolchains.
- Local PostgreSQL, Keycloak, and Mailpit.
- OIDC BFF sign-in and authenticated API.
- Local user mapping and users/households schema.
- `GET /v1/me` and minimal owned-household APIs.
- Responsive onboarding and empty dashboard.
- OpenAPI client, health endpoints, baseline tests, CI, and security checks.

Gate passed: bootstrap, stack, seed, full checks, fake sign-in, onboarding,
owned empty dashboard, sign-out, auth/ownership, secrets, and reproducibility
were reviewed. The human approved Milestone 1 on 2026-07-26.

## Milestone 2 - Commitments, recurrence, and dashboard (completed and human-approved)

- Create, read, update, and archive recurring commitments.
- Deterministic recurrence and 90-day occurrence generation.
- Monthly/annualized spend summaries and upcoming calendar.
- Category-safe actions, source/confidence/visibility, and merchant search.
- Month-end, leap-year, timezone, and cross-household authorization tests.

Automated gate passed on 2026-07-26: the additive V1-to-V2 and empty migrations,
recurrence/concurrency/ownership suites, exact seeded summaries, generated
contract, production build, and real-OIDC desktop/mobile accessibility journeys
all passed. The user then delegated the remaining browser gate to Codex and
authorized Milestone 3. The real local UI passed create/edit, true two-tab stale
conflict and latest-version reload, archive cleanup, seeded list/calendar and
summary reconciliation, restricted-category guidance, sign-out, and protected
route checks.

## Milestone 3 - Reminders and notifications (completed and human-approved)

Reminder rules, transactional outbox, email/in-app delivery, retry,
deduplication, preferences, quiet hours, diagnostics, and reconciliation.
The user explicitly asked Codex to complete testing autonomously and proceed
with all Milestone 3 coding. The additive V3 migration, APIs, scheduler/outbox,
fake-local delivery, UI, contracts, 96 backend tests, 137 web tests, four
real-OIDC browser journeys, and guarded Mailpit/outage/quiet-hour live
acceptance passed on 2026-07-27. The user explicitly approved Milestone 3 and
authorized Milestone 4 on 2026-07-27.

## Milestone 4 - Cancellation OS and savings (completed and human-approved)

Versioned two-track guides, safe allowlisted links, attempts, verification,
potential/self-reported/verified/reversed savings, renewal decisions, and guide
feedback. The bounded implementation uses fictional local guides and
user-attested outcomes. Admin guide operations and binary evidence remain
deferred to their later approved scope. Autonomous acceptance passed on
2026-07-27: the additive V4 migration, 20 fictional guides, owner-scoped APIs,
strict BFF/UI, 131 backend tests, 227 web tests, six real-OIDC desktop/mobile
browser journeys, guarded fake-local live reconciliation, responsive review,
and independent read-only audits all passed. The user explicitly approved
Milestone 4 and separately authorized Milestone 5 on 2026-07-27.

## Milestone 5 - Household, privacy, and admin (completed and human-approved)

Invitations and visibility, consent records, export/deletion workflows, admin
guide operations, audit trails, and redacted support diagnostics.

Status: bounded fake-local implementation and autonomous acceptance passed on
2026-07-29. Additive V5 migrations, exact household/sharing authority, consent
and privacy workflows, fictional-guide administration, redacted audit/support,
191 backend tests, 406 web tests, guarded live reconciliation, desktop/mobile
real-OIDC acceptance, production build, contract, secret, seed, cleanup, and
health gates passed. The user explicitly approved Milestone 5 and separately
authorized Milestone 6 on 2026-07-29.

## Milestone 6 - CSV import and hardening (completed and human-approved)

Template, validation, preview, confirmation, zero persisted raw CSV,
accessibility remediation, threat-model update, load/resilience testing, and
backup/restore exercise.

Status: explicitly authorized on 2026-07-29. The bounded implementation and
local automated fake-data acceptance are complete: controlled CSV
template/upload/preview/selection/confirmation, deterministic duplicate
warnings, request-memory-only raw processing, 24-hour maximum preview
availability, accessibility/security remediation, local load/resilience
evidence, threat-model updates, and a non-destructive backup/restore drill.

On 2026-08-04 the user authorized dependency-inventory egress; the production
dependency audit reported no known vulnerabilities, and the complete delivery
`.\make.ps1 check` passed. External CodeQL remains unavailable because the
repository has no commit or remote and no local CodeQL installation or
commit/push authorization. The user accepted that documented deferral; no
CodeQL pass is claimed. The user explicitly approved and closed Milestone 6 on
2026-08-04. Private-beta or later scope remains separately gated and is not
authorized by this approval.

## Private Beta readiness implementation and rehearsal (fake-only authorized; execution NO-GO)

The user authorized bounded fake-data-only implementation and rehearsal on
2026-08-09, explicitly excluding real users, production deployment, vendors,
and real data. The planning pack defines a proposed cohort, accountable
ownership, operating model, guide freshness, privacy-minimized measurement,
data handling, security risks, candidate evidence and a final go/no-go matrix.

PB-G00 passed on 2026-08-09 after the stale integration fixture received a
fixed test clock, the newly disclosed HIGH transitive `nanoid` advisory was
remediated at 3.3.17, and the complete delivery quality gate passed. Bounded
PB-G04A/PB-G06 work then added provider-independent local identity, role,
configuration, endpoint, redirect, HSTS and development-feature rejection
controls. That result is PRELIMINARY/PARTIAL: both gates remain blocked by
provider lifecycle, accountable ownership and external environment evidence.
Bounded local controls and seeded rehearsals may continue. On 2026-08-09 the
user separately authorized sanitized public source publication and its remote
security/quality workflows. Cloud/staging/production resources, a hosted
website, vendors, real email, real merchant guides, recruitment, invitations,
and real data remain unauthorized. All Private Beta execution gates remain
separately evidenced and explicitly approved.

## Private and public beta gates

Private beta requires invited adults, operational ownership, guide freshness,
and no unresolved high-risk security issue. Public beta additionally requires
specialist Indian legal review, approved notices/terms/retention, an independent
penetration test, incident-response exercise, tested restore, authenticated
email delivery, and explicit human production approval.
