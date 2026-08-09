#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${script_dir}/lib/common.sh"

cd "${REPO_ROOT}"
require_command docker
require_command node
require_command curl
load_local_env

for service in keycloak mailpit api web; do
  compose ps --status running --services "${service}" | grep -Fxq "${service}" ||
    die "${service} is not running. Run 'make up' first."
done

curl --fail --silent --show-error \
  "http://127.0.0.1:${MAILPIT_UI_PORT:-8025}/readyz" >/dev/null ||
  die "Mailpit is not healthy. Restore the local capture service before enabling fake email."

node "${REPO_ROOT}/scripts/validate-keycloak-seed.mjs" ||
  die "The expected fake user is missing or disabled in the local Keycloak realm."

node "${REPO_ROOT}/apps/web/scripts/seed-milestone2.mjs" ||
  die "The fake Milestone 2 commitments could not be seeded and verified."

node "${REPO_ROOT}/apps/web/scripts/seed-milestone3.mjs" ||
  die "The fake Milestone 3 reminder configuration could not be seeded and verified."

node "${REPO_ROOT}/apps/web/scripts/seed-milestone4.mjs" ||
  die "The fictional Milestone 4 guide fixtures and read surfaces could not be verified."

node "${REPO_ROOT}/apps/web/scripts/seed-milestone5.mjs" ||
  die "The distinct fake-local Milestone 5 identities, role isolation, and private household baseline could not be verified."

bash "${REPO_ROOT}/scripts/seed-milestone6-baseline.sh" ||
  die "The Milestone 6 fake-owner import residue could not be removed and verified."

info "Validated eight fake identities, four deterministic commitments, explicit fake-local reminders, fictional cancellation-guide fixtures, the Milestone 5 private/role-isolated baseline, and zero Milestone 6 import residue."
