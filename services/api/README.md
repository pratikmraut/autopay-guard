# AutoPay Guard API

Java 21 / Spring Boot 4.1 modular-monolith API for Foundation Milestone 1.
Only identity mapping and owned households are implemented.

## Configuration

The default profile does not create local users implicitly. Local fake-user
mapping is enabled only by the `dev` profile (and the isolated `test` profile).

Required runtime configuration:

- `SPRING_DATASOURCE_PASSWORD`
- `OIDC_ISSUER_URI` (defaults to the local Keycloak issuer)
- `OIDC_JWK_SET_URI` (optional internal Docker JWKS address)
- `OIDC_AUDIENCE` (defaults to `autopay-guard-api`)
- `OIDC_AUTHORIZED_PARTY` (defaults to the `autopay-guard-web` BFF client)
- `PRIVACY_NOTICE_VERSION` (defaults to `foundation-v1`)

Docker development must set `SPRING_PROFILES_ACTIVE=dev`.

## Verification

From this directory:

```text
./mvnw test
./mvnw verify
```

`test` runs the fast H2 migration, endpoint, authorization, JWT, configuration,
and OpenAPI drift suites. `verify` additionally runs
`PostgresMigrationIT` against `postgres:18.4-alpine`; that test is explicitly
skipped when Docker is unavailable.

The committed client-generation source is `openapi/openapi.json`.
