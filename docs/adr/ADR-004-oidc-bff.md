# ADR-004: Use OIDC authorization code with a web BFF

- Status: Accepted
- Date: 2026-07-26

## Context

A browser-held bearer/refresh token is exposed to XSS and client-side leakage.
The responsive web application needs an OIDC integration that can delegate MFA
and passkeys to the identity provider without building identity storage.

## Decision

Use OIDC authorization code with PKCE. Next.js acts as a backend for frontend
and maintains the session in an encrypted Secure (outside local development),
HttpOnly, SameSite cookie. Tokens are used only on the server and are never
stored in browser local/session storage or rendered to the client.

Spring Boot is an OAuth2 resource server. It validates issuer, signature,
expiry, and audience, and maps immutable `sub` to the local user. Object-level
authorization is based on the local user ID, not mutable email.

## Consequences

The BFF becomes a security boundary and must validate redirect targets, protect
cookie-authenticated mutations from CSRF, rotate/expire sessions, redact
cookies/tokens, and handle provider logout. Server-side API calls add one hop
but keep credentials out of browser JavaScript.
