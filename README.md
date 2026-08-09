# AutoPay Guard

AutoPay Guard is an India-first, privacy-minimizing control center for recurring
commitments. It helps adults see upcoming debits, record a decision, follow
versioned cancellation guidance, separately track merchant-service cancellation
and payment-mandate revocation, and verify the outcome.

> **Trust promise:** We never ask for your UPI PIN, bank password, OTP, or full
> payment credentials.

The working name is not a final brand. Milestones 1 through 6 are
human-approved; Milestone 6 closed on 2026-08-04. A fake-data-only **Private
Beta Readiness Implementation and Rehearsal** phase was authorized on
2026-08-09. PB-G00 passes, and PB-G04A/PB-G06 now have bounded local
fail-closed controls. Both remain `BLOCKED`: the evidence is preliminary and
does not authorize real users, real data, vendors, production deployment, or
Private Beta execution.

## Product boundary

This MVP is not a payment app, Account Aggregator, bank connector, or financial
adviser. It cannot move money or directly revoke a mandate. It uses fake local
data only and deliberately excludes SMS access, Gmail access, live financial
data, production credentials, and cloud deployment.

## Public source status

This repository is publicly viewable for security review and evaluation. It is
source publication only: no hosted service, public signup, production identity
provider, or real-data processing is authorized by making the code public.

No open-source license has been granted yet. Repository visibility alone does
not grant permission to copy, modify, or redistribute the code; reuse terms
remain a separate human decision. See [`SECURITY.md`](SECURITY.md) before
reporting a vulnerability and [`CONTRIBUTING.md`](CONTRIBUTING.md) before
proposing a change.

## Repository layout

```text
apps/web               Next.js web application and OIDC BFF
services/api           Spring Boot modular-monolith API
packages/contracts     generated TypeScript OpenAPI client
infra/local            local Keycloak configuration and seed helpers
infra/terraform        documented placeholder; no cloud resources
docs                    product, architecture, security, compliance, and ADRs
scripts                 reproducible developer helpers
```

## Prerequisites

- Java 21
- Node.js 22 (an active supported Node release)
- pnpm 11.9
- Docker Desktop with Docker Compose v2
- GNU Make
- Git Bash on Windows for shell scripts

No global Maven installation is needed; the API uses Maven Wrapper.

## Local setup

Do not copy the public placeholder values from `.env.example`. `make bootstrap`
creates `.env` with random local-only secrets and rejects a pre-existing file
that still contains known placeholders. Never commit `.env`.

```bash
make bootstrap
make up
make seed
make check
```

On Windows PowerShell, if `make` is not installed or Git Bash is not selected,
use the repository wrapper instead:

```powershell
.\make.ps1 bootstrap
.\make.ps1 up
.\make.ps1 seed
.\make.ps1 check
```

The wrapper uses a project-local Java 21 and GNU Make installation under the
ignored `.tools` directory when present. It also selects Git Bash, Docker
Desktop, Node, and pnpm through Corepack without changing the global user PATH.

The local services are:

- web: <http://localhost:3000>
- API: <http://localhost:8080>
- Swagger UI: <http://localhost:8080/swagger-ui.html>
- Keycloak: <http://localhost:8081>
- Mailpit: <http://localhost:8025>

Use `make dev` instead of `make up` when you want API and web hot reload; it
starts only the three infrastructure services in Compose, then launches the API
and web on the host. `make down` stops containers. `make reset` is the explicit
destructive command: it visibly names and removes only this Compose project's
local database and captured-email volumes.

## Fake sign-in

The imported development realm contains a fake adult user. Its username and
password are supplied by local environment variables during seeding and are
never suitable for a shared or production environment. `make seed` signs in
through the normal local authorization-code flow, preserves the earliest owned
fake household, creates the reserved commitments from
`infra/local/fixtures/milestone2.json`, and explicitly saves the fake-local
preferences and reminder rules from `infra/local/fixtures/milestone3.json`.
It then reads `infra/local/fixtures/milestone4.json` and verifies the
migration-backed fictional guides plus the authenticated decision and savings
read surfaces without creating a decision, attempt, feedback, or savings
record. Finally, it reconciles the reserved M5 identities and narrow staff
roles, then verifies the canonical private-household baseline, exact role
isolation, redacted administrative reads, and absence of pending
invitation/member residue. Sequential reruns do not duplicate fixtures. The
seeders refuse to overwrite conflicting commitments, preferences, or rules.

## Verification and human gate

`make check` runs backend verification, frontend lint/type checks/tests/build,
contract checks, and secret scanning available in the local environment. The
required acceptance results and any missing prerequisites are recorded in
[`CODEX_RESULT.md`](CODEX_RESULT.md).

Automated checks alone do not authorize deployment. Public source publication
was separately approved, while the current product phase still permits only
bounded fake-data changes and rehearsals. Review each readiness gate plus the
charter, owners, risk/data/guide/operations proposals and matrix. A separate
human decision is required before external setup, real users, real data,
vendors, or deployment.

## Documentation

- [Product requirements](docs/product/PRD.md)
- [Architecture](docs/architecture/ARCHITECTURE.md)
- [Threat model](docs/security/THREAT_MODEL.md)
- [Regulatory boundaries](docs/compliance/BOUNDARIES.md)
- [Roadmap](docs/ROADMAP.md)
- [Current status](docs/STATUS.md)
- [Next proposed task](docs/codex/NEXT_TASK.md)
- [Milestone 2 acceptance](docs/testing/MILESTONE_2_ACCEPTANCE.md)
- [Milestone 3 acceptance](docs/testing/MILESTONE_3_ACCEPTANCE.md)
- [Milestone 4 acceptance](docs/testing/MILESTONE_4_ACCEPTANCE.md)
- [Milestone 5 acceptance](docs/testing/MILESTONE_5_ACCEPTANCE.md)
- [Milestone 6 requirements](docs/product/MILESTONE_6_REQUIREMENTS.md)
- [Milestone 6 import inventory](docs/compliance/MILESTONE_6_IMPORT_INVENTORY.md)
- [Milestone 6 acceptance](docs/testing/MILESTONE_6_ACCEPTANCE.md)
- [Private Beta readiness plan](docs/product/PRIVATE_BETA_READINESS_PLAN.md)
- [Private Beta readiness gate](docs/testing/PRIVATE_BETA_READINESS_GATE.md)
- [Private Beta operating-model plan](docs/operations/PRIVATE_BETA_OPERATING_MODEL.md)
- [Private Beta guide-freshness plan](docs/product/PRIVATE_BETA_GUIDE_FRESHNESS_PLAN.md)
- [Private Beta risk register](docs/security/PRIVATE_BETA_RISK_REGISTER.md)
- [Private Beta data-handling plan](docs/compliance/PRIVATE_BETA_DATA_HANDLING_PLAN.md)
- [ADR-017 planning-only Private Beta readiness](docs/adr/ADR-017-planning-only-private-beta-readiness.md)
- [ADR-018 fake-data-only Private Beta readiness implementation](docs/adr/ADR-018-fake-data-private-beta-readiness-implementation.md)
- [ADR-019 provider-independent Private Beta fail-closed guardrails](docs/adr/ADR-019-provider-independent-private-beta-fail-closed-guardrails.md)
