#!/bin/zsh
set -euo pipefail

runtime="${TRAJECTORY_MARKETPLACE_RUNTIME:-hermes}"

if [[ "${1:-}" == "hermes" || "${1:-}" == "openclaw" ]]; then
  runtime="$1"
  shift
fi

workspace="${1:-$PWD/.tmp/trajectory-e2e}"
export_path="${2:-$workspace/artifacts/trace.atf.json}"

mkdir -p "$(dirname "$workspace")"

bun src/cli/index.ts trajectory init "$runtime" --workspace "$workspace"

printf '\nTrajectory prototype workspace ready at:\n  %s\n' "$workspace"
printf 'Runtime: %s\n' "$runtime"
printf 'Run the happy-path demo with:\n  bun src/cli/index.ts trajectory demo %s --workspace %s --export %s\n' "$runtime" "$workspace" "$export_path"

