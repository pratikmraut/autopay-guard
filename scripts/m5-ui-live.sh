#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${script_dir}/lib/common.sh"

cd "${REPO_ROOT}"
require_command docker
require_command pnpm
load_local_env

export E2E_EXTERNAL_SERVER="true"
export M5_REAL_OIDC_UI="true"
export PLAYWRIGHT_TEST="true"

pnpm --dir apps/web exec playwright test e2e/milestone5-real-oidc.spec.ts
