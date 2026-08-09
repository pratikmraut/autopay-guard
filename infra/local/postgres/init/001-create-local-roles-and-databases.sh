#!/usr/bin/env bash
set -Eeuo pipefail

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${APP_DB_USER:?APP_DB_USER is required}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"
: "${KEYCLOAK_DB_USER:?KEYCLOAK_DB_USER is required}"
: "${KEYCLOAK_DB_NAME:?KEYCLOAK_DB_NAME is required}"
: "${KEYCLOAK_DB_PASSWORD:?KEYCLOAK_DB_PASSWORD is required}"

# psql's identifier/literal interpolation keeps generated values quoted even if
# a developer chooses values other than the bootstrap script's hex strings.
psql \
  --set=ON_ERROR_STOP=1 \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" \
  --set=app_user="${APP_DB_USER}" \
  --set=app_database="${POSTGRES_DB}" \
  --set=app_password="${APP_DB_PASSWORD}" \
  --set=keycloak_user="${KEYCLOAK_DB_USER}" \
  --set=keycloak_database="${KEYCLOAK_DB_NAME}" \
  --set=keycloak_password="${KEYCLOAK_DB_PASSWORD}" <<'SQL'
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
  :'app_user',
  :'app_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = :'app_user'
)\gexec

SELECT format(
  'ALTER DATABASE %I OWNER TO %I',
  :'app_database',
  :'app_user'
)\gexec

SELECT format(
  'ALTER SCHEMA public OWNER TO %I',
  :'app_user'
)\gexec

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L',
  :'keycloak_user',
  :'keycloak_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = :'keycloak_user'
)\gexec

SELECT format(
  'CREATE DATABASE %I OWNER %I',
  :'keycloak_database',
  :'keycloak_user'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_database WHERE datname = :'keycloak_database'
)\gexec
SQL
