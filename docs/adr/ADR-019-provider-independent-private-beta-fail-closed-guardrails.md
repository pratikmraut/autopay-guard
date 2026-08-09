# ADR-019: provider-independent Private Beta fail-closed guardrails

Status: accepted on 2026-08-09 for bounded fake-data-only local hardening.
Evidence is PRELIMINARY/PARTIAL; PB-G04A and PB-G06 remain BLOCKED.

## Context

ADR-018 authorized provider-independent local readiness work without authorizing
real users, real data, vendors, shared/cloud/production infrastructure, or a
deployment. PB-G04A and PB-G06 identified two fail-open risks in the local
baseline: development identity behavior could be enabled in a production mode,
and development/runtime configuration could be mistaken for an approved
internet perimeter.

Local guardrails can make those states harder to enter accidentally. They
cannot choose or approve an identity provider, region, network, secrets
service, database privilege model, operating owner, or real host.

## Decision

Add provider-independent, fail-closed validation at application boundaries.

For identity:

- production startup requires only the explicit `prod` profile, disables
  implicit user provisioning, and requires a Boolean `email_verified=true`
  claim;
- the API keeps subject lookup immutable, refuses email-based rebinding, pins
  the provisioned email, respects deletion tombstones, and synchronizes only
  the display name for the same subject;
- the API and web accept exactly one recognized API-client role and reject
  unknown, duplicate, or multiple role mappings; and
- static realm checks plus live local reconciliation reject public
  registration, reset-password/remember-me/edit-username/duplicate-email
  enablement, external identity providers, unsafe client grants or localhost
  drift, and unexpected API-client role mappings.

For runtime configuration:

- when selected, the web production runtime mode also requires
  `NODE_ENV=production`; an explicitly active API `prod` profile validates the
  production boundary before its application context is created;
- configured identity/API destinations must be explicit non-local HTTPS URLs,
  client identifiers and declared outbound origins must be exact, trusted-host
  and forwarded-header behavior remains disabled until a proxy design exists,
  and web-owned dependency requests fail on redirects;
- development email and probes, Swagger/OpenAPI, excess management exposure,
  health/error detail, schema mutation, Flyway clean, and an extra management
  listener are rejected; and
- production configuration requires different runtime and Flyway database
  usernames.

These controls are application-level rejection controls, not proof of an
operating environment. Endpoint host strings used in pure tests are syntactic
fixtures only: the tests never resolve DNS, open a connection, or contact
those hosts, and no real host or domain is approved by this decision.

## Remaining blockers

PB-G04A remains blocked because the database stores only `sub`. A real-provider
or multi-issuer boundary requires explicit `(iss, sub)` storage, uniqueness,
and a reviewed migration. Reversible account disablement, live session/token
revocation, staff MFA, recovery, break-glass, offboarding, an approved real IdP,
and accountable identity/security/operations owners are also absent.

PB-G06 remains blocked because declared origins and redirect rejection do not
enforce network egress for framework/dependency-managed traffic. Actual
database grants, schema/object owners, and migration/runtime privilege
separation have not been established; the same API process still receives the
Flyway credential. A future deployment manifest/entrypoint must also pin the
production modes because an omitted or misspelled API profile cannot activate a
profile-scoped guard. An approved India-region design, TLS/HSTS and
certificates, ingress/edge/WAF/rate controls, trusted proxy behavior, private
networking/data plane, managed secrets and KMS/encryption, backup/recovery,
cost authority, and accountable platform/security/operations owners remain
unresolved.

## Consequences

- Unsafe local production-like configurations fail earlier and more visibly.
- The local Keycloak realm and Compose stack remain development fixtures; they
  are not a beta identity system or production environment.
- The implementation is PRELIMINARY/PARTIAL evidence only and cannot change
  PB-G04A or PB-G06 to `PASS`.
- No real-user, real-data, vendor, domain, infrastructure, deployment, or
  Private Beta authority follows from this ADR.

## Stop condition

Stop before configuring a real IdP or host, creating shared/cloud/production
infrastructure, changing external network or database grants, purchasing a
service, deploying, or processing real identity/data. Those actions require a
separate human decision with named owners and an approved design.
