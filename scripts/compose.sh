#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${script_dir}/lib/common.sh"

cd "${REPO_ROOT}"
require_command docker
require_command node
load_local_env

case "${1:-}" in
  up)
    docker info >/dev/null 2>&1 ||
      die "The container engine is not reachable. Start Rancher Desktop (Moby) or Docker Desktop and retry."
    compose up --build --detach --wait --wait-timeout 240
    node "${REPO_ROOT}/scripts/validate-keycloak-seed.mjs"
    info "Local stack is ready:"
    info "  Web:      http://localhost:${WEB_PORT:-3000}"
    info "  API:      http://localhost:${API_PORT:-8080}"
    info "  Keycloak: http://localhost:${KEYCLOAK_PORT:-8081}"
    info "  Mailpit:  http://localhost:${MAILPIT_UI_PORT:-8025}"
    ;;
  down)
    compose down --remove-orphans
    ;;
  infra)
    docker info >/dev/null 2>&1 ||
      die "The container engine is not reachable. Start Rancher Desktop (Moby) or Docker Desktop and retry."
    compose up --detach --wait --wait-timeout 180 postgres keycloak mailpit
    node "${REPO_ROOT}/scripts/validate-keycloak-seed.mjs"
    ;;
  *)
    die "Usage: scripts/compose.sh {up|down|infra}"
    ;;
esac
