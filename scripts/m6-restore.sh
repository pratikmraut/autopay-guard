#!/usr/bin/env bash
set -Eeuo pipefail

m6_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${m6_script_dir}/lib/common.sh"
# shellcheck source=scripts/lib/m6-guard.sh
source "${m6_script_dir}/lib/m6-guard.sh"

cd "${REPO_ROOT}"
require_command docker
require_command find
require_command mktemp
require_command sha256sum
load_local_env
m6_require_environment

m6_internal_drill="false"
m6_parent_lock_directory=""
if [[ "$#" -eq 1 && "$1" == "--internal-drill" ]]; then
  readonly expected_parent_lock_directory="$(
    m6_temporary_root
  )/autopay-guard-milestone6.lock"
  [[ -n "${M6_RESTORE_INTERNAL_LOCK_TOKEN:-}" &&
    "${M6_RESTORE_INTERNAL_LOCK_TOKEN}" =~ ^m6-[0-9]+-[0-9]+-[0-9]+$ ]] ||
    die "The restore drill requires its guarded parent lock token."
  [[ -d "${expected_parent_lock_directory}" &&
    -f "${expected_parent_lock_directory}/owner" ]] ||
    die "The restore drill parent lock is absent."
  recorded_parent_lock_token=""
  IFS= read -r recorded_parent_lock_token \
    <"${expected_parent_lock_directory}/owner" || true
  [[ "${recorded_parent_lock_token}" == "${M6_RESTORE_INTERNAL_LOCK_TOKEN}" ]] ||
    die "The restore drill parent lock token does not match."
  m6_internal_drill="true"
  m6_parent_lock_directory="${expected_parent_lock_directory}"
  shift
elif [[ "$#" -ne 0 ]]; then
  die "m6-restore does not accept a database name or other arguments."
fi

m6_canonical_safety_signature() {
  compose exec -T postgres psql \
    --no-psqlrc \
    --quiet \
    --set=ON_ERROR_STOP=1 \
    --tuples-only \
    --no-align \
    --username "${APP_DB_USER}" \
    --dbname "${M6_CANONICAL_DATABASE}" \
    --command \
      "SELECT current_database() || '|' ||
        (SELECT COUNT(*) FROM users) || '|' ||
        (SELECT COUNT(*) FROM recurring_commitments
          WHERE display_name IN (
            'M2 Fixture Monsoon Utility Demo',
            'M2 Fixture FitClub Demo',
            'M2 Fixture CloudNest Demo',
            'M2 Fixture StreamBox Demo'
          )
          AND status = 'ACTIVE') || '|' ||
        (SELECT COUNT(*) FROM flyway_schema_history
          WHERE version = '6' AND success) || '|' ||
        (SELECT COUNT(*) FROM commitment_import_jobs) || '|' ||
        (SELECT COUNT(*) FROM commitment_import_items) || '|' ||
        (SELECT COUNT(*) FROM commitment_import_item_errors) || '|' ||
        (SELECT COUNT(*) FROM recurring_commitments WHERE source = 'CSV') || '|' ||
        (SELECT COUNT(*) FROM m5_idempotency_records
          WHERE operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM')) || '|' ||
        (SELECT COUNT(*) FROM operation_rate_events
          WHERE operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM')) || '|' ||
        (SELECT COUNT(*) FROM operation_rate_locks
          WHERE operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM')) || '|' ||
        (SELECT COUNT(*) FROM audit_events
          WHERE resource_type = 'IMPORT_JOB');"
}

if [[ "${m6_internal_drill}" != "true" ]]; then
  [[ -z "${M6_RESTORE_FORCE_VALIDATION_FAILURE:-}" ]] ||
    die "m6-restore manages its forced-failure phase; do not set M6_RESTORE_FORCE_VALIDATION_FAILURE."

  m6_acquire_lock
  m6_restore_suite_cleanup() {
    local cleanup_status=$?
    set +e
    if [[ -n "${M6_LOCK_DIRECTORY}" &&
      -f "${M6_LOCK_DIRECTORY}/forced-validation-reached" ]]; then
      rm -f -- "${M6_LOCK_DIRECTORY}/forced-validation-reached" ||
        cleanup_status=1
    fi
    m6_release_lock
    exit "${cleanup_status}"
  }
  trap m6_restore_suite_cleanup EXIT
  export M6_RESTORE_INTERNAL_LOCK_TOKEN="${M6_LOCK_TOKEN}"

  canonical_safety_before="$(m6_canonical_safety_signature)"
  [[ "${canonical_safety_before}" == \
    "autopay_guard|8|4|1|0|0|0|0|0|0|0|0" ]] ||
    die "The canonical database is not the exact clean fake-local restore baseline."

  info "Running the normal disposable restore drill."
  bash "${m6_script_dir}/m6-restore.sh" --internal-drill

  info "Running the forced-failure cleanup drill."
  set +e
  M6_RESTORE_FORCE_VALIDATION_FAILURE="I_ACKNOWLEDGE_FORCED_LOCAL_RESTORE_FAILURE" \
    bash "${m6_script_dir}/m6-restore.sh" --internal-drill
  forced_status=$?
  set -e
  [[ "${forced_status}" -ne 0 ]] ||
    die "The forced restore validation failure unexpectedly passed."

  forced_marker="${M6_LOCK_DIRECTORY}/forced-validation-reached"
  [[ -f "${forced_marker}" ]] ||
    die "The forced restore drill failed before reaching its validation canary."
  forced_marker_token=""
  IFS= read -r forced_marker_token <"${forced_marker}" || true
  [[ "${forced_marker_token}" == "${M6_LOCK_TOKEN}" ]] ||
    die "The forced restore validation canary did not match the suite lock."
  rm -f -- "${forced_marker}"

  restore_database_residue="$(
    compose exec -T postgres psql \
      --no-psqlrc \
      --quiet \
      --set=ON_ERROR_STOP=1 \
      --tuples-only \
      --no-align \
      --username "${POSTGRES_USER}" \
      --dbname postgres \
      --command \
        "SELECT COUNT(*) FROM pg_database WHERE datname LIKE 'autopay_guard_restore_%';"
  )"
  [[ "${restore_database_residue}" == "0" ]] ||
    die "A disposable restore database survived the cleanup drill."

  temporary_root="$(m6_temporary_root)"
  restore_temp_residue="$(
    find "${temporary_root}" \
      -maxdepth 1 \
      -name 'autopay-guard-m6-restore.*' \
      -print \
      -quit
  )"
  [[ -z "${restore_temp_residue}" ]] ||
    die "A bounded restore temporary path survived the cleanup drill."

  canonical_safety_after="$(m6_canonical_safety_signature)"
  [[ "${canonical_safety_after}" == "${canonical_safety_before}" ]] ||
    die "The canonical database changed during the normal or forced restore drill."

  m6_assert_canonical_services_healthy
  info "Milestone 6 normal and forced-failure restore drills passed with deterministic cleanup."
  exit 0
fi

restore_database=""
restore_database_created="false"
restore_work_directory=""
api_was_running="false"

validate_restore_database_name() {
  [[ "$1" =~ ^autopay_guard_restore_[0-9]{10}_[0-9]+_[0-9]+$ ]] ||
    die "The generated restore database name failed its safety policy."
  [[ "$1" != "${M6_CANONICAL_DATABASE}" ]] ||
    die "The canonical database can never be a restore target."
}

postgres_admin() {
  compose exec -T postgres "$@"
}

wait_for_api_health() {
  m6_wait_for_service_health api 120
}

restore_cleanup() {
  local cleanup_status=$?
  set +e

  if [[ "${restore_database_created}" == "true" && -n "${restore_database}" ]]; then
    if [[ "${restore_database}" =~ ^autopay_guard_restore_[0-9]{10}_[0-9]+_[0-9]+$ &&
          "${restore_database}" != "${M6_CANONICAL_DATABASE}" ]]; then
      postgres_admin dropdb \
        --username "${POSTGRES_USER}" \
        --maintenance-db postgres \
        --if-exists \
        --force \
        "${restore_database}" >/dev/null
    else
      printf 'error: refused to clean an invalid restore database name.\n' >&2
      cleanup_status=1
    fi
  fi

  if [[ -n "${restore_work_directory}" &&
        "${restore_work_directory}" == */autopay-guard-m6-restore.* &&
        -d "${restore_work_directory}" ]]; then
    rm -f -- \
      "${restore_work_directory}/autopay_guard.dump" \
      "${restore_work_directory}/autopay_guard.dump.sha256"
    rmdir -- "${restore_work_directory}" 2>/dev/null || cleanup_status=1
  fi

  if [[ "${api_was_running}" == "true" ]]; then
    compose start api >/dev/null
    if ! wait_for_api_health; then
      printf 'error: the API did not become healthy after the restore drill.\n' >&2
      cleanup_status=1
    fi
  fi

  m6_release_lock
  exit "${cleanup_status}"
}
trap restore_cleanup EXIT

m6_assert_canonical_services_healthy

if [[ -n "${M6_RESTORE_FORCE_VALIDATION_FAILURE:-}" &&
      "${M6_RESTORE_FORCE_VALIDATION_FAILURE}" != \
        "I_ACKNOWLEDGE_FORCED_LOCAL_RESTORE_FAILURE" ]]; then
  die "M6_RESTORE_FORCE_VALIDATION_FAILURE has an invalid acknowledgement."
fi

readonly temporary_root="$(m6_temporary_root)"
restore_work_directory="$(
  mktemp -d "${temporary_root%/}/autopay-guard-m6-restore.XXXXXXXX"
)"
[[ -n "${restore_work_directory}" &&
  "${restore_work_directory}" == */autopay-guard-m6-restore.* ]] ||
  die "The restore drill could not create its bounded temporary directory."

readonly dump_path="${restore_work_directory}/autopay_guard.dump"
readonly checksum_path="${restore_work_directory}/autopay_guard.dump.sha256"
restore_database="autopay_guard_restore_$(date +%s)_$$_${RANDOM}"
validate_restore_database_name "${restore_database}"

readonly allowlisted_tables=(
  users
  households
  merchants
  merchant_aliases
  recurring_commitments
  commitment_occurrences
  idempotency_records
  notification_preferences
  reminder_rule_sets
  reminder_rules
  notifications
  notification_deliveries
  outbox_events
  occurrence_decisions
  cancellation_target_allowlist
  cancellation_guides
  cancellation_guide_versions
  cancellation_guide_steps
  cancellation_attempts
  cancellation_attempt_verifications
  savings_events
  cancellation_guide_feedback
  cancellation_guide_locks
  cancellation_published_version_locks
  cancellation_published_step_locks
  cancellation_published_target_locks
  cancellation_target_locks
  household_members
  household_invitations
  privacy_notice_acknowledgements
  privacy_notice_acknowledgement_locks
  consent_events
  consent_event_locks
  privacy_requests
  privacy_request_events
  privacy_request_event_locks
  privacy_export_artifacts
  deletion_tombstones
  cancellation_guide_catalog_state
  cancellation_guide_draft_states
  guide_lifecycle_events
  guide_lifecycle_event_locks
  guide_feedback_reviews
  audit_events
  audit_event_locks
  support_diagnostic_grants
  m5_idempotency_records
  operation_rate_events
  operation_rate_locks
  commitment_import_jobs
  commitment_import_items
  commitment_import_item_errors
)

count_snapshot() {
  local database="$1"
  local table
  local separator=""
  local sql=""

  for table in "${allowlisted_tables[@]}"; do
    sql+="${separator}SELECT '${table}' AS table_name, COUNT(*)::bigint AS row_count FROM ${table}"
    separator=" UNION ALL "
  done
  sql+=" ORDER BY table_name;"

  postgres_admin psql \
    --no-psqlrc \
    --set=ON_ERROR_STOP=1 \
    --tuples-only \
    --no-align \
    --field-separator='|' \
    --username "${APP_DB_USER}" \
    --dbname "${database}" \
    --command "${sql}"
}

migration_snapshot() {
  local database="$1"
  postgres_admin psql \
    --no-psqlrc \
    --set=ON_ERROR_STOP=1 \
    --tuples-only \
    --no-align \
    --field-separator='|' \
    --username "${APP_DB_USER}" \
    --dbname "${database}" \
    --command \
      'SELECT installed_rank, version, script, checksum, success FROM flyway_schema_history ORDER BY installed_rank;'
}

canonical_scalar() {
  local sql="$1"
  postgres_admin psql \
    --no-psqlrc \
    --set=ON_ERROR_STOP=1 \
    --tuples-only \
    --no-align \
    --username "${APP_DB_USER}" \
    --dbname "${M6_CANONICAL_DATABASE}" \
    --command "${sql}"
}

api_was_running="true"
compose stop --timeout 30 api >/dev/null

non_fake_users="$(
  canonical_scalar \
    "SELECT COUNT(*) FROM users WHERE email NOT LIKE '%@autopayguard.local' AND email NOT LIKE '%.example.test';"
)"
[[ "${non_fake_users}" == "0" ]] ||
  die "The canonical database contains a non-fake identity; the local drill refused to copy it."

fake_user_count="$(
  canonical_scalar \
    "SELECT COUNT(*) FROM users WHERE email LIKE '%@autopayguard.local' OR email LIKE '%.example.test';"
)"
[[ "${fake_user_count}" == "8" ]] ||
  die "The restore drill requires exactly eight fake-local database identities."

import_residue="$(
  canonical_scalar \
    "SELECT
       (SELECT COUNT(*) FROM commitment_import_jobs) || '|' ||
       (SELECT COUNT(*) FROM commitment_import_items) || '|' ||
       (SELECT COUNT(*) FROM commitment_import_item_errors) || '|' ||
       (SELECT COUNT(*) FROM recurring_commitments WHERE source = 'CSV');"
)"
[[ "${import_residue}" == "0|0|0|0" ]] ||
  die "The restore drill requires the cleaned M6 baseline with no import provenance."

raw_import_residue="$(
  canonical_scalar \
    'SELECT COUNT(*) FROM commitment_import_jobs WHERE raw_payload IS NOT NULL;'
)"
[[ "${raw_import_residue}" == "0" ]] ||
  die "The restore drill refuses to create a dump containing retained raw CSV."

m6_control_residue="$(
  canonical_scalar \
    "SELECT
       (SELECT COUNT(*) FROM m5_idempotency_records
         WHERE operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM')) || '|' ||
       (SELECT COUNT(*) FROM operation_rate_events
         WHERE operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM')) || '|' ||
       (SELECT COUNT(*) FROM operation_rate_locks
         WHERE operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM')) || '|' ||
       (SELECT COUNT(*) FROM audit_events
         WHERE resource_type = 'IMPORT_JOB');"
)"
[[ "${m6_control_residue}" == "0|0|0|0" ]] ||
  die "The restore drill requires no import idempotency, rate, lock, or audit residue."

canonical_counts="$(count_snapshot "${M6_CANONICAL_DATABASE}")"
canonical_migrations="$(migration_snapshot "${M6_CANONICAL_DATABASE}")"
v6_migration_count="$(
  canonical_scalar \
    "SELECT COUNT(*) FROM flyway_schema_history WHERE version = '6' AND success;"
)"
[[ "${v6_migration_count}" == "1" ]] ||
  die "The canonical database does not contain one successful V6 migration."

info "Creating a read-only logical dump of the canonical fake-local database."
postgres_admin pg_dump \
  --username "${APP_DB_USER}" \
  --dbname "${M6_CANONICAL_DATABASE}" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  >"${dump_path}"
[[ -s "${dump_path}" ]] || die "The PostgreSQL dump is empty."
sha256sum "${dump_path}" >"${checksum_path}"
sha256sum --check "${checksum_path}" >/dev/null

database_exists="$(
  # restore_database already passed the strict generated-name policy above, so
  # it contains only the fixed prefix, digits, and underscores.
  postgres_admin psql \
    --no-psqlrc \
    --set=ON_ERROR_STOP=1 \
    --tuples-only \
    --no-align \
    --username "${POSTGRES_USER}" \
    --dbname postgres \
    --command \
      "SELECT COUNT(*) FROM pg_database WHERE datname = '${restore_database}';"
)"
[[ "${database_exists}" == "0" ]] ||
  die "The generated disposable database already exists."

postgres_admin createdb \
  --username "${POSTGRES_USER}" \
  --maintenance-db postgres \
  --owner "${APP_DB_USER}" \
  --template template0 \
  "${restore_database}"
restore_database_created="true"

postgres_admin pg_restore \
  --username "${APP_DB_USER}" \
  --dbname "${restore_database}" \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-privileges \
  <"${dump_path}"

if [[ "${M6_RESTORE_FORCE_VALIDATION_FAILURE:-}" == \
  "I_ACKNOWLEDGE_FORCED_LOCAL_RESTORE_FAILURE" ]]; then
  (
    umask 077
    printf '%s\n' "${M6_RESTORE_INTERNAL_LOCK_TOKEN}" \
      >"${m6_parent_lock_directory}/forced-validation-reached"
  )
  die "Forced restore validation failure requested after restore."
fi

restored_counts="$(count_snapshot "${restore_database}")"
restored_migrations="$(migration_snapshot "${restore_database}")"
[[ "${restored_counts}" == "${canonical_counts}" ]] ||
  die "The restored allowlisted table counts differ from the dump source."
[[ "${restored_migrations}" == "${canonical_migrations}" ]] ||
  die "The restored Flyway history differs from the dump source."

unvalidated_foreign_keys="$(
  postgres_admin psql \
    --no-psqlrc \
    --set=ON_ERROR_STOP=1 \
    --tuples-only \
    --no-align \
    --username "${APP_DB_USER}" \
    --dbname "${restore_database}" \
    --command \
      "SELECT COUNT(*) FROM pg_constraint WHERE contype = 'f' AND NOT convalidated;"
)"
[[ "${unvalidated_foreign_keys}" == "0" ]] ||
  die "The restored database contains an unvalidated foreign key."

canonical_fixture_count="$(
  postgres_admin psql \
    --no-psqlrc \
    --set=ON_ERROR_STOP=1 \
    --tuples-only \
    --no-align \
    --username "${APP_DB_USER}" \
    --dbname "${restore_database}" \
    --command \
      "SELECT COUNT(*) FROM recurring_commitments WHERE display_name IN ('M2 Fixture Monsoon Utility Demo', 'M2 Fixture FitClub Demo', 'M2 Fixture CloudNest Demo', 'M2 Fixture StreamBox Demo') AND status = 'ACTIVE';"
)"
[[ "${canonical_fixture_count}" == "4" ]] ||
  die "The restored database does not contain the four canonical active fixtures."

dump_digest="$(cut -d' ' -f1 "${checksum_path}")"
info "Milestone 6 local restore drill passed."
info "Disposable database: validated and scheduled for trap cleanup."
info "Allowlisted tables: ${#allowlisted_tables[@]}"
info "Dump SHA-256: ${dump_digest}"
