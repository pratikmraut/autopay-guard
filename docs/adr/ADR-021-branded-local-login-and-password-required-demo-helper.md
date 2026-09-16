# ADR-021: branded local login and password-required demo helper

Status: accepted for the user-authorized local login presentation and existing
demo-account convenience changes on 2026-09-16. Fake-data-only local operation;
no hosting, real-user enrollment or credential changes authorized by this slice.

The subsequent same-day ADR-022 closes registration and makes the existing
demo the default. Its demo-only policy supersedes any registration-rehearsal
instructions below; no account creation or demo-password reset is required.

## Context

The application uses AutoPay Guard's forest-green and cream design, but the local
Keycloak login page previously used its default dark background. The user asked
for a matching frontend and a default demo login, then chose the existing local
demo account for the full authenticated application.

The isolated `/demo` from ADR-020 remains a separate, no-login sample. Reusing a
local test identity must not turn it into a public shared credential, disclose a
password in the frontend, or bypass ADR-004's OIDC/BFF boundary. A visual update
must also avoid changing existing identities or resetting their passwords.

## Decision

### Extend the pinned provider theme without replacing authentication forms

Add a local `autopay-guard` login theme under
`infra/local/keycloak-theme/autopay-guard`. It inherits `parent=keycloak`, loads
the parent's `login.css` before branded overrides, and supplies an SVG mark,
English brand message and the supported `footer.ftl` content macro.

The initial implementation was checked against Keycloak 26.7.0's exact base
layout, login template and theme properties. The current local pin is 26.7.3;
fresh upgrade/test evidence is recorded separately in `STATUS.md` and
`CODEX_RESULT.md`. The provider's forms, hidden fields,
validation messages, password-visibility script, registration, verification,
recovery and password-update templates stay inherited. No custom credential
handler, authentication JavaScript, external font or analytics dependency is
introduced.

One small same-origin presentation script removes inherited positive `tabindex`
attributes after DOM readiness. This restores natural document tab order instead
of Keycloak's hardcoded positive sequence, which failed the initial browser
accessibility check. Zero and negative tab indexes remain unchanged. The script
does not read form values, credentials, URLs or tokens, submit forms, attach
authentication handlers, or make network/storage calls. Authentication templates
and their existing scripts remain inherited.

The CSS aligns the provider with the application's colors and typography while
preserving visible keyboard focus, responsive layouts, error messages and
accessible password controls. Footer links explicitly distinguish the temporary
sample from the authenticated local demo account and retain privacy and
return-to-app links. These links point to the canonical loopback application;
this is a local-only theme, not a ready-to-deploy hosted identity theme.

### Make the local demo shortcut a username hint only

The sign-in page shows **Use local demo account** only when all three conditions
match exactly:

- `AUTOPAY_GUARD_RUNTIME_MODE=LOCAL`;
- `AUTH_URL=http://localhost:3000`; and
- `AUTH_KEYCLOAK_ISSUER=http://localhost:8081/realms/autopay-guard`.

The server action repeats these checks; hiding a button is not the guard. The
action starts the normal Keycloak flow with
`login_hint=demo@autopayguard.local` and `prompt=login`, so a different existing
provider session cannot silently substitute for the requested login. The user
still enters the existing local password on Keycloak's page. Callback paths
continue through the existing safe-return and account-continuation helpers.

No password is embedded in source, HTML, query parameters or the action, and no
new identity, token-minting shortcut, grant, role or authentication bypass is
added. Keycloak's normal PKCE/state/nonce and credential checks remain in place.
The shortcut neither provisions a missing fixture nor changes its password.

The existing demo account is a shared **local fixture**, not an isolated guest
session. Its authorized changes persist in the same local workspace and can be
seen by later sessions using that identity. Use fictional data only. `/demo`
continues to keep each tab's independent sample in memory and reset on refresh.
The helper grants no new authority: ordinary USER features remain available,
privileged staff roles remain separate and reserved-fixture deletion stays
blocked.

### Activate presentation separately from fixture reconciliation

Compose mounts the theme directory read-only. Initial local realm configuration
and the existing policy reconciler name the new theme. For a running existing
realm, `scripts/apply-local-login-theme.mjs` offers a narrower operator path:
validate canonical local configuration, authenticate the local administrator,
verify that the mounted login theme exists, and update only the realm's
`loginTheme` property. It then verifies that property and emits no credentials
or provider response bodies.

A newly added Compose mount requires recreating only the Keycloak container;
the PostgreSQL volume must be retained. A restart alone does not add a mount.
Do not run the general `up`/`seed` helpers solely to change appearance: they
also reconcile local fixture identity/credential state, and seed can modify
fixture data. The dedicated operator script does not reconcile users, passwords,
roles, registration, SMTP or sessions. Container recreation can temporarily
interrupt in-flight sign-in; begin again from the app instead of reusing an old
authorization URL.

## Verification approach

Test the exact local-only visibility and action guards, username hint, forced
login prompt, safe callback continuation and absence of passwords in the page.
Test the operator script's fail-closed environment validation, theme presence,
minimal realm update and credential-free diagnostics.
Test the presentation script on loading, interactive and complete documents,
ensuring it removes only positive tab indexes without accessing form values.

Use the real local provider to inspect desktop/mobile login, closed registration
and recovery-form rendering, including keyboard focus, password visibility,
error handling, contrast and horizontal overflow. Do not submit account creation
or a demo-password reset under the current mode. Registration, password-update
and verification journeys belong to the historical separately enabled rehearsal.
Confirm that the existing demo account still completes the normal OIDC flow and
that existing fixture data is retained. Run the repository quality gate and record
actual integrated results in `STATUS.md` and `CODEX_RESULT.md`; this ADR does not
claim a new full-suite pass.

## Consequences and stop condition

- The identity pages match the application without maintaining a fork of
  security-sensitive authentication templates.
- Keycloak upgrades require renewed theme/layout and authentication-flow
  verification, even though forms are inherited.
- The local demo shortcut reduces typing but deliberately still requires a
  password. It is not a public one-click full-app demo.
- The memory-only sample remains the credential-free experience, with its
  existing bounded features and reset-on-refresh behavior.
- No credential reset, fixture seed, real data, vendor integration, deployment
  or public shared-account operation is part of this decision. Private Beta
  remains separately gated.

## References

- [Keycloak theme customization](https://www.keycloak.org/ui-customization/themes)
- [Keycloak 26.7.0 inherited layout](https://github.com/keycloak/keycloak/blob/26.7.0/themes/src/main/resources/theme/base/login/template.ftl)
- [Keycloak 26.7.0 login form](https://github.com/keycloak/keycloak/blob/26.7.0/themes/src/main/resources/theme/base/login/login.ftl)
- [Keycloak 26.7.0 theme properties](https://github.com/keycloak/keycloak/blob/26.7.0/themes/src/main/resources/theme/keycloak/login/theme.properties)
