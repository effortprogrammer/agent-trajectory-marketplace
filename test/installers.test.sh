#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEMP_ROOT"' EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

fake_command() {
  local name="$1"
  local output="$2"
  printf '#!/bin/bash\nprintf "%%s\\n" %q\n' "$output" >"$TEMP_ROOT/$name"
  chmod +x "$TEMP_ROOT/$name"
}

for installer in scripts/install.sh scripts/install-agent.sh; do
  help_output="$(bash "$ROOT/$installer" --help)"
  [[ "$help_output" == *"Bun 1.3"* ]] || fail "$installer help omits Bun 1.3"
  [[ "$help_output" == *"systemd"* ]] || fail "$installer help omits Linux systemd persistence"
  [[ "$help_output" != *"Node.js"* ]] || fail "$installer still requires Node.js"
  [[ "$help_output" != *"npm"* ]] || fail "$installer still requires npm"
done

fake_command git "git version 2.50.0"
fake_command bun "1.2.22"

for installer in scripts/install.sh scripts/install-agent.sh; do
  destination="$TEMP_ROOT/${installer##*/}-checkout"
  if PATH="$TEMP_ROOT" /bin/bash "$ROOT/$installer" --dir "$destination" >"$TEMP_ROOT/stdout" 2>"$TEMP_ROOT/stderr"; then
    fail "$installer accepted Bun 1.2"
  fi
  [[ "$(<"$TEMP_ROOT/stderr")" == *"Bun 1.3.0 or newer is required."* ]] || fail "$installer emitted the wrong Bun version error"
done

fake_command bun "1.3.0"

cat >"$TEMP_ROOT/git" <<'EOF'
#!/bin/bash
destination=""
for argument in "$@"; do
  destination="$argument"
done
/bin/mkdir -p "$destination"
printf 'git %s\n' "$*" >>"$ATM_TEST_CALLS"
EOF
cat >"$TEMP_ROOT/bun" <<'EOF'
#!/bin/bash
if [ "${1:-}" = "--version" ]; then
  printf '%s\n' '1.3.0'
  exit 0
fi
printf 'bun %s telemetry-key=%s\n' "$*" "${ATM_POSTHOG_API_KEY:+set}" >>"$ATM_TEST_CALLS"
EOF
cat >"$TEMP_ROOT/uname" <<'EOF'
#!/bin/bash
printf '%s\n' 'Linux'
EOF
chmod +x "$TEMP_ROOT/git" "$TEMP_ROOT/bun" "$TEMP_ROOT/uname"

for installer in scripts/install.sh scripts/install-agent.sh; do
  destination="$TEMP_ROOT/linux-${installer##*/}-checkout"
  calls="$TEMP_ROOT/linux-${installer##*/}.calls"
  ATM_TEST_CALLS="$calls" PATH="$TEMP_ROOT:/usr/bin:/bin" /bin/bash "$ROOT/$installer" --dir "$destination" >"$TEMP_ROOT/stdout" 2>"$TEMP_ROOT/stderr"
  [[ "$(<"$calls")" == *"https://github.com/effortprogrammer/agent-trajectory-marketplace.git"* ]] || fail "$installer does not clone the renamed repository"
  [[ "$(<"$calls")" == *"bun run trajectory -- collect service install --out $destination/collected"* ]] || fail "$installer did not immediately install and start the Linux user service"
  [[ "$(<"$calls")" == *"bun run trajectory -- collect telemetry installed --out $destination/collected"* ]] || fail "$installer did not emit the post-install telemetry lifecycle signal"
  [[ "$(<"$calls")" == *"telemetry-key=set"* ]] || fail "$installer did not configure the PostHog capture key"
  [[ "$(<"$calls")" != *"collect watch --once"* ]] || fail "$installer fell back to a one-shot Linux sweep"
  printf 'Linux persistent service verified: %s\n' "$installer"
done

printf '%s\n' 'installer preflight smoke passed'
