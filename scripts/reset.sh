#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${script_dir}/lib/common.sh"

cd "${REPO_ROOT}"
require_command docker
load_local_env

if [[ "${1:-}" != "--yes" ]]; then
  if [[ ! -t 0 ]]; then
    die "Reset deletes only AutoPay Guard local containers and volumes. Re-run with --yes."
  fi
  printf 'Delete all AutoPay Guard local database and captured-email data? [y/N] '
  read -r answer
  [[ "${answer}" =~ ^[Yy]$ ]] || {
    info "Reset cancelled."
    exit 0
  }
fi

[[ "${COMPOSE_PROJECT_NAME:-}" == "autopay-guard" ]] ||
  die "Refusing reset: COMPOSE_PROJECT_NAME must be 'autopay-guard'."

info "Deleting AutoPay Guard's named local volumes: postgres_data and mailpit_data."
compose down --volumes --remove-orphans
info "Removed AutoPay Guard local containers, network, and named data volumes."
