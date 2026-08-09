#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${script_dir}/lib/common.sh"

cd "${REPO_ROOT}"

frontend_lint() {
  require_command pnpm
  pnpm format:check
  pnpm lint
  pnpm typecheck
}

all_tests() {
  require_command pnpm
  run_maven --batch-mode --no-transfer-progress verify
  pnpm test
}

e2e() {
  require_command pnpm
  load_local_env
  export E2E_USER_EMAIL="${KEYCLOAK_FAKE_USER_USERNAME:-demo@autopayguard.local}"
  export E2E_USER_PASSWORD="${KEYCLOAK_FAKE_USER_PASSWORD}"
  export AUTH_KEYCLOAK_ID="${KEYCLOAK_WEB_CLIENT_ID:-autopay-guard-web}"
  export AUTH_KEYCLOAK_SECRET="${KEYCLOAK_WEB_CLIENT_SECRET}"
  PLAYWRIGHT_TEST=true pnpm e2e
}

secret_scan() {
  if command -v gitleaks >/dev/null 2>&1; then
    local scan_root source_path target_path scan_status
    scan_root="$(mktemp -d)"

    while IFS= read -r -d '' source_path; do
      case "${source_path}" in
        /* | ../* | */../*)
          rm -rf -- "${scan_root}"
          die "Refusing unsafe source path during secret scan: ${source_path}"
          ;;
      esac
      target_path="${scan_root}/${source_path}"
      mkdir -p -- "$(dirname -- "${target_path}")"
      cp -- "${REPO_ROOT}/${source_path}" "${target_path}"
    done < <(git -C "${REPO_ROOT}" ls-files --cached --others --exclude-standard -z)

    if gitleaks dir "${scan_root}" \
      --config "${REPO_ROOT}/.gitleaks.toml" \
      --redact \
      --no-banner; then
      scan_status=0
    else
      scan_status=$?
    fi
    rm -rf -- "${scan_root}"
    return "${scan_status}"
  else
    info "gitleaks is not installed; the required CI secret scan remains enabled."
  fi
}

dependency_scan() {
  require_command pnpm
  pnpm audit --prod --audit-level=high
}

case "${1:-}" in
  lint)
    frontend_lint
    ;;
  secret-scan)
    secret_scan
    ;;
  test)
    all_tests
    ;;
  e2e)
    e2e
    ;;
  check)
    frontend_lint
    all_tests
    pnpm contracts:check
    pnpm build
    dependency_scan
    secret_scan
    e2e
    ;;
  *)
    die "Usage: scripts/quality.sh {lint|test|secret-scan|e2e|check}"
    ;;
esac
