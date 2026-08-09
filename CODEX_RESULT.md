# Codex result - PB-G04A/PB-G06 preliminary local hardening

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
