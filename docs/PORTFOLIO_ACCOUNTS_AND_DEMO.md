# Portfolio demo and local account registration

This increment prepares a working portfolio demonstration and a reproducible
**fake-data-only account-creation rehearsal**. It does not deploy the website,
open registration to real users, configure a vendor, or approve production use.
The architecture decision is recorded in
[ADR-020](adr/ADR-020-isolated-portfolio-demo-and-explicit-local-enrollment.md).

## Two separate experiences

| Experience         | How to open it                                      | Data and lifetime                                                                                                                                                       |
| ------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interactive sample | `/demo`; no login                                   | Fictional records held in React memory in that tab. Refresh or confirmed reset restores the samples. Nothing is written to an API, `localStorage`, or `sessionStorage`. |
| Account-based app  | `/signup`, then provider verification and `/enroll` | A distinct identity and application account, with a private workspace in the local database. Signing out does not delete this account or its records.                   |

The demo is not a shared account and provides no guest API access. A visitor
cannot modify another visitor's sample, and sample changes cannot be transferred
to an account. Loading the page still requires the web server and its static
assets; “no API calls” describes the sample's data operations, not an offline
installation or a claim about infrastructure access logs.

### Working sample features

- Four fictional monthly commitments: ₹500, ₹1,200, ₹800 and an estimated ₹2,000.
- Add, edit, search and archive; archive requires confirmation and does not
  cancel any real subscription.
- Exact integer-paise totals, with fixed and estimated variable amounts shown
  separately. Starting known totals are ₹4,500 monthly and ₹54,000 for 12 months;
  these include estimates and are not verified charges or savings.
- A selected-month schedule. The September 2026 starting month is an
  illustrative scenario, not the current date or a statement of payment history.
- Anchor-day handling: a day-31 sample falls on February's last day and returns
  to day 31 in March, including leap-year handling.
- Confirmation before resetting, keyboard-operable forms and inline validation.

The sample intentionally supports **monthly recurrence and INR only**, up to 50
records including archived items. Names and amounts are bounded. Each active
sample appears once in each projected month, with no proration, foreign exchange,
unknown variable amounts or historical payment records. Editing a sample changes
all of its hypothetical projections. The authenticated app has the broader
recurrence and feature set documented in the main README; the sample does not
simulate every feature or make nonworking buttons appear functional.

## Account creation and recovery

1. `/signup` starts the existing Keycloak OIDC flow with its registration hint.
   The provider owns password entry, verification and recovery; the web
   application has no password-registration API and receives no provider password.
2. Keycloak requires email verification. Local verification and reset messages
   are captured by Mailpit, not delivered to real inboxes.
3. Normal sign-in returns through `/account/continue`. This reads `/v1/me`;
   visiting a page is not authorization to create an application account.
4. A new verified identity with exactly the `USER` API-client role receives the
   explicit `ACCOUNT_ENROLLMENT_REQUIRED` state and is directed to `/enroll`.
   Disabled registration, missing verification, conflicting identity or staff
   roles do not become an enrollment shortcut.
5. The user must explicitly confirm adulthood and accept the current notice.
   `POST /v1/account/enrollment` accepts only the two confirmations and notice
   version. The BFF checks the enabled flag, session role and same-origin request;
   the API revalidates identity, role and consent. A stale notice requires renewed
   acceptance.
6. The app creates the bound account and records its notice acknowledgement in
   one transaction. Repeating the request for the same valid identity is
   idempotent; email collisions are not silently merged.
7. Existing onboarding creates the user's private workspace. New users do not
   inherit the seeded demo household or staff privileges.

New accounts bind both the configured issuer and subject. V7 adds issuer storage
and uniqueness constraints but does not guess issuer values for existing rows or
merge existing accounts. The conservative global subject uniqueness restriction
remains: this is not a general multi-issuer account-linking feature. Pre-V7
production identities require an operator-reviewed migration. A narrow local
fixture compatibility path preserves the established synthetic test accounts.

Auth.js keeps tokens in the existing HttpOnly OIDC/BFF session boundary; the
browser session JSON endpoint remains disabled. No login tokens are placed in
browser storage. Not receiving a Google or Keycloak password does **not** remove
the responsibility to protect identities, tokens, email addresses, commitments,
exports, audit records and backups.

## Local setup

Use only a private development machine and invented data. Start Rancher Desktop
with its Docker-compatible **Moby** engine, or an existing compatible Docker
Desktop installation. The local stack also requires Java 21, the pinned Node/
pnpm toolchain, GNU Make and Git Bash on Windows, as described in the README.
The PowerShell wrapper uses the project's ignored local tools when available;
it is not an installer for all missing prerequisites.

From a PowerShell terminal in the repository root:

```powershell
.\make.ps1 bootstrap
.\make.ps1 up
```

Bootstrap generates an ignored `.env` with local-only random secrets. Never
commit this file or replace secrets with public placeholders. Existing local
configuration should be retained. `up` rebuilds the services and reconciles the
local Keycloak policy; imported realms are not updated merely by editing a JSON
fixture.

`LOCAL_SELF_REGISTRATION_ENABLED=true` enables the local rehearsal through the
repository's orchestration. It maps to the API's
`APP_IDENTITY_SELF_REGISTRATION_ENABLED` and the web's
`AUTH_SELF_REGISTRATION_ENABLED`, and enables matching local realm registration.
Set the local flag to `false` and rerun `up` to close new registration consistently;
existing registered users retain USER access and captured-email recovery.
Direct API/web configuration defaults to disabled;
registration must remain disabled outside this explicitly authorized local
rehearsal. Do not copy the local Compose file, Mailpit configuration, development
profile, fake identities or generated credentials to an internet host.

Open:

- Website: `http://localhost:3000`
- Isolated sample: `http://localhost:3000/demo`
- Account creation: `http://localhost:3000/signup`
- Captured local email: `http://localhost:8025`

Optional: `.\make.ps1 seed` reconciles the reserved fake users, households and
fixtures used by the broader acceptance suite. It is a data-writing rehearsal
operation, not a prerequisite for the isolated sample or a new user's private
workspace. It must never run against real-user or production data.

To stop local containers while retaining their volumes:

```powershell
.\make.ps1 down
```

Do not use the destructive reset command as an ordinary restart.

## One-minute sample walkthrough

1. Open `/demo` and verify ₹4,500 monthly and ₹54,000 for 12 months.
2. Add a fictional monthly commitment for ₹250. Expect ₹4,750 and ₹57,000.
3. Edit that sample to ₹275. Expect ₹4,775 and ₹57,300.
4. Archive it and confirm. Expect the original ₹4,500 and ₹54,000 totals.
5. Open `/demo` in a second tab, make a change in the first and verify that the
   second tab stays unchanged. Refreshing the first restores its samples.

## New-account rehearsal

1. Choose **Create account**, then **Create account securely**.
2. Use a made-up name and a unique fictional address, such as
   `portfolio-test-one@autopayguard.local`. Choose a new local-only password of
   at least 12 characters; never reuse a personal password.
3. Open Mailpit, locate that exact fictional recipient and follow the local
   verification link. Treat verification/reset links as secrets: do not publish
   them, capture them in documentation, or paste them into issues.
4. After identity verification, review the local notice and submit both unchecked
   confirmations on **Finish creating your account**.
5. Complete workspace setup using a fictional label. Create/edit/archive only
   sample commitments.
6. Sign out. From **Forgot password?**, continue to the provider's recovery page
   and use the reset message captured for that fictional recipient. Confirm that
   the old password no longer works and that signing in restores the same app
   account and workspace, not a duplicate.
7. In a separate browser profile, register a second fictional account. Its
   workspace must be independent, with no access to the first account's records
   or administrative operations.

The existing seeded account remains a local test fixture; its generated password
is not a public demo credential. Mailpit has no production mailbox isolation and
must not be exposed publicly.

## Verification and evidence

Run the complete repository gate after implementation and integration:

```powershell
.\make.ps1 check
```

The portfolio browser specifications are
`apps/web/e2e/portfolio-demo.spec.ts` and
`apps/web/e2e/portfolio-signup.spec.ts`. The signup specification is explicitly
guarded for enabled local registration, loopback services and fictional
identities; do not remove these guards to run it against a host. The standard
quality helper supplies the local configuration. A skipped signup test is not
evidence of a successful verification or password-recovery journey.

The complete post-patch local gate passed on 2026-09-12: 315 Surefire tests,
39 real-PostgreSQL tests, 564 Vitest tests, four raw-request tests, nine script
tests and 30 desktop/mobile browser cases. Six existing guarded M5/M6 cases
were intentionally skipped in the standard browser matrix; both new signup/
recovery cases and all four demo cases ran and passed. Formatting, lint, strict
types, generated contracts, production build, dependency audit and source-secret
scan passed. See `STATUS.md` and `CODEX_RESULT.md` for the image/source security
checks and detailed limits. Local acceptance is not production approval or an
independent security assessment; remote CI must be reviewed on the actual commit.

## Before hosting for real people

Publishing source and passing local tests are separate from permission and
readiness to run a public service. At minimum, review and evidence:

- A hosting design for Next.js, Java API, PostgreSQL and Keycloak, with a domain,
  TLS, production modes pinned, private data services and no public admin/
  Mailpit/database ports. A static website host alone cannot run this stack.
- Approved, complete privacy wording and a matching notice version/fingerprint.
  The existing `/privacy` page still describes the Foundation local release; it
  must not be presented as a complete notice for real M1–M6 data processing.
- An operated IdP, real authenticated SMTP delivery, verified sender/domain,
  registration abuse controls, delivery/recovery testing, staff MFA, reversible
  account disablement, session/token revocation and offboarding procedures.
- Reviewed issuer migration, least-privilege database access, isolated migration
  credentials, managed secrets, encrypted backups and a tested restore plan.
- Security/dependency review of the final commit and deployed images, external
  rate/egress controls, monitoring, privacy-minimized logs, incident response,
  accountable operators and cost/availability limits.
- A decision to disable the fictional cancellation-guide catalog or replace it
  with separately verified, maintained content. No guide may imply an actual
  cancellation or mandate change performed by this application.
- An explicit decision on cohort, real data, provider services and deployment.
  Friends and recruiters are real users when entering their own information;
  calling the service a portfolio does not waive these requirements.

A later deployment can start with the isolated sample experience after the web
hosting boundary has been reviewed, while real-account signup remains closed.
This document selects no hosting vendor, opens no account and authorizes no
production or real-user operation.
