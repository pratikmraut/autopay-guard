#!/usr/bin/env bash
set -Eeuo pipefail

m6_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${m6_script_dir}/lib/common.sh"
# shellcheck source=scripts/lib/m6-guard.sh
source "${m6_script_dir}/lib/m6-guard.sh"

cd "${REPO_ROOT}"
require_command docker
require_command pnpm
load_local_env
m6_require_environment
m6_acquire_lock
trap m6_release_lock EXIT
m6_assert_canonical_services_healthy

readonly spec_path="${REPO_ROOT}/apps/web/e2e/milestone6-import-flow.spec.ts"
[[ -f "${spec_path}" ]] ||
  die "Missing Milestone 6 browser acceptance spec at ${spec_path}."

export E2E_EXTERNAL_SERVER="true"
export M6_REAL_OIDC_UI="true"
export PLAYWRIGHT_TEST="true"

pnpm --dir apps/web exec playwright test \
  e2e/milestone6-import-flow.spec.ts
