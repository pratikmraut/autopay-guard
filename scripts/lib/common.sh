#!/usr/bin/env bash

set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "${script_dir}/../.." && pwd)"
readonly ENV_FILE="${REPO_ROOT}/.env"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

info() {
  printf '%s\n' "$*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command '$1' was not found on PATH."
}

load_local_env() {
  [[ -f "${ENV_FILE}" ]] || die "Missing .env. Run 'make bootstrap' first."

  set -a
  # `.env` is generated locally from fixed keys and hex-only secret values.
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
}

compose() {
  docker compose \
    --project-directory "${REPO_ROOT}" \
    --env-file "${ENV_FILE}" \
    --file "${REPO_ROOT}/compose.yaml" \
    "$@"
}

run_maven() {
  if [[ "${OS:-}" == "Windows_NT" && -f "${REPO_ROOT}/services/api/mvnw.cmd" ]]; then
    (
      cd "${REPO_ROOT}/services/api"
      ./mvnw.cmd "$@"
    )
  else
    (
      cd "${REPO_ROOT}/services/api"
      ./mvnw "$@"
    )
  fi
}
