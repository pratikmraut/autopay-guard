# Private Beta readiness risk register

Status: **updated during the fake-data-only implementation/rehearsal phase on
2026-08-09. It is not a security approval or beta risk acceptance.** All
accountable owners are unassigned and Private Beta execution is NO-GO.

## Rating and gate rule

- `CRITICAL`: plausible catastrophic authorization, credential, financial,
  privacy, or destructive impact.
- `HIGH`: serious exposure or loss with material participant impact.
- `MEDIUM`: bounded but meaningful impact requiring planned treatment.
- `LOW`: limited impact handled through normal change control.

No applicable unresolved `CRITICAL` or `HIGH` risk may cross the Private Beta
gate. A scanner ignore, severity downgrade, generic acceptance, or expired
exception is not closure. A non-applicable decision needs exact architecture
evidence and accountable human approval.

## Current risks

| ID     | Risk                                                 | Initial rating | Current exposure                                                                                                                                                | Required treatment/evidence                                                                                                                                                                                                             | Owner                               | Gate/status                    |
| ------ | ---------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------ |
| PB-R01 | CodeQL/static-analysis gap                           | HIGH           | Public source publication can trigger Java and JS/TS CodeQL, but no remote result has yet been reviewed                                                         | Immutable candidate; CodeQL results for both languages; reviewed alerts                                                                                                                                                                 | Security owner                      | PB-G05 BLOCKED                 |
| PB-R02 | Development stack/internet perimeter exposed as beta | CRITICAL       | Local production-mode guards reject unsafe modes, destinations and development surfaces, but Compose remains local and no approved perimeter/environment exists | Approved isolated environment with endpoint inventory, TLS/HSTS, origin/trusted-proxy and edge-wide abuse/rate controls, outbound egress allowlist, private data plane, managed secrets/keys, dev-feature rejection and role separation | Platform/security owners            | PB-G06 BLOCKED; PARTIAL local  |
| PB-R03 | Real-data purpose/retention not approved             | HIGH           | All evidence is fake-local; legal basis, notices, retention, IdP/backup deletion and vendor terms are unresolved                                                | Counsel-reviewed purpose map, participant documents, rights/offboarding and retention decisions                                                                                                                                         | Privacy owner/counsel               | PB-G07 BLOCKED                 |
| PB-R04 | Fictional guides mistaken for real guidance          | HIGH           | Current guides use fictional names and inert targets; beta source plan expects freshness workflow                                                               | Disable the surface with route/UI/metric proof, isolate fictional training with the same metric exclusions, or separately approve a real-guide program with reviewers, expiry, monitoring and disclaimers                               | Product/guide owners                | PB-G08 BLOCKED                 |
| PB-R05 | No accountable operations/incident ownership         | HIGH           | No named operator, support lead, incident commander, service hours or shutdown owner                                                                            | Approved RACI, severity model, on-call/support expectations and seeded incident rehearsal                                                                                                                                               | Beta sponsor/operations             | PB-G03/PB-G09 BLOCKED          |
| PB-R06 | Insufficient observability                           | HIGH           | Local health/log evidence is not an availability, queue, auth, privacy or backup alerting system                                                                | Privacy-minimized metrics/logs/traces, dashboards, alerts, access/retention and alert rehearsal                                                                                                                                         | Operations/security                 | PB-G09 BLOCKED                 |
| PB-R07 | Local restore evidence overgeneralized               | HIGH           | M6 drill has no beta RPO/RTO, encryption, region, backup schedule or IdP recovery claim                                                                         | Approved backup/restore design and measured seeded rehearsal in candidate environment                                                                                                                                                   | Operations/platform                 | PB-G09/PB-G11 BLOCKED          |
| PB-R08 | External email privacy/abuse/delivery risk           | HIGH           | Only fake Mailpit delivery is accepted; no vendor/domain/consent/suppression/bounce controls                                                                    | Keep beta in-app-only or separately approve vendor, authenticated domain, abuse and lifecycle controls                                                                                                                                  | Product/privacy/operations          | PB-G06/PB-G07 BLOCKED          |
| PB-R09 | Analytics leaks financial/personal content           | HIGH           | Funnel dashboard/event inventory does not exist                                                                                                                 | First-party allowlist excluding content/amounts/names; purpose, access, retention, rights and query tests                                                                                                                               | Privacy/data owners                 | PB-G10 BLOCKED                 |
| PB-R10 | Cross-household or staff authorization regression    | CRITICAL       | M1-M6 local tests passed, but no immutable beta candidate/environment exists                                                                                    | Full subject/role matrix on candidate, session/IdP review, DAST and incident stop rule                                                                                                                                                  | Security/engineering                | PB-G05/PB-G11 BLOCKED          |
| PB-R11 | Supply-chain workflow trust gap                      | HIGH           | Actions are SHA-pinned with least-privilege workflow permissions, but public-repository branch/ruleset controls and first-run evidence are not yet reviewed     | Protected branch, outside-collaborator workflow approval, dependency review, signed evidence and least-privilege permissions                                                                                                            | Engineering/security                | PB-G04/PB-G05 BLOCKED          |
| PB-R12 | Brand/regulatory/consumer expectation mismatch       | HIGH           | Working brand and real-data/guide/private-beta perimeter have no specialist decision                                                                            | Counsel and trademark/domain review; approved copy and participant expectations                                                                                                                                                         | Beta sponsor/counsel                | PB-G07 BLOCKED                 |
| PB-R13 | Support process collects sensitive evidence          | HIGH           | No approved live support channel or handling policy exists                                                                                                      | Redacted intake, prohibited-data copy, least privilege, retention/access and deletion workflow                                                                                                                                          | Support/privacy owners              | PB-G09 BLOCKED                 |
| PB-R14 | Cohort or feature expansion without evidence         | HIGH           | No feature allowlist, cohort protocol or automatic stop controls exist                                                                                          | Signed charter, staged cap, change control, invitation pause and final named go/no-go                                                                                                                                                   | Beta sponsor/product                | PB-G02/PB-G13 BLOCKED          |
| PB-R15 | Savings/activation metrics create harmful incentives | MEDIUM         | Source plan includes savings/action hypotheses                                                                                                                  | Preserve category-safe policy and savings states; never optimize cancellation count; human metric review                                                                                                                                | Product/data owners                 | PB-G10 BLOCKED                 |
| PB-R16 | Invite-only identity boundary fails open             | CRITICAL       | Local guards reject public/dev provisioning drift and ambiguous client roles, but no approved real identity lifecycle exists                                    | Disable public registration and dev auto-provisioning; immutable issuer/subject binding; least-privilege staff roles/MFA; reviewed recovery/session/break-glass/offboarding tests                                                       | Identity/security/operations owners | PB-G04A BLOCKED; PARTIAL local |
| PB-R17 | Time-dependent commitment baseline test              | HIGH           | Closed locally: the test now uses an injected fixed clock while production retains household-local-today materialization semantics                              | Focused method and full class pass; complete delivery quality gate passes with zero unexplained failures                                                                                                                                | Engineering/product owners          | CLOSED 2026-08-09              |
| PB-R18 | Newly published transitive package advisory          | HIGH           | Closed locally: `GHSA-2v37-7h3g-55p8` affected transitive `nanoid` below 3.3.17 through Next/PostCSS when the fresh audit ran                                   | Override and lock 3.3.17; frozen install; rerun the production dependency audit and complete quality gate                                                                                                                               | Engineering/security                | CLOSED 2026-08-09              |

## Preliminary local treatment boundary

ADR-019 records PRELIMINARY/PARTIAL treatment for PB-R02 and PB-R16. It does
not lower either initial rating or close either risk.

For PB-R16, local startup and realm controls reject development auto-
provisioning, public registration/recovery drift, unverified email, external
identity providers and unexpected or ambiguous API-client roles. Subject
lookup remains immutable and deletion tombstones prevent recreation. The
remaining blockers are explicit `(iss, sub)` storage/uniqueness and migration,
reversible disablement, live session/token revocation, staff MFA, recovery,
break-glass, offboarding, a real approved IdP and accountable human owners.

For PB-R02, explicitly selected local API/web production guards validate modes/
profiles, non-local HTTPS destinations, exact declared origins, disabled
trusted-proxy/development surfaces, bounded management/error/schema settings
and distinct configured database usernames. Web-owned dependency requests
reject redirects. This is not deployment-level mode activation, network egress
enforcement, proof of framework/dependency redirect policy, migration-
credential isolation, or proof of database grants/schema/object owners. India-
region placement, TLS/HSTS/edge/WAF/rate controls, private networking/data
plane, managed secrets and KMS/encryption, backup/recovery, cost authority,
real hosts and accountable platform/security/operations owners remain absent.
Pure tests never resolve or contact their endpoint host strings.

## Risk decision template

Any future decision must record:

- risk ID, exact affected candidate/environment and observed evidence;
- accountable owner and independent reviewer;
- likelihood, impact and applicability in this architecture;
- treatment, compensating controls and verification;
- target/decision/expiry dates and tracked remediation;
- effect on invitations and current cohort; and
- explicit human approval.

Temporary decisions expire in no more than 30 days and become blocking again.
They do not automatically satisfy the no-unresolved-high-risk beta criterion.

## Review cadence proposal

Review before every candidate, after any material architecture/data/vendor/
guide change, after an incident, when a scanner/advisory changes, and at least
weekly during an authorized beta. No cadence is active now.

## Stop condition

This register identifies blockers; it accepts none. Do not create an
environment, run a beta, invite users, or claim security readiness until all
applicable `CRITICAL`/`HIGH` entries are closed with current evidence and
PB-G13 is explicitly approved.
