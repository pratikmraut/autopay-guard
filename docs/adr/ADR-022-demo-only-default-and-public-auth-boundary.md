# ADR-022: demo-only default and public authentication boundary

Date: 2026-09-16. Status: accepted for fake-local implementation.

## Context

The user wants a reusable full-app demo with the existing username/password,
no new-user flow, preserved data, documentation and sanitized Git publication.
They also requested a review of committed code and GitHub main protection.

## Decision

- Disable registration by default across bootstrap, imported realm, Compose,
  API, BFF and web, and close new app enrollment in the current runtime. Keep
  historical rehearsal code guarded; do not enable it for routine demo testing.
- Offer the existing demo first. Keep normal password-required OIDC, canonical
  LOCAL/localhost guards and persistent database state. Never publish passwords.
- Close an existing realm with a narrowly validated, minimal-field operator;
  do not reseed, delete users, reset passwords or combine staff roles.
- Preserve ordinary USER features and explicit staff/household permissions.
  Privileged staff tools require their separate existing identities and roles;
  "full demo" is not a grant of administrative authority. Deletion protection
  for the reserved fixture remains intentional.
- Public Auth.js route delegation uses a canonical action/method allowlist.
  Session endpoints and normalization aliases must never return BFF tokens.
  Server-side `auth()` still supplies tokens only to server-side callers.
- Check development dependencies as well as production dependencies. Record
  history/source scan coverage and environmental limitations, not a claim that
  automated checks prove an absence of breaches.
- Keep the existing password and data unchanged. Routine stop/start must retain
  containers and volumes; fixture reconciliation is not a login or restart step.

## Consequences

Existing non-demo fixture identities are preserved, but new registration is
closed. This is local operation, not authorization for publicly shared writable
credentials, real financial data, production deployment or user enrollment.
GitHub branch protection is a separate external setting; source changes alone
cannot enable it. Its actual state must be verified before claiming completion.
Current checks, dependency/image findings and any remaining limitations are
recorded in `STATUS.md`, `CODEX_RESULT.md` and the dated security-review report;
historical successful registration tests do not mean registration is open now.
