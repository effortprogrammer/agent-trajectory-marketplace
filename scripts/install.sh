#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="https://github.com/effortprogrammer/agent-trajectory-marketplace.git"
DESTINATION="agent-trajectory-marketplace"
AGENT=""
COLLECT_OUT=""
export ATM_POSTHOG_API_KEY="phc_ASY8KVcfvErjXmygRTgMvx5i3LKDeJhbAnePGEAUxe3v"

usage() {
  cat <<'EOF'
Usage: install.sh [--dir PATH] [--out PATH] [--agent claude-code|codex]

Requires Bun 1.3 or newer. Clones the ATM CLI, installs dependencies, builds
the local collector CLI, and starts collection immediately. On macOS launchd
and Linux systemd keep collection running after login and reboot.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir)
      DESTINATION="${2:?--dir requires a path}"
      shift 2
      ;;
    --agent)
      AGENT="${2:?--agent requires claude-code or codex}"
      shift 2
      ;;
    --out)
      COLLECT_OUT="${2:?--out requires a path}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

case "$AGENT" in
  ""|claude-code|codex) ;;
  *)
    printf 'Unsupported agent: %s\n' "$AGENT" >&2
    exit 1
    ;;
esac

command -v git >/dev/null || { printf 'git is required.\n' >&2; exit 1; }
command -v bun >/dev/null || { printf 'Bun 1.3.0 or newer is required.\n' >&2; exit 1; }

BUN_VERSION="$(bun --version)"
BUN_MAJOR="${BUN_VERSION%%.*}"
BUN_REMAINDER="${BUN_VERSION#*.}"
BUN_MINOR="${BUN_REMAINDER%%.*}"
case "$BUN_MAJOR:$BUN_MINOR" in
  *[!0-9:]*) printf 'Bun 1.3.0 or newer is required.\n' >&2; exit 1 ;;
esac
if [ "$BUN_MAJOR" -lt 1 ] || { [ "$BUN_MAJOR" -eq 1 ] && [ "$BUN_MINOR" -lt 3 ]; }; then
  printf 'Bun 1.3.0 or newer is required.\n' >&2
  exit 1
fi

if [ -e "$DESTINATION" ]; then
  printf 'Destination already exists: %s\n' "$DESTINATION" >&2
  exit 1
fi

git clone "$REPOSITORY" "$DESTINATION"
cd "$DESTINATION"
bun install --frozen-lockfile
bun run build:collector
if [ -z "$COLLECT_OUT" ]; then
  COLLECT_OUT="$PWD/collected"
fi
mkdir -p "$COLLECT_OUT"

printf '\nInstalled ATM CLI in %s\n' "$PWD"
case "$(uname -s)" in
  Darwin)
    bun run trajectory -- collect service install --out "$COLLECT_OUT"
    printf 'Collector: running continuously via launchd\n'
    ;;
  Linux)
    bun run trajectory -- collect service install --out "$COLLECT_OUT"
    printf 'Collector: running continuously via systemd --user\n'
    ;;
  *)
    bun run trajectory -- collect watch --once --out "$COLLECT_OUT" --settle-seconds 0
    printf 'Collector: initial sweep completed (persistent services support macOS and Linux)\n'
    ;;
esac
bun run trajectory -- collect telemetry installed --out "$COLLECT_OUT" >/dev/null 2>&1 || true
printf 'Collected ATF: %s\n' "$COLLECT_OUT"
case "$AGENT" in
  claude-code) printf 'Start Claude Code: claude\n' ;;
  codex) printf 'Start Codex: codex\n' ;;
  *)
    printf 'Start Claude Code: cd %s && claude\n' "$DESTINATION"
    printf 'Start Codex:       cd %s && codex\n' "$DESTINATION"
    ;;
esac
