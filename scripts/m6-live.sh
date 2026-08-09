#!/usr/bin/env bash
set -Eeuo pipefail

m6_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${m6_script_dir}/lib/common.sh"
# shellcheck source=scripts/lib/m6-guard.sh
source "${m6_script_dir}/lib/m6-guard.sh"

cd "${REPO_ROOT}"
require_command docker
require_command node
load_local_env
m6_require_environment
m6_acquire_lock
trap m6_release_lock EXIT
m6_assert_canonical_services_healthy

node "${REPO_ROOT}/scripts/verify-milestone6-live.mjs"
