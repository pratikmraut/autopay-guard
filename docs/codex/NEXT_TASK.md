# Next task: hosting design and explicit deployment scope

Status: portfolio implementation, review and complete local acceptance passed.
Sanitized public-source publication is authorized; use the Git history and
checks on the actual commit for publication/remote-CI evidence. Website
deployment and real-user signup remain separate, unexecuted work.

## Authorized scope

The user requested account-creation and demo code changes, documentation, and a
GitHub commit/push before hosting. Test only fictional local identities. Preserve
the OIDC BFF, exact money, workspace isolation, deletion denial, and narrow roles.

## Implemented

- No-login `/demo`: per-tab memory only, monthly INR sample commitments, exact
  projections, add/edit/archive/search/reset; no private API or storage calls.
- `/signup` delegates credentials, verification, and recovery to Keycloak.
- Explicit authenticated enrollment records age/current-notice acceptance;
  reads never enroll a new ordinary local user. New accounts are issuer-bound.
- Local realm reconciliation enables captured-email rehearsal, default USER
  authority, and independent staff roles. Closing signup preserves existing
  account access/recovery. Flags default off outside local orchestration.
- V7 migration, API contract, regression tests, live browser coverage, runbook,
  and ADR-020.

## Completed local gate

The complete post-patch `make check` exited 0: 315 Surefire, 39 PostgreSQL,
564 Vitest, four raw-request, nine script and 30 browser tests passed; six
existing guarded browser cases were intentionally skipped. Signup/recovery
and cross-workspace negative tests ran on desktop and mobile. Dependency,
source-secret and refreshed application-image/source security scans passed.
Normal and forced-failure restore rehearsals preserved the canonical fake data.
Detailed evidence is recorded in `CODEX_RESULT.md`. Remote checks remain a
separate gate on the actual published commit, not an inferred local result.

## Next human gate

Review the delivered source and separately approve a hosting design. A public
demo-only release and a service storing real users' information are different
decisions. The latter still needs approved/versioned privacy notices, real IdP
and email operations, legacy issuer migration, abuse controls, session
revocation/MFA/ownership, database least privilege, TLS/ingress, backups/restore,
monitoring, secrets, capacity/cost limits, and the outstanding beta gates.

## Boundary

Do not deploy, configure real vendors or email, invite real people, access real
personal/financial data, or expose local Compose to the internet. No payment,
bank/card/UPI/SMS/inbox access, provider actions, or financial advice.
