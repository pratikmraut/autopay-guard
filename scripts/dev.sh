#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${script_dir}/lib/common.sh"

cd "${REPO_ROOT}"
require_command pnpm
load_local_env
bash "${script_dir}/compose.sh" infra

export SPRING_DATASOURCE_URL="jdbc:postgresql://localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-autopay_guard}"
export SPRING_DATASOURCE_USERNAME="${APP_DB_USER:-autopay_guard}"
export SPRING_DATASOURCE_PASSWORD="${APP_DB_PASSWORD}"
export SPRING_PROFILES_ACTIVE="dev"
export OIDC_ISSUER_URI="http://localhost:${KEYCLOAK_PORT:-8081}/realms/autopay-guard"
export OIDC_AUDIENCE="${OIDC_AUDIENCE:-autopay-guard-api}"
unset OIDC_JWK_SET_URI || true
export SPRING_MAIL_HOST="127.0.0.1"
export SPRING_MAIL_PORT="${MAILPIT_SMTP_PORT:-1025}"
export NOTIFICATION_EMAIL_MODE="${NOTIFICATION_EMAIL_MODE:-MAILPIT}"
export NOTIFICATION_FROM_ADDRESS="${NOTIFICATION_FROM_ADDRESS:-no-reply@autopayguard.local}"
export NOTIFICATION_ALLOWED_RECIPIENT_SUFFIXES="${NOTIFICATION_ALLOWED_RECIPIENT_SUFFIXES:-@autopayguard.local,.example.test}"
export NOTIFICATION_GENERATOR_CRON="${NOTIFICATION_GENERATOR_CRON:-0 */1 * * * *}"
export NOTIFICATION_WORKER_CRON="${NOTIFICATION_WORKER_CRON:-*/5 * * * * *}"
export NOTIFICATION_RECONCILIATION_CRON="${NOTIFICATION_RECONCILIATION_CRON:-0 */5 * * * *}"

export AUTH_KEYCLOAK_ID="${KEYCLOAK_WEB_CLIENT_ID:-autopay-guard-web}"
export AUTOPAY_GUARD_RUNTIME_MODE="LOCAL"
export AUTH_KEYCLOAK_SECRET="${KEYCLOAK_WEB_CLIENT_SECRET}"
export AUTH_KEYCLOAK_ISSUER="http://localhost:${KEYCLOAK_PORT:-8081}/realms/autopay-guard"
export AUTH_KEYCLOAK_INTERNAL_ISSUER="${AUTH_KEYCLOAK_ISSUER}"
export AUTH_URL="http://localhost:${WEB_PORT:-3000}"
export API_BASE_URL="http://localhost:${API_PORT:-8080}"

api_pid=""
web_pid=""
cleanup() {
  trap - EXIT INT TERM
  [[ -n "${web_pid}" ]] && kill "${web_pid}" 2>/dev/null || true
  [[ -n "${api_pid}" ]] && kill "${api_pid}" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

info "Starting API and web development servers. Press Ctrl-C to stop them."
run_maven --batch-mode --no-transfer-progress spring-boot:run &
api_pid="$!"
pnpm --dir apps/web dev &
web_pid="$!"

wait -n "${api_pid}" "${web_pid}"
