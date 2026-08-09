#!/usr/bin/env bash
set -Eeuo pipefail

m6_seed_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${m6_seed_script_dir}/lib/common.sh"
# shellcheck source=scripts/lib/m6-guard.sh
source "${m6_seed_script_dir}/lib/m6-guard.sh"

cd "${REPO_ROOT}"
require_command docker
require_command sha256sum
load_local_env

m6_require_exact_environment COMPOSE_PROJECT_NAME "${M6_CANONICAL_PROJECT}"
m6_require_exact_environment AUTH_URL "${M6_CANONICAL_WEB_URL}"
m6_require_exact_environment AUTH_KEYCLOAK_ISSUER "${M6_CANONICAL_ISSUER}"
m6_require_exact_environment POSTGRES_DB "${M6_CANONICAL_DATABASE}"
m6_require_exact_environment POSTGRES_USER "${M6_CANONICAL_DATABASE_ADMIN}"
m6_require_exact_environment APP_DB_USER "${M6_CANONICAL_DATABASE_APP_USER}"
m6_require_fake_identity \
  KEYCLOAK_FAKE_USER_USERNAME \
  "demo@autopayguard.local"

m6_acquire_lock
api_was_running="false"
m6_seed_cleanup() {
  local cleanup_status=$?
  set +e
  if [[ "${api_was_running}" == "true" ]]; then
    compose start api >/dev/null
    if ! m6_wait_for_service_health api 120; then
      printf 'error: the API did not become healthy after M6 seed cleanup.\n' >&2
      cleanup_status=1
    fi
  fi
  m6_release_lock
  exit "${cleanup_status}"
}
trap m6_seed_cleanup EXIT

m6_assert_service_healthy postgres
m6_assert_service_healthy api
api_was_running="true"
compose stop --timeout 30 api >/dev/null

readonly canonical_owner_subject="11111111-1111-4111-8111-111111111111"
readonly canonical_owner_actor_digest="$(
  printf '%s' \
    "autopay-guard/operation-rate/v1:${canonical_owner_subject}" |
    sha256sum
)"
readonly canonical_owner_actor_key="${canonical_owner_actor_digest%% *}"
[[ "${canonical_owner_actor_key}" =~ ^[0-9a-f]{64}$ ]] ||
  die "The canonical fake-owner rate key could not be derived."

baseline="$(
  compose exec -T postgres \
    psql \
    --username "${POSTGRES_USER}" \
    --dbname "${POSTGRES_DB}" \
    --set ON_ERROR_STOP=1 \
    --quiet \
    --tuples-only \
    --no-align <<SQL
BEGIN;

DO \$guard\$
DECLARE
  canonical_owner_count INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO canonical_owner_count
    FROM users
   WHERE lower(email) = 'demo@autopayguard.local'
     AND oidc_subject = '${canonical_owner_subject}';

  IF canonical_owner_count <> 1 THEN
    RAISE EXCEPTION
      'Milestone 6 seed cleanup requires exactly one canonical fake owner';
  END IF;
END
\$guard\$;

CREATE TEMP TABLE m6_seed_owner ON COMMIT DROP AS
SELECT id
  FROM users
 WHERE lower(email) = 'demo@autopayguard.local'
   AND oidc_subject = '${canonical_owner_subject}';

CREATE TEMP TABLE m6_seed_jobs ON COMMIT DROP AS
SELECT id
  FROM commitment_import_jobs
 WHERE owner_user_id = (SELECT id FROM m6_seed_owner);

DELETE FROM audit_event_locks
 WHERE id IN (
   SELECT id
    FROM audit_events
   WHERE actor_user_id = (SELECT id FROM m6_seed_owner)
      AND (
        resource_type = 'IMPORT_JOB'
        OR left(action, 7) = 'IMPORT_'
      )
 );

DELETE FROM audit_events
 WHERE actor_user_id = (SELECT id FROM m6_seed_owner)
   AND (
     resource_type = 'IMPORT_JOB'
     OR left(action, 7) = 'IMPORT_'
   );

DELETE FROM m5_idempotency_records
 WHERE actor_user_id = (SELECT id FROM m6_seed_owner)
   AND operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM');

DELETE FROM operation_rate_events
 WHERE actor_key = '${canonical_owner_actor_key}'
   AND operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM');

DELETE FROM operation_rate_locks
 WHERE actor_key = '${canonical_owner_actor_key}'
   AND operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM');

UPDATE commitment_import_items
   SET selected = NULL,
       created_commitment_id = NULL,
       updated_at = CURRENT_TIMESTAMP
 WHERE import_job_id IN (SELECT id FROM m6_seed_jobs);

DELETE FROM recurring_commitments
 WHERE data_owner_user_id = (SELECT id FROM m6_seed_owner)
   AND source = 'CSV';

DELETE FROM commitment_import_jobs
 WHERE id IN (SELECT id FROM m6_seed_jobs)
   AND owner_user_id = (SELECT id FROM m6_seed_owner);

SELECT
  (SELECT COUNT(*) FROM commitment_import_jobs) || '|' ||
  (SELECT COUNT(*) FROM commitment_import_items) || '|' ||
  (SELECT COUNT(*) FROM commitment_import_item_errors) || '|' ||
  (SELECT COUNT(*) FROM recurring_commitments WHERE source = 'CSV') || '|' ||
  (SELECT COUNT(*) FROM audit_events
    WHERE resource_type = 'IMPORT_JOB'
       OR left(action, 7) = 'IMPORT_') || '|' ||
  (SELECT COUNT(*) FROM audit_event_locks
    WHERE resource_type = 'IMPORT_JOB'
       OR left(action, 7) = 'IMPORT_') || '|' ||
  (SELECT COUNT(*) FROM m5_idempotency_records
    WHERE operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM')) || '|' ||
  (SELECT COUNT(*) FROM operation_rate_events
    WHERE operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM')) || '|' ||
  (SELECT COUNT(*) FROM operation_rate_locks
    WHERE operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM')) || '|' ||
  (SELECT COUNT(*) FROM recurring_commitments
    WHERE data_owner_user_id = (SELECT id FROM m6_seed_owner)
      AND status = 'ACTIVE'
      AND source = 'MANUAL');

COMMIT;
SQL
)"

[[ "${baseline}" == "0|0|0|0|0|0|0|0|0|4" ]] ||
  die "Milestone 6 seed cleanup did not produce the exact four-commitment fake-local baseline."

compose start api >/dev/null
m6_wait_for_service_health api 120 ||
  die "The API did not become healthy after M6 seed cleanup."
api_was_running="false"

info "Removed canonical fake-owner Milestone 6 residue and verified zero jobs, items, errors, CSV commitments, import audit/idempotency/rate/lock rows."
