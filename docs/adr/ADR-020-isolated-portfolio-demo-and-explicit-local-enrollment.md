# ADR-020: isolated portfolio sample and explicit local account enrollment

Status: accepted for the user-authorized portfolio implementation and sanitized
source publication on 2026-09-11. Local fake-data rehearsal only; hosting and
real-user registration remain separately gated.

## Context

The user wants a resume-ready website that a recruiter can try without sharing
the developer's login, plus an account-creation flow for eventual independent
users. The existing source has an authenticated application and local seeded
identities but no self-registration interface or explicit application-account
enrollment endpoint. A public shared demo login would mix visitors' records and
would create unnecessary backend identity and abuse exposure.

ADR-004's OIDC/BFF token boundary and ADR-018/019's fake-only operating boundary
continue to apply. Changing local registration behavior must not be mistaken for
approval of a production identity system, privacy notice or deployment.

## Decision

### Isolate the recruiter sample in browser memory

Add an unauthenticated `/demo` route with a new sample factory per mount. Its
synthetic commitments are held only in component memory: no API mutations, guest
tokens, credential bypass, server persistence, `localStorage` or `sessionStorage`.
All route links disable speculative prefetching. Refreshing or confirming reset
restores the sample; another tab or visitor does not receive its changes.

The bounded sample supports monthly INR commitments only. It reuses integer
minor-unit parsing and local-date helpers, keeps estimated variable amounts
distinct from fixed values, clamps short months without losing the anchor day,
and provides real add/edit/archive/search/reset and selected-month scheduling.
It does not copy authentication, reminders, household sharing, cancellation,
privacy exports or CSV ingestion into an anonymous backend surface. Those
features remain in the separately authenticated application.

The UI states that all data is fictional, changes are temporary, and no payments
or emails are sent. “No API calls” does not mean no web asset requests or no
infrastructure logs. Sample data cannot be imported into a user's account.

### Keep identity creation at the OIDC provider

Add `/signup` using the existing Auth.js Keycloak provider and standard
registration hint, with the same PKCE/state/nonce callback checks. The application
does not collect or store provider passwords. Email verification and password
recovery remain provider operations. The local realm requires verified email,
unique email identities, a bounded password policy and brute-force protection;
all local email goes to the private Mailpit sink.

Registration is controlled by one local orchestration setting,
`LOCAL_SELF_REGISTRATION_ENABLED`, mapped consistently to the web/API feature
flags and local realm policy. The API and web flags default to false outside that
local orchestration. They must remain off outside this phase's local rehearsal;
this ADR is not authority to enable them on a real host. The local convenience
setting is not a production deployment manifest or network perimeter.

### Separate provider identity from explicit app enrollment

After sign-in, `/account/continue` performs a read-only account status check.
Only the explicit enrollment-required API result for a verified, exact-`USER`
identity allows `/enroll`. General access failures do not silently create an
account. Existing provisioned users continue through the normal app flow.

Enrollment requires a same-origin authenticated POST with exactly the adulthood
confirmation, privacy-notice acceptance and current notice version. The server
derives identity from the validated JWT; callers cannot supply an email, subject,
issuer, user id, password or role. The API repeats identity/role/notice checks,
serializes enrollment writes, and records account creation and notice
acknowledgement transactionally. A repeated valid request is idempotent; a notice
conflict requires refreshed acceptance, not silent confirmation.

New accounts store issuer and subject. V7 adds the issuer column, issuer/subject
uniqueness, conservative email uniqueness and a singleton enrollment lock. It
does not guess the issuer of legacy rows, merge conflicting emails or remove the
existing globally unique subject restriction. A narrow explicitly local fixture
compatibility path preserves the established fake accounts. Legacy production
issuer binding still needs an operator-reviewed migration; this is not
multi-provider account linking.

The existing authenticated onboarding creates the new user's private workspace.
The seeded demo household and staff roles are never inherited by registrants.
Application tokens remain on the existing server-only OIDC/BFF boundary.

## Compatibility with earlier guardrails

This decision supersedes ADR-019's closed-registration and disabled-recovery
fixture expectations **only for the explicitly enabled local synthetic account
rehearsal**. Local orchestration reconciles the expected realm settings without
deleting its volume or granting registrants staff roles. Turning the local flag
off closes new registration while preserving existing USER access and captured-
email password recovery. Managed API roles must remain noncomposite; new users
inherit only USER, never a nested administrative role.

The other identity, role, secure-configuration and fake-data constraints remain.
The production guards, actual identity lifecycle, SMTP operation, network egress,
database grants, secrets, backup/restore, notice wording and human deployment
decisions require their own evidence. This work does not mark PB-G04A, PB-G06 or
Private Beta execution as passed.

## Verification approach

Focused tests cover independent sample factories, integer totals through edit/
archive/reset, malformed input, leap years, no sample network/storage calls,
unchecked consent, stale notice rejection, role and configuration rejection,
same-origin BFF mutations and safe return paths. Browser specifications exercise
same-context two-tab sample isolation, desktop/mobile accessibility, real local
provider signup/verification/recovery and cross-account isolation.

At ADR writing time, 40 focused demo tests and 217 independently rerun signup/
consent/BFF/route tests passed. These are not a replacement for the final complete
check, browser/runtime evidence or a production security assessment. Record the
final integrated results separately in the status and result documents.

## Consequences and stop condition

- Recruiters can evaluate a working bounded sample without a shared login or
  registration database entry.
- Visitors must create a separately verified identity and explicitly enroll
  before using their own persistent local workspace.
- The sample resets on refresh by design and is not a full offline application.
- Provider passwords are not handled by AutoPay Guard, but personal-data and
  session-security responsibilities still exist for the account-based service.
- The current Foundation-only notice is inadequate as a complete production
  notice for M1–M6 processing. Approve and version the full notice before inviting
  real people; do not merely change a configuration version string.
- Stop before selecting/configuring a real IdP, SMTP service, domain, cloud host,
  production database or real-user cohort. Source commit/push authority does not
  authorize deployment, real information or external vendor operations.
