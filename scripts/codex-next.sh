#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/.." && pwd)"
cd "${repo_root}"

command -v codex >/dev/null 2>&1 || {
  printf '%s\n' "error: Codex CLI was not found on PATH." >&2
  exit 1
}

for required_file in \
  AGENTS.md \
  docs/ROADMAP.md \
  docs/STATUS.md \
  docs/codex/NEXT_TASK.md; do
  [[ -f "${required_file}" ]] || {
    printf 'error: required handoff file is missing: %s\n' "${required_file}" >&2
    exit 1
  }
done

exec codex \
  --sandbox workspace-write \
  --ask-for-approval on-request \
  "Read AGENTS.md, docs/ROADMAP.md, docs/STATUS.md, and docs/codex/NEXT_TASK.md in full. Execute only the approved work in NEXT_TASK.md, use fake data only, run the required checks, update the required handoff documents, and stop at its human gate. Do not commit, push, deploy, or access production."
