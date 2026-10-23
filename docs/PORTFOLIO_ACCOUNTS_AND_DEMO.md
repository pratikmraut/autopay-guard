# Portfolio demo and local account operation

## Current mode: existing demo account only (2026-09-16)

The user requested no new-account flow. Registration now defaults to false in
bootstrap, Compose, development/test orchestration, API/web policy and the local
realm. Use the existing `demo@autopayguard.local` identity and its unchanged
private password for the persistent full USER workspace. The home page and
sign-in page put this experience first; `/signup` displays a closed state.
Staff roles remain separate and the reserved demo identity remains protected
against deletion. No existing identity or business data is removed.

For an already initialized local installation, edit only
`LOCAL_SELF_REGISTRATION_ENABLED=false` in the private `.env`, then run:

```powershell
node --env-file=.env scripts/disable-local-registration.mjs
docker compose up --detach --no-deps --build --wait --wait-timeout 180 api web
```

The narrow operator validates exact local endpoints and changes only the
realm's `registrationAllowed` field. It does not reseed users, passwords, roles,
SMTP, recovery or workspaces. Recreating API/web applies the matching environment
flags and new source. Keep the existing database volume and `.env`. Do not run
`reset`, fixture reconciliation or `seed` merely to close signup.

For ordinary use after this update, `docker compose stop` and
`docker compose start` retain the containers, data and generated credentials.
Start at `http://localhost:3000/signin`, never a saved long authorization URL.
See ADR-022 for the current decision. The account-creation sections below are
historical implementation/rehearsal documentation, not instructions to open
registration under the current authorization.

The earlier portfolio increment added a working sample demonstration and a
reproducible **fake-data-only account-creation rehearsal**. That registration
rehearsal is now disabled; it is not part of everyday demo operation. Neither
increment deploys the website, opens registration to real users, configures a
vendor or approves production use. The earlier architecture is recorded in
[ADR-020](adr/ADR-020-isolated-portfolio-demo-and-explicit-local-enrollment.md).
The later presentation-only local login theme and password-required demo
shortcut are recorded in
[ADR-021](adr/ADR-021-branded-local-login-and-password-required-demo-helper.md).

## Two separate experiences

| Experience         | How to open it                             | Data and lifetime                                                                                                                                                       |
| ------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interactive sample | `/demo`; no login                          | Fictional records held in React memory in that tab. Refresh or confirmed reset restores the samples. Nothing is written to an API, `localStorage`, or `sessionStorage`. |
| Saved demo app     | `/signin`, then **Use local demo account** | Existing fictional identity and persistent private local workspace; signing out does not delete its records.                                                            |

The `/demo` sample is not a shared account and provides no guest API access. A visitor
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

### Existing local demo account: full authenticated app

The local fixture and the isolated sample are deliberately different. The
existing `demo@autopayguard.local` identity opens the full account-based app;
it uses the same persistent local demo workspace across sessions. Changes made
there are not reset by refreshing and can affect a later demonstration using
that account. Use invented data only; this is not a public shared demo account.
All ordinary USER features remain subject to their existing workspace and
household permissions. This does not grant staff/admin access or remove the
reserved fixture's deletion protection.

1. Open `http://localhost:3000/signin`. If already signed in as another account,
   sign out first.
2. Under **Local demo account**, choose **Use local demo account**.
3. Keycloak opens a fresh login prompt with `demo@autopayguard.local` prefilled.
   Enter the existing local demo password there, then choose **Sign In**. The
   app never prefills, publishes or receives that password. For an unchanged
   seeded fixture, the operator's private ignored `.env` contains its generated
   `KEYCLOAK_FAKE_USER_PASSWORD`; do not paste that value into source,
   documentation, recordings or issues. A previously changed password remains
   unchanged by the presentation and demo-only updates.
4. The regular OIDC callback returns to the app and its existing account/workspace
   flow. Work only in the fictional demo workspace; archive any temporary test
   items when appropriate. Signing out ends the app session but does not erase
   local records.

This helper is enabled only for exact `LOCAL` mode with the canonical localhost
application and issuer URLs. It supplies a username hint and `prompt=login`, not
a password or authentication bypass. It does not create an absent fixture or
reset a forgotten password. Outside that local configuration the helper is
unavailable. **Try sample without signing in** opens `/demo` instead: no
credential, no private API operations, and changes reset on refresh.

## Historical account-creation flow (disabled by default)

The following describes the earlier enabled rehearsal, not the current runtime:

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
public browser session JSON endpoint and its path aliases are blocked by a
canonical auth-operation allowlist. No login tokens are exposed through that
endpoint, `localStorage` or `sessionStorage`; the HttpOnly session cookie remains
part of the browser/server authentication flow. Not receiving a Google or
Keycloak password does **not** remove
the responsibility to protect identities, tokens, email addresses, commitments,
exports, audit records and backups.

## First-time local setup

Use only a private development machine and invented data. Start Rancher Desktop
with its Docker-compatible **Moby** engine, or an existing compatible Docker
Desktop installation. The local stack also requires Java 21, the pinned Node/
pnpm toolchain, GNU Make and Git Bash on Windows, as described in the README.
The PowerShell wrapper uses the project's ignored local tools when available;
it is not an installer for all missing prerequisites.

For a fresh fictional installation, from a PowerShell terminal in the repository
root (not for restarting an already initialized demo):

```powershell
.\make.ps1 bootstrap
.\make.ps1 up
```

Bootstrap generates an ignored `.env` with local-only random secrets. Never
commit this file or replace secrets with public placeholders. Existing local
configuration should be retained. `up` rebuilds the services and reconciles the
local Keycloak policy; imported realms are not updated merely by editing a JSON
fixture. The policy reconciler also reconciles reserved local fixture
credentials. Do not use `up` as a theme-only update when existing credentials
must be preserved; use the narrow procedure below.

Only a separately approved fictional account-creation rehearsal should set
`LOCAL_SELF_REGISTRATION_ENABLED=true`. That opt-in enables the rehearsal through
the repository's orchestration. It maps to the API's
`APP_IDENTITY_SELF_REGISTRATION_ENABLED` and the web's
`AUTH_SELF_REGISTRATION_ENABLED`, and enables matching local realm registration.
Registration defaults to `false`. Use the narrow migration above to close a
previously enabled installation without fixture/password reconciliation;
existing identities retain their assigned roles and captured-email recovery.
Direct API/web configuration also defaults to disabled. Leave registration off
for the current demo-only operation. Do not copy the local Compose file, Mailpit
configuration, development profile, fake identities or generated credentials
to an internet host.

Open:

- Website: `http://localhost:3000`
- Isolated sample: `http://localhost:3000/demo`
- Closed registration information: `http://localhost:3000/signup`
- Captured local email: `http://localhost:8025`

Optional: `.\make.ps1 seed` reconciles the reserved fake users, households and
fixtures used by the broader acceptance suite. It is a data-writing rehearsal
operation, not a prerequisite for the isolated sample or for continuing with the
existing demo. It can reconcile fixture credentials and data and must never run
against real-user or production data.

For an ordinary pause and resume, retain the existing containers as well as
their volumes:

```powershell
# Pause now:
docker compose stop
# Resume later, after the container engine is running:
docker compose start
```

`make down` retains named volumes but removes containers and their network, so
`docker compose start` alone cannot resume after it. Do not use the destructive
reset command as an ordinary restart.

### Apply the branded login to an existing local realm

The local theme now runs on pinned Keycloak 26.7.3. It inherits the provider's
authentication templates and adds AutoPay Guard colors, accessible controls,
a brand mark and local sample/privacy links. No provider passwords are added
to the frontend. The
theme's URLs are explicitly local; do not copy it unchanged to a hosted service.
A small same-origin accessibility script removes only inherited positive tab
indexes after the page is ready, restoring natural keyboard order. It does not
read form values or change authentication behavior; zero/negative tab indexes,
provider forms, validation and password controls remain intact.

For an already initialized local stack, use the following commands from the
repository root with the configured local Docker-compatible engine and pinned
Node available. Keep the existing `.env` and PostgreSQL volume:

```powershell
docker compose up --detach --no-deps --force-recreate --no-build --pull never --wait --wait-timeout 180 keycloak
node --env-file=.env scripts/apply-local-login-theme.mjs
```

Recreating **only Keycloak** is necessary when adding the read-only theme mount;
a plain restart cannot add that mount. It briefly interrupts sign-in, but does
not recreate the database or run fixture reconciliation. Never add `--volumes`,
run `reset`, or delete data for this appearance change. If the configured local
engine is unavailable, recover it first rather than installing a different stack
or initializing a replacement database.

The second command validates exact local URLs/mode/project settings, verifies
the mounted theme exists, and updates only the existing realm's `loginTheme`.
It does not change users, passwords, roles, registration or SMTP. Do not use
`.\make.ps1 up`, `.\make.ps1 seed` or `validate-keycloak-seed.mjs` merely to
activate a theme: those perform broader fixture/credential reconciliation, and
seed writes fixture data. The dedicated script intentionally avoids that path.

This theme procedure does not rebuild the Next.js app. If the running web image
predates the new **Use local demo account** helper, separately rebuild/recreate
only that image without running fixture reconciliation:

```powershell
docker compose up --detach --no-deps --build --wait --wait-timeout 180 web
```

After the services are healthy, begin again at `http://localhost:3000/signin`
instead of reusing an old long authorization URL. Confirm the branded provider
page, prefilled demo email, still-required password and successful normal login.
With registration disabled, verify that the provider has no Register link and
`/signup` remains closed. Inspect recovery without submitting a password reset
for the preserved demo account. A successful theme activation is not evidence
that every authentication journey has passed. Record fresh verification
results separately from the historical test evidence below.

## One-minute sample walkthrough

1. Open `/demo` and verify ₹4,500 monthly and ₹54,000 for 12 months.
2. Add a fictional monthly commitment for ₹250. Expect ₹4,750 and ₹57,000.
3. Edit that sample to ₹275. Expect ₹4,775 and ₹57,300.
4. Archive it and confirm. Expect the original ₹4,500 and ₹54,000 totals.
5. Open `/demo` in a second tab, make a change in the first and verify that the
   second tab stays unchanged. Refreshing the first restores its samples.

## Historical new-account rehearsal (not part of demo-only operation)

Do not execute this account-writing procedure under the current demo-only
request. It requires separate fictional-rehearsal approval and deliberately
enabled matching flags. Routine demo tests use only the existing fixture.

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

The current demo/login browser specifications are
`apps/web/e2e/portfolio-demo.spec.ts` and `apps/web/e2e/branded-login.spec.ts`.
The branded suite uses the existing local account, checks closed registration
and session-path aliases, and does not create an account or reset a password.
The historical `apps/web/e2e/portfolio-signup.spec.ts` specification is explicitly
guarded for enabled local registration, loopback services and fictional
identities; do not remove these guards to run it against a host. The standard
quality helper supplies the local configuration. A skipped signup test is not
evidence of a successful verification or password-recovery journey.

Current evidence, image findings and remaining limits belong to `STATUS.md`,
`CODEX_RESULT.md` and `security/SECURITY_REVIEW_2026-09-16.md`. The current Compose
pins are Keycloak 26.7.3, PostgreSQL 18.6-alpine and Mailpit 1.31.1. Upgraded or
healthy services do not by themselves imply zero vulnerabilities or production
readiness.

### Historical September 12 account-rehearsal evidence

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
