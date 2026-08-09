# Current task: public source baseline and remote evidence

Status: **sanitized public source publication is authorized. Website deployment
and Private Beta execution remain NO-GO.** PB-G04A and PB-G06 remain BLOCKED.

## Completed bounded work

- Added early API production-boundary rejection for implicit provisioning,
  disabled verified-email enforcement, insecure identity/JWK destinations,
  client/audience drift, excess egress origins, development email/probes/docs,
  excess management/error/schema behavior and shared configured database
  usernames.
- Pinned existing users to their immutable local subject and provisioned email,
  preserved tombstone denial, and allowed only display-name synchronization.
- Made API and web role extraction fail closed unless the API-client mapping is
  exactly one allowlisted role; pinned token `aud` and `azp`.
- Tightened the fake-local Keycloak fixture and live reconciliation for closed
  registration, safe grant/callback/origin posture and exact identity roles.
- Added explicit web LOCAL/PRODUCTION mode validation, production HSTS, exact
  declared outbound origins, redirect rejection for web-owned dependency
  requests, and structural route/public-endpoint inventories.
- Focused review passed 45 API and 39 web tests plus type, lint, format, script
  syntax and realm JSON checks. The rebuilt fake stack/seed and complete
  delivery gate passed: 301 Surefire, 29 Failsafe, four raw-request-gate and 488
  Vitest tests, clean audit/secret/build checks, and Playwright 24 passed / six
  guarded skipped. Final parity covered 693 source files with zero differences.

## Current verdict

The local slice is PRELIMINARY/PARTIAL and ready for human review. It does not
satisfy either gate and is not candidate, environment, deployment or Private
Beta evidence.

PB-G04A remains blocked by issuer-aware `(iss, sub)` persistence/migration,
reversible disablement, live session/token revocation, staff MFA, recovery,
break-glass, offboarding, an approved real IdP and named owners.

PB-G06 remains blocked by deployment-level mode pinning, network-enforced
egress and framework redirect/DNS evidence, actual database grants/object
owners and an isolated migration credential, plus an approved India-region
TLS/ingress/edge/WAF/private-network/secrets/KMS/backup/cost design with named
owners.

## Next human gate

Publish the sanitized initial source candidate, review all remote GitHub
security/quality results, protect `main`, and record the immutable commit. Then
review PB-G04A/PB-G06 and either accept the bounded preliminary result, request
revisions, pause, or authorize a different fake-only readiness slice.

## Boundary

The public Git commit/remote/push and repository-triggered CI are authorized.
Do not deploy a website, enable public signup, select or purchase vendors,
configure a real IdP/email/domain, publish real merchant guides, create shared/
staging/production/cloud resources, identify/invite adults, process real
personal/financial data, or change external network/database grants. Do not add
bank/card/UPI/Account Aggregator/SMS/inbox access, payment or mandate action,
binary evidence, provider contact, minors, or automated financial advice.
