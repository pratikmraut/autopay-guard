# Next task: review the security PR and approve main protection

The latest user request supersedes account-creation as the default experience:
preserve the existing full-app local demo username/password, close signup,
update documentation, commit sanitized code, scan committed source/history and
fix the GitHub main-protection warning. No real users/data or deployment.

Current implementation includes demo-first UI, false defaults, a minimal realm
operator, canonical public-auth operation allowlisting, bounded privacy exports,
safer fixture locks and patched development/Java runtime dependencies. Local
quality, source/history/image scans and CodeQL triage are recorded in
CODEX_RESULT.md and docs/security/SECURITY_REVIEW_2026-09-16.md. No deployment.

Main protection is still external pending work: obtain the requested exact-rule
approval after the safety review blocked that permission change, apply only
those rules and verify them. Do not bypass the block or claim protection from
source changes alone. Review fresh PR CI/CodeQL before merging. PostgreSQL and
Keycloak retain documented upstream image findings; do not disable their new
fail-closed gates or silently dismiss alerts. A future vendor update or explicit
evidence-based disposition is needed before any hosting decision.

The source can be pushed on the existing `codex/portfolio-accounts-demo` branch
with a reviewable PR. Remote CI/security findings on that commit remain separate
from local results; do not disable a check to merge. Staff roles and reserved
demo deletion protection remain intentional. Never publish `.env`, tokens,
credential-bearing screenshots, scanner artifacts or runtime data.

## Earlier hosting proposal (deferred)

Status: the September 12 portfolio implementation gate passed. A separately
requested September 16 local login presentation update is implemented; its
fresh verification and environment limitations are recorded in `CODEX_RESULT.md`.
Sanitized public-source publication is authorized; use the Git history and
checks on the actual commit for publication/remote-CI evidence. Website
deployment and real-user signup remain separate, unexecuted work.

## Authorized scope

The user requested account-creation and demo code changes, documentation, and a
GitHub commit/push before hosting. Test only fictional local identities. Preserve
the OIDC BFF, exact money, workspace isolation, deletion denial, and narrow roles.

## Implemented

- Branded inherited local Keycloak theme, natural keyboard tab order, and a
  LOCAL/localhost-only **Use local demo account** username shortcut. It opens
  normal provider password authentication, not a guest or token bypass. Existing
  credentials are preserved; the separate `/demo` remains memory-only. ADR-021
  documents theme-only activation without running fixture reconciliation.

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

## Historical September 12 local gate

The complete post-patch `make check` exited 0: 315 Surefire, 39 PostgreSQL,
564 Vitest, four raw-request, nine script and 30 browser tests passed; six
existing guarded browser cases were intentionally skipped. Signup/recovery
and cross-workspace negative tests ran on desktop and mobile. Dependency,
source-secret and refreshed application-image/source security scans passed.
Normal and forced-failure restore rehearsals preserved the canonical fake data.
Detailed evidence is recorded in `CODEX_RESULT.md`. Remote checks remain a
separate gate on the actual published commit, not an inferred local result.

## Next human gate

Before treating the September 16 login slice as a new complete release gate,
restore the Windows container-test connection and rerun the 39 PostgreSQL
cases, rerun `make check` with a scoped repository-ownership allowance, and
verify a clean network-backed image build. The bounded current UI evidence is
10/10 targeted browser cases plus the checks listed in `CODEX_RESULT.md`.

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
