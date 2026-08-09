#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${script_dir}/lib/common.sh"

cd "${REPO_ROOT}"

require_command node
require_command pnpm
require_command java
require_command docker

node_version="$(node --version)"
[[ "${node_version}" == v22.19.* ]] ||
  die "Node.js 22.19.x is required; found ${node_version}."

pnpm_version="$(pnpm --version)"
[[ "${pnpm_version}" == 11.9.* ]] ||
  die "pnpm 11.9.x is required; found ${pnpm_version}."

java_major="$(
  java -version 2>&1 |
    awk -F '"' '/version/ { split($2, parts, "."); print parts[1]; exit }'
)"
[[ "${java_major}" == "21" ]] ||
  die "Java 21 is required; found Java ${java_major:-unknown}."

docker compose version >/dev/null 2>&1 ||
  die "Docker Compose v2 is required (the 'docker compose' command)."

random_secret() {
  node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
}

env_has_key() {
  local variable_name="$1"
  grep -q "^${variable_name}=" "${ENV_FILE}"
}

append_env_value_if_missing() {
  local variable_name="$1"
  local value="$2"

  if env_has_key "${variable_name}"; then
    return
  fi

  if [[ "${env_was_backfilled}" == "0" ]]; then
    printf '\n# Reserved fake-local secrets and identities.\n' >>"${ENV_FILE}"
  fi
  printf '%s=%s\n' "${variable_name}" "${value}" >>"${ENV_FILE}"
  env_was_backfilled=1
}

if [[ ! -f "${ENV_FILE}" ]]; then
  postgres_password="$(random_secret)"
  app_db_password="$(random_secret)"
  keycloak_db_password="$(random_secret)"
  keycloak_admin_password="$(random_secret)"
  fake_user_password="$(random_secret)"
  fake_member_password="$(random_secret)"
  fake_foreign_password="$(random_secret)"
  fake_guide_admin_password="$(random_secret)"
  fake_privacy_admin_password="$(random_secret)"
  fake_audit_read_password="$(random_secret)"
  fake_support_password="$(random_secret)"
  fake_deletion_password="$(random_secret)"
  web_client_secret="$(random_secret)"
  auth_secret="$(random_secret)"
  import_fingerprint_key="$(random_secret)"

  umask 077
  cat >"${ENV_FILE}" <<EOF
COMPOSE_PROJECT_NAME=autopay-guard
TZ=Asia/Kolkata
POSTGRES_PORT=5432
KEYCLOAK_PORT=8081
MAILPIT_SMTP_PORT=1025
MAILPIT_UI_PORT=8025
API_PORT=8080
WEB_PORT=3000
AUTOPAY_GUARD_RUNTIME_MODE=LOCAL
POSTGRES_DB=autopay_guard
POSTGRES_USER=autopay_guard_admin
POSTGRES_PASSWORD=${postgres_password}
APP_DB_USER=autopay_guard
APP_DB_PASSWORD=${app_db_password}
KEYCLOAK_DB_NAME=keycloak
KEYCLOAK_DB_USER=keycloak
KEYCLOAK_DB_PASSWORD=${keycloak_db_password}
KEYCLOAK_ADMIN_USERNAME=local-admin
KEYCLOAK_ADMIN_PASSWORD=${keycloak_admin_password}
KEYCLOAK_FAKE_USER_USERNAME=demo@autopayguard.local
KEYCLOAK_FAKE_USER_PASSWORD=${fake_user_password}
KEYCLOAK_FAKE_MEMBER_USERNAME=member@autopayguard.local
KEYCLOAK_FAKE_MEMBER_PASSWORD=${fake_member_password}
KEYCLOAK_FAKE_FOREIGN_USERNAME=foreign@autopayguard.local
KEYCLOAK_FAKE_FOREIGN_PASSWORD=${fake_foreign_password}
KEYCLOAK_FAKE_GUIDE_ADMIN_USERNAME=admin@autopayguard.local
KEYCLOAK_FAKE_GUIDE_ADMIN_PASSWORD=${fake_guide_admin_password}
KEYCLOAK_FAKE_PRIVACY_ADMIN_USERNAME=privacy-admin@autopayguard.local
KEYCLOAK_FAKE_PRIVACY_ADMIN_PASSWORD=${fake_privacy_admin_password}
KEYCLOAK_FAKE_AUDIT_READ_USERNAME=audit-reader@autopayguard.local
KEYCLOAK_FAKE_AUDIT_READ_PASSWORD=${fake_audit_read_password}
KEYCLOAK_FAKE_SUPPORT_USERNAME=support@autopayguard.local
KEYCLOAK_FAKE_SUPPORT_PASSWORD=${fake_support_password}
KEYCLOAK_FAKE_DELETION_USERNAME=deletion@autopayguard.local
KEYCLOAK_FAKE_DELETION_PASSWORD=${fake_deletion_password}
KEYCLOAK_WEB_CLIENT_ID=autopay-guard-web
KEYCLOAK_WEB_CLIENT_SECRET=${web_client_secret}
SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:5432/autopay_guard
SPRING_DATASOURCE_USERNAME=autopay_guard
SPRING_DATASOURCE_PASSWORD=${app_db_password}
IMPORT_FINGERPRINT_KEY=${import_fingerprint_key}
OIDC_ISSUER_URI=http://localhost:8081/realms/autopay-guard
OIDC_AUDIENCE=autopay-guard-api
NOTIFICATION_EMAIL_MODE=MAILPIT
NOTIFICATION_FROM_ADDRESS=no-reply@autopayguard.local
NOTIFICATION_ALLOWED_RECIPIENT_SUFFIXES=@autopayguard.local,.example.test
NOTIFICATION_GENERATOR_CRON="0 */1 * * * *"
NOTIFICATION_WORKER_CRON="*/5 * * * * *"
NOTIFICATION_RECONCILIATION_CRON="0 */5 * * * *"
AUTH_SECRET=${auth_secret}
AUTH_URL=http://localhost:3000
AUTH_TRUST_HOST=true
AUTH_KEYCLOAK_ID=autopay-guard-web
AUTH_KEYCLOAK_SECRET=${web_client_secret}
AUTH_KEYCLOAK_ISSUER=http://localhost:8081/realms/autopay-guard
AUTH_KEYCLOAK_INTERNAL_ISSUER=http://localhost:8081/realms/autopay-guard
API_BASE_URL=http://localhost:8080
EOF
  chmod 600 "${ENV_FILE}" 2>/dev/null || true
  info "Created gitignored .env with random local-development secrets."
else
  umask 077
  env_was_backfilled=0
  append_env_value_if_missing \
    AUTOPAY_GUARD_RUNTIME_MODE \
    "LOCAL"
  append_env_value_if_missing \
    KEYCLOAK_FAKE_MEMBER_USERNAME \
    "member@autopayguard.local"
  append_env_value_if_missing \
    KEYCLOAK_FAKE_MEMBER_PASSWORD \
    "$(random_secret)"
  append_env_value_if_missing \
    KEYCLOAK_FAKE_FOREIGN_USERNAME \
    "foreign@autopayguard.local"
  append_env_value_if_missing \
    KEYCLOAK_FAKE_FOREIGN_PASSWORD \
    "$(random_secret)"
  append_env_value_if_missing \
    KEYCLOAK_FAKE_GUIDE_ADMIN_USERNAME \
    "admin@autopayguard.local"
  append_env_value_if_missing \
    KEYCLOAK_FAKE_GUIDE_ADMIN_PASSWORD \
    "$(random_secret)"
  append_env_value_if_missing \
    KEYCLOAK_FAKE_PRIVACY_ADMIN_USERNAME \
    "privacy-admin@autopayguard.local"
  append_env_value_if_missing \
    KEYCLOAK_FAKE_PRIVACY_ADMIN_PASSWORD \
    "$(random_secret)"
  append_env_value_if_missing \
    KEYCLOAK_FAKE_AUDIT_READ_USERNAME \
    "audit-reader@autopayguard.local"
  append_env_value_if_missing \
    KEYCLOAK_FAKE_AUDIT_READ_PASSWORD \
    "$(random_secret)"
  append_env_value_if_missing \
    KEYCLOAK_FAKE_SUPPORT_USERNAME \
    "support@autopayguard.local"
  append_env_value_if_missing \
    KEYCLOAK_FAKE_SUPPORT_PASSWORD \
    "$(random_secret)"
  append_env_value_if_missing \
    KEYCLOAK_FAKE_DELETION_USERNAME \
    "deletion@autopayguard.local"
  append_env_value_if_missing \
    KEYCLOAK_FAKE_DELETION_PASSWORD \
    "$(random_secret)"
  append_env_value_if_missing \
    IMPORT_FINGERPRINT_KEY \
    "$(random_secret)"
  chmod 600 "${ENV_FILE}" 2>/dev/null || true

  if [[ "${env_was_backfilled}" == "1" ]]; then
    info "Preserved existing .env values and added missing fake-local settings."
  else
    info "Keeping existing .env unchanged."
  fi
fi

load_local_env

[[ "${AUTOPAY_GUARD_RUNTIME_MODE:-}" == "LOCAL" ]] ||
  die "AUTOPAY_GUARD_RUNTIME_MODE must remain LOCAL in the fake-local bootstrap configuration."

validate_generated_secret() {
  local variable_name="$1"
  local value="${!variable_name:-}"

  [[ ${#value} -ge 32 ]] ||
    die "${variable_name} must contain at least 32 characters of random local-development data."
  [[ "${value}" != *"generated-by-make-bootstrap"* ]] ||
    die "${variable_name} still contains the public .env.example placeholder. Remove .env and re-run bootstrap."
  [[ "${value}" != *"change-me"* ]] ||
    die "${variable_name} still contains a public placeholder. Remove .env and re-run bootstrap."
}

for secret_name in \
  POSTGRES_PASSWORD \
  APP_DB_PASSWORD \
  KEYCLOAK_DB_PASSWORD \
  KEYCLOAK_ADMIN_PASSWORD \
  KEYCLOAK_FAKE_USER_PASSWORD \
  KEYCLOAK_FAKE_MEMBER_PASSWORD \
  KEYCLOAK_FAKE_FOREIGN_PASSWORD \
  KEYCLOAK_FAKE_GUIDE_ADMIN_PASSWORD \
  KEYCLOAK_FAKE_PRIVACY_ADMIN_PASSWORD \
  KEYCLOAK_FAKE_AUDIT_READ_PASSWORD \
  KEYCLOAK_FAKE_SUPPORT_PASSWORD \
  KEYCLOAK_FAKE_DELETION_PASSWORD \
  KEYCLOAK_WEB_CLIENT_SECRET \
  IMPORT_FINGERPRINT_KEY \
  AUTH_SECRET; do
  validate_generated_secret "${secret_name}"
done

[[ "${IMPORT_FINGERPRINT_KEY}" =~ ^[0-9a-f]{64}$ ]] ||
  die "IMPORT_FINGERPRINT_KEY must be exactly 64 lowercase hexadecimal characters."

validate_reserved_identity_username() {
  local variable_name="$1"
  local expected_username="$2"
  local value="${!variable_name:-}"

  [[ "${value}" == "${expected_username}" ]] ||
    die "${variable_name} must remain the reserved fake-local identity ${expected_username}."
}

validate_reserved_identity_username \
  KEYCLOAK_FAKE_USER_USERNAME \
  "demo@autopayguard.local"
validate_reserved_identity_username \
  KEYCLOAK_FAKE_MEMBER_USERNAME \
  "member@autopayguard.local"
validate_reserved_identity_username \
  KEYCLOAK_FAKE_FOREIGN_USERNAME \
  "foreign@autopayguard.local"
validate_reserved_identity_username \
  KEYCLOAK_FAKE_GUIDE_ADMIN_USERNAME \
  "admin@autopayguard.local"
validate_reserved_identity_username \
  KEYCLOAK_FAKE_PRIVACY_ADMIN_USERNAME \
  "privacy-admin@autopayguard.local"
validate_reserved_identity_username \
  KEYCLOAK_FAKE_AUDIT_READ_USERNAME \
  "audit-reader@autopayguard.local"
validate_reserved_identity_username \
  KEYCLOAK_FAKE_SUPPORT_USERNAME \
  "support@autopayguard.local"
validate_reserved_identity_username \
  KEYCLOAK_FAKE_DELETION_USERNAME \
  "deletion@autopayguard.local"

fake_identity_passwords=(
  "${KEYCLOAK_FAKE_USER_PASSWORD}"
  "${KEYCLOAK_FAKE_MEMBER_PASSWORD}"
  "${KEYCLOAK_FAKE_FOREIGN_PASSWORD}"
  "${KEYCLOAK_FAKE_GUIDE_ADMIN_PASSWORD}"
  "${KEYCLOAK_FAKE_PRIVACY_ADMIN_PASSWORD}"
  "${KEYCLOAK_FAKE_AUDIT_READ_PASSWORD}"
  "${KEYCLOAK_FAKE_SUPPORT_PASSWORD}"
  "${KEYCLOAK_FAKE_DELETION_PASSWORD}"
)
for ((left = 0; left < ${#fake_identity_passwords[@]}; left++)); do
  for ((right = left + 1; right < ${#fake_identity_passwords[@]}; right++)); do
    [[ "${fake_identity_passwords[left]}" != "${fake_identity_passwords[right]}" ]] ||
      die "Each fake Keycloak identity must have an independent generated password."
  done
done

[[ "${SPRING_DATASOURCE_PASSWORD:-}" == "${APP_DB_PASSWORD}" ]] ||
  die "SPRING_DATASOURCE_PASSWORD must match APP_DB_PASSWORD for the local stack."
[[ "${AUTH_KEYCLOAK_SECRET:-}" == "${KEYCLOAK_WEB_CLIENT_SECRET}" ]] ||
  die "AUTH_KEYCLOAK_SECRET must match KEYCLOAK_WEB_CLIENT_SECRET for the local stack."

if [[ "${AUTOPAY_GUARD_SKIP_INSTALL:-0}" == "1" ]]; then
  info "Skipped dependency installation (AUTOPAY_GUARD_SKIP_INSTALL=1)."
  exit 0
fi

if [[ -f pnpm-lock.yaml ]]; then
  pnpm install --frozen-lockfile
else
  info "No pnpm-lock.yaml exists yet; creating the initial workspace lockfile."
  pnpm install --no-frozen-lockfile
fi
pnpm --dir apps/web exec playwright install chromium

if [[ "${OS:-}" != "Windows_NT" ]]; then
  chmod +x services/api/mvnw
fi
run_maven --batch-mode --no-transfer-progress --version

info "Bootstrap complete. Run 'make up' to start the local stack."
