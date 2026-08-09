#!/usr/bin/env bash

set -Eeuo pipefail

readonly M6_ACCEPTANCE_ACK_VALUE="I_ACKNOWLEDGE_LOCAL_FAKE_M6_ACCEPTANCE"
readonly M6_LOAD_ACK_VALUE="I_ACKNOWLEDGE_BOUNDED_LOCAL_FAKE_M6_LOAD"
readonly M6_CANONICAL_PROJECT="autopay-guard"
readonly M6_CANONICAL_WEB_URL="http://localhost:3000"
readonly M6_CANONICAL_ISSUER="http://localhost:8081/realms/autopay-guard"
readonly M6_CANONICAL_DATABASE="autopay_guard"
readonly M6_CANONICAL_DATABASE_ADMIN="autopay_guard_admin"
readonly M6_CANONICAL_DATABASE_APP_USER="autopay_guard"

M6_LOCK_DIRECTORY=""
M6_LOCK_TOKEN=""

m6_temporary_root() {
  local temporary_root="${TMPDIR:-${TEMP:-/tmp}}"

  [[ -n "${temporary_root}" ]] || die "A temporary directory is required."
  if [[ "${temporary_root}" =~ ^[A-Za-z]:[\\/].* ]]; then
    command -v cygpath >/dev/null 2>&1 ||
      die "Git Bash cygpath is required to normalize the Windows temporary directory."
    temporary_root="$(cygpath --unix "${temporary_root}")"
  fi
  [[ "${temporary_root}" == /* && -d "${temporary_root}" ]] ||
    die "The normalized temporary root is not an existing absolute directory."
  printf '%s\n' "${temporary_root%/}"
}

m6_require_exact_environment() {
  local name="$1"
  local expected="$2"
  local actual="${!name:-}"

  [[ -n "${actual}" ]] || die "${name} is required for Milestone 6 acceptance."
  [[ "${actual}" == "${expected}" ]] ||
    die "${name} must equal the canonical fake-local value."
}

m6_require_fake_identity() {
  local name="$1"
  local expected="$2"
  local actual="${!name:-}"

  [[ -n "${actual}" ]] || die "${name} is required for Milestone 6 acceptance."
  [[ "${actual}" == "${expected}" ]] ||
    die "${name} must identify the canonical fake-local account."
}

m6_require_environment() {
  [[ "${M6_LIVE_ACCEPTANCE_ACK:-}" == "${M6_ACCEPTANCE_ACK_VALUE}" ]] ||
    die "Set M6_LIVE_ACCEPTANCE_ACK=${M6_ACCEPTANCE_ACK_VALUE} to authorize this guarded fake-local operation."

  m6_require_exact_environment COMPOSE_PROJECT_NAME "${M6_CANONICAL_PROJECT}"
  m6_require_exact_environment AUTH_URL "${M6_CANONICAL_WEB_URL}"
  m6_require_exact_environment AUTH_KEYCLOAK_ISSUER "${M6_CANONICAL_ISSUER}"
  m6_require_exact_environment POSTGRES_DB "${M6_CANONICAL_DATABASE}"
  m6_require_exact_environment POSTGRES_USER "${M6_CANONICAL_DATABASE_ADMIN}"
  m6_require_exact_environment APP_DB_USER "${M6_CANONICAL_DATABASE_APP_USER}"

  m6_require_fake_identity \
    KEYCLOAK_FAKE_USER_USERNAME \
    "demo@autopayguard.local"
  m6_require_fake_identity \
    KEYCLOAK_FAKE_MEMBER_USERNAME \
    "member@autopayguard.local"
  m6_require_fake_identity \
    KEYCLOAK_FAKE_FOREIGN_USERNAME \
    "foreign@autopayguard.local"
  m6_require_fake_identity \
    KEYCLOAK_FAKE_GUIDE_ADMIN_USERNAME \
    "admin@autopayguard.local"
  m6_require_fake_identity \
    KEYCLOAK_FAKE_PRIVACY_ADMIN_USERNAME \
    "privacy-admin@autopayguard.local"
  m6_require_fake_identity \
    KEYCLOAK_FAKE_AUDIT_READ_USERNAME \
    "audit-reader@autopayguard.local"
  m6_require_fake_identity \
    KEYCLOAK_FAKE_SUPPORT_USERNAME \
    "support@autopayguard.local"
  m6_require_fake_identity \
    KEYCLOAK_FAKE_DELETION_USERNAME \
    "deletion@autopayguard.local"
}

m6_require_load_acknowledgement() {
  [[ "${M6_LOAD_ACCEPTANCE_ACK:-}" == "${M6_LOAD_ACK_VALUE}" ]] ||
    die "Set M6_LOAD_ACCEPTANCE_ACK=${M6_LOAD_ACK_VALUE} to authorize bounded local load."
}

m6_acquire_lock() {
  local temporary_root
  temporary_root="$(m6_temporary_root)"

  M6_LOCK_DIRECTORY="${temporary_root}/autopay-guard-milestone6.lock"
  M6_LOCK_TOKEN="m6-$$-${RANDOM}-$(date +%s)"

  if ! mkdir -- "${M6_LOCK_DIRECTORY}" 2>/dev/null; then
    die "Another Milestone 6 operation may be running. After checking processes, remove the stale lock at ${M6_LOCK_DIRECTORY}."
  fi

  (
    umask 077
    printf '%s\n%s\n' "${M6_LOCK_TOKEN}" "$$" \
      >"${M6_LOCK_DIRECTORY}/owner"
  )
}

m6_release_lock() {
  local owner_file
  local recorded_token

  [[ -n "${M6_LOCK_DIRECTORY}" && -n "${M6_LOCK_TOKEN}" ]] || return 0
  owner_file="${M6_LOCK_DIRECTORY}/owner"
  recorded_token=""
  if [[ -f "${owner_file}" ]]; then
    IFS= read -r recorded_token <"${owner_file}" || true
  fi
  if [[ "${recorded_token}" == "${M6_LOCK_TOKEN}" ]]; then
    rm -f -- "${owner_file}"
    rmdir -- "${M6_LOCK_DIRECTORY}" 2>/dev/null || true
  fi
  M6_LOCK_DIRECTORY=""
  M6_LOCK_TOKEN=""
}

m6_running_services() {
  compose ps --status running --services | LC_ALL=C sort
}

m6_assert_canonical_services_running() {
  local expected
  local actual

  expected=$'api\nkeycloak\nmailpit\npostgres\nweb'
  actual="$(m6_running_services)"
  [[ "${actual}" == "${expected}" ]] ||
    die "Exactly the five canonical local services must be running."
}

m6_assert_service_healthy() {
  local service="$1"
  local container_id
  local health

  container_id="$(compose ps -q "${service}")"
  [[ -n "${container_id}" ]] || die "The ${service} service is not running."
  health="$(
    docker inspect \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' \
      "${container_id}"
  )"
  [[ "${health}" == "healthy" ]] ||
    die "The ${service} service is not healthy."
}

m6_wait_for_service_health() {
  local service="$1"
  local timeout_seconds="$2"
  local deadline
  local container_id
  local health
  local remaining

  [[ "${service}" =~ ^(api|keycloak|mailpit|postgres|web)$ ]] ||
    die "The requested Milestone 6 health service is not allowlisted."
  [[ "${timeout_seconds}" =~ ^[0-9]+$ &&
    "${timeout_seconds}" -ge 1 &&
    "${timeout_seconds}" -le 300 ]] ||
    die "The Milestone 6 health timeout must be between 1 and 300 seconds."

  deadline=$((SECONDS + timeout_seconds))
  while ((SECONDS < deadline)); do
    container_id="$(compose ps -q "${service}")"
    if [[ -n "${container_id}" ]]; then
      health="$(
        docker inspect \
          --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' \
          "${container_id}" 2>/dev/null || true
      )"
      if [[ "${health}" == "healthy" ]]; then
        return 0
      fi
    fi
    remaining=$((deadline - SECONDS))
    if ((remaining > 0)); then
      sleep "$((remaining < 2 ? remaining : 2))"
    fi
  done
  return 1
}

m6_assert_canonical_services_healthy() {
  local service
  m6_assert_canonical_services_running
  for service in postgres keycloak mailpit api web; do
    m6_assert_service_healthy "${service}"
  done
}
