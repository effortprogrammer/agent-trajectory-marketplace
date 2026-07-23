#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_ROOT="$(mktemp -d)"
REAL_BUN="$(command -v bun)"
REAL_GIT="$(command -v git)"
if [ "${ATM_TEST_KEEP_TEMP:-0}" = 1 ]; then
  trap 'printf "ATM_TEST_TEMP_ROOT=%s\n" "$TEMP_ROOT"' EXIT
else
  trap 'rm -rf "$TEMP_ROOT"' EXIT
fi

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

for installer in scripts/install.sh scripts/install-agent.sh; do
  stdin_stderr="$(head -n 9 "$ROOT/$installer" | /bin/bash -s 2>&1 >/dev/null)" || fail "$installer cannot initialize from stdin"
  [[ -z "$stdin_stderr" ]] || fail "$installer emits an error when piped to bash"
done

initialize_checkout() {
  local root="$1"
  mkdir -p "$root/dist"
  printf '%s\n' '{"name":"agent-trajectory-marketplace","version":"1.0.0"}' >"$root/package.json"
  printf '%s\n' 'legacy source' >"$root/README.md"
  cat >"$root/dist/collector.js" <<'EOF'
const [command, area, service, action] = process.argv.slice(2);
if (command === "trajectory" && service === "service" && action === "install") {
  const file = Bun.file(process.env.ATM_SERVICE_STATE_FILE);
  const prior = await file.exists() ? await file.text() : "";
  await Bun.write(file, `${prior}${JSON.stringify({cwd:process.cwd(),area})}\n`);
  if (process.env.ATM_TEST_FAIL_NEW_SERVICE === "1" && process.cwd().includes("/releases/1.1.0")) process.exit(42);
}
EOF
  "$REAL_GIT" -C "$root" init -q
  "$REAL_GIT" -C "$root" remote add origin https://github.com/effortprogrammer/agent-trajectory-marketplace.git
  "$REAL_GIT" -C "$root" add package.json README.md dist/collector.js
  "$REAL_GIT" -C "$root" -c user.name=ATM -c user.email=atm@example.invalid commit -qm fixture
}

mkdir -p "$TEMP_ROOT/bin" "$TEMP_ROOT/release/agent-trajectory-marketplace/dist"
printf '%s\n' '{"name":"agent-trajectory-marketplace","version":"1.1.0"}' >"$TEMP_ROOT/release/agent-trajectory-marketplace/package.json"
printf '%s\n' 'stable release' >"$TEMP_ROOT/release/agent-trajectory-marketplace/README.md"
cat >"$TEMP_ROOT/release/agent-trajectory-marketplace/dist/collector.js" <<'EOF'
const [command, area, service, action] = process.argv.slice(2);
if (command === "trajectory" && service === "service" && action === "install") {
  const file = Bun.file(process.env.ATM_SERVICE_STATE_FILE);
  const prior = await file.exists() ? await file.text() : "";
  await Bun.write(file, `${prior}${JSON.stringify({cwd:process.cwd(),area})}\n`);
  if (process.env.ATM_TEST_FAIL_NEW_SERVICE === "1" && process.cwd().includes("/releases/1.1.0")) process.exit(42);
}
EOF
mkdir -p "$TEMP_ROOT/release/agent-trajectory-marketplace/scripts"
cp "$ROOT/scripts/install-core.sh" "$TEMP_ROOT/release/agent-trajectory-marketplace/scripts/install-core.sh"
tar --format=ustar -czf "$TEMP_ROOT/atm-v1.1.0.tar.gz" -C "$TEMP_ROOT/release" agent-trajectory-marketplace
release_archive_digest="$(shasum -a 256 "$TEMP_ROOT/atm-v1.1.0.tar.gz" | cut -d' ' -f1)"
release_archive_size="$(stat -f%z "$TEMP_ROOT/atm-v1.1.0.tar.gz")"
cat >"$TEMP_ROOT/atm-release-manifest.json" <<EOF
{"schemaVersion":1,"packageName":"agent-trajectory-marketplace","version":"1.1.0","tag":"v1.1.0","archive":{"name":"atm-v1.1.0.tar.gz","size":$release_archive_size,"sha256":"$release_archive_digest"}}
EOF
release_manifest_digest="$(shasum -a 256 "$TEMP_ROOT/atm-release-manifest.json" | cut -d' ' -f1)"

cat >"$TEMP_ROOT/bin/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'git %s\n' "$*" >>"$ATM_TEST_CALLS"
exec "$ATM_REAL_GIT" "$@"
EOF

cat >"$TEMP_ROOT/bin/bun" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--version" ]; then
  printf '%s\n' "${ATM_TEST_BUN_VERSION:-1.3.0}"
  exit 0
fi
if [ "${1:-}" = "-e" ] || [ "${1:-}" = "-p" ]; then
  exec "$ATM_REAL_BUN" "$@"
fi
if [ "${1:-}" = "dist/collector.js" ]; then
  printf 'cwd=%s bun %s\n' "$PWD" "$*" >>"$ATM_TEST_CALLS"
  exec "$ATM_REAL_BUN" "$@"
fi
if [ "${ATM_TEST_FAIL_PHASE:-}" = "install" ] && [ "${1:-}" = "install" ]; then exit 43; fi
if [ "${ATM_TEST_FAIL_PHASE:-}" = "build" ] && [ "${1:-}" = "run" ] && [ "${2:-}" = "build:collector" ]; then exit 44; fi
printf 'cwd=%s bun %s\n' "$PWD" "$*" >>"$ATM_TEST_CALLS"
EOF
chmod +x "$TEMP_ROOT/bin/git" "$TEMP_ROOT/bin/bun"

cat >"$TEMP_ROOT/remote-core.sh" <<'EOF'
#!/usr/bin/env bash
atm_install() {
  printf '%s\n' '{"status":"remote-bootstrap"}'
}
EOF
remote_core_digest="$(shasum -a 256 "$TEMP_ROOT/remote-core.sh" | cut -d' ' -f1)"
printf '%s\n' "$remote_core_digest" >"$TEMP_ROOT/remote-core.sh.sha256"
remote_checksum_digest="$(shasum -a 256 "$TEMP_ROOT/remote-core.sh.sha256" | cut -d' ' -f1)"
cat >"$TEMP_ROOT/release-metadata.json" <<EOF
{"tag_name":"v1.1.0","immutable":true,"draft":false,"prerelease":false,"assets":[{"name":"install-core.sh","digest":"sha256:$remote_core_digest","browser_download_url":"https://github.com/effortprogrammer/agent-trajectory-marketplace/releases/download/v1.1.0/install-core.sh"},{"name":"install-core.sh.sha256","digest":"sha256:$remote_checksum_digest","browser_download_url":"https://github.com/effortprogrammer/agent-trajectory-marketplace/releases/download/v1.1.0/install-core.sh.sha256"},{"name":"atm-release-manifest.json","digest":"sha256:$release_manifest_digest","browser_download_url":"https://github.com/effortprogrammer/agent-trajectory-marketplace/releases/download/v1.1.0/atm-release-manifest.json"},{"name":"atm-v1.1.0.tar.gz","digest":"sha256:$release_archive_digest","size":$release_archive_size,"browser_download_url":"https://github.com/effortprogrammer/agent-trajectory-marketplace/releases/download/v1.1.0/atm-v1.1.0.tar.gz"}]}
EOF
sed 's#/v1.1.0/install-core.sh"#/v9.9.9/install-core.sh"#' "$TEMP_ROOT/release-metadata.json" >"$TEMP_ROOT/release-metadata-bad.json"
cat >"$TEMP_ROOT/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
url=""
output=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
case "$url" in
  */releases/latest)
    if [ "${ATM_TEST_BAD_METADATA:-0}" = 1 ]; then /bin/cp "$ATM_TEST_BAD_RELEASE_META" "$output"; else /bin/cp "$ATM_TEST_RELEASE_META" "$output"; fi
    ;;
  */install-core.sh.sha256) /bin/cp "$ATM_TEST_REMOTE_CHECKSUM" "$output" ;;
  */install-core.sh)
    /bin/cp "$ATM_TEST_REMOTE_CORE" "$output"
    if [ "${ATM_TEST_CORRUPT_CORE:-0}" = 1 ]; then printf '%s\n' '# corrupt' >>"$output"; fi
    ;;
  */atm-release-manifest.json) /bin/cp "$ATM_TEST_RELEASE_MANIFEST" "$output" ;;
  */atm-v1.1.0.tar.gz)
    /bin/cp "$ATM_TEST_RELEASE_ARCHIVE" "$output"
    if [ "${ATM_TEST_CORRUPT_ARCHIVE:-0}" = 1 ]; then printf '%s\n' corrupt >>"$output"; fi
    ;;
  *) exit 22 ;;
esac
EOF
chmod +x "$TEMP_ROOT/bin/curl"

run_installer() {
  local installer="$1" destination="$2" calls="$3"
  shift 3
  ATM_REAL_BUN="$REAL_BUN" ATM_REAL_GIT="$REAL_GIT" ATM_TEST_RELEASE="$TEMP_ROOT/release" \
    ATM_TEST_CALLS="$calls" ATM_TEST_RELEASE_META="$TEMP_ROOT/release-metadata.json" \
    ATM_TEST_RELEASE_MANIFEST="$TEMP_ROOT/atm-release-manifest.json" \
    ATM_TEST_RELEASE_ARCHIVE="$TEMP_ROOT/atm-v1.1.0.tar.gz" \
    ATM_TEST_FAIL_NEW_SERVICE="${ATM_TEST_FAIL_NEW_SERVICE:-0}" \
    ATM_TEST_FAIL_PHASE="${ATM_TEST_FAIL_PHASE:-}" \
    ATM_TEST_CORRUPT_ARCHIVE="${ATM_TEST_CORRUPT_ARCHIVE:-0}" \
    ATM_SERVICE_STATE_FILE="${ATM_SERVICE_STATE_FILE:-$TEMP_ROOT/service-state.jsonl}" PATH="$TEMP_ROOT/bin:/usr/bin:/bin" \
    /bin/bash "$ROOT/$installer" --dir "$destination" "$@"
}

for installer in scripts/install.sh scripts/install-agent.sh; do
  help_output="$(bash "$ROOT/$installer" --help)"
  [[ "$help_output" == *"Bun 1.3"* ]] || fail "$installer help omits Bun 1.3"
  [[ "$help_output" == *"systemd --user"* ]] || fail "$installer help omits the Linux user-service requirement"
  [[ "$help_output" == *"six-hour"* ]] || fail "$installer help omits stable update scheduling"

  destination="$TEMP_ROOT/fresh-${installer##*/}"
  calls="$TEMP_ROOT/fresh-${installer##*/}.calls"
  output="$(run_installer "$installer" "$destination" "$calls")"
  [[ -L "$destination/current" ]] || fail "$installer did not create the current release pointer"
  [[ "$(readlink "$destination/current")" = "releases/1.1.0" ]] || fail "$installer current pointer is not versioned"
  [[ -f "$destination/install-state.json" ]] || fail "$installer omitted install state"
  "$REAL_BUN" -e '
    const [statePath,root]=process.argv.slice(1); const state=await Bun.file(statePath).json();
    if(state.installRoot!==root||state.outputDir!==`${root}/collected`||state.schemaVersion!==1)process.exit(1)
  ' "$destination/install-state.json" "$destination" || fail "$installer wrote invalid install state"
  [[ "$(<"$calls")" != *"git clone"* ]] || fail "$installer used git clone instead of the verified release archive"
  [[ "$(<"$calls")" == *"trajectory collect service install --out $destination/collected"* ]] || fail "$installer did not start the collector service"
  [[ "$(<"$calls")" == *"trajectory update service install --state-root $destination"* ]] || fail "$installer did not enable the updater service"
  [[ "$(<"$calls")" != *$'trajectory update\n'* ]] || fail "$installer blocks on the updater's first network check"
  "$REAL_BUN" -e 'const value=JSON.parse(process.argv[1]);if(value.status!=="installed"||value.version!=="1.1.0")process.exit(1)' "${output##*$'\n'}" || fail "$installer completion is not short JSON"
  printf '%s\n' 'keep across rerun' >"$destination/collected/rerun.atf.json"
  run_installer "$installer" "$destination" "$calls" >/dev/null
  [[ "$(<"$destination/collected/rerun.atf.json")" == 'keep across rerun' ]] || fail "$installer lost output on stable rerun"
  ! grep -Fq 'git clone' "$calls" || fail "$installer cloned over a stable installation"

  legacy="$TEMP_ROOT/legacy-${installer##*/}"
  initialize_checkout "$legacy"
  mkdir -p "$legacy/collected"
  printf '%s\n' '{"cursor":"preserve-me"}' >"$legacy/collected/collect-watch-state.json"
  printf '%s\n' '{"trace":"preserve-me"}' >"$legacy/collected/session.atf.json"
  run_installer "$installer" "$legacy" "$TEMP_ROOT/legacy-${installer##*/}.calls" >/dev/null
  [[ "$(<"$legacy/collected/collect-watch-state.json")" == *preserve-me* ]] || fail "$installer lost watch state during migration"
  [[ "$(<"$legacy/collected/session.atf.json")" == *preserve-me* ]] || fail "$installer lost collected output during migration"
  [[ -d "$legacy/releases/1.0.0/.git" ]] || fail "$installer did not retain the known legacy checkout"
  [[ "$(readlink "$legacy/current")" = "releases/1.1.0" ]] || fail "$installer did not activate the verified new release"
  [[ "$(readlink "$legacy/previous")" = "releases/1.0.0" ]] || fail "$installer did not preserve the legacy checkout as rollback"
  [[ "$(<"$TEMP_ROOT/legacy-${installer##*/}.calls")" == *"cwd=$legacy/current bun dist/collector.js trajectory collect service install"* ]] || fail "$installer did not install services from the new release"

  rollback_legacy="$TEMP_ROOT/rollback-${installer##*/}"
  rollback_service="$TEMP_ROOT/rollback-${installer##*/}.service.jsonl"
  initialize_checkout "$rollback_legacy"
  mkdir -p "$rollback_legacy/collected"
  printf '%s\n' '{"cursor":"rollback-preserve"}' >"$rollback_legacy/collected/collect-watch-state.json"
  rollback_before="$(find "$rollback_legacy" -type f -exec shasum -a 256 {} \; | sort)"
  export ATM_TEST_FAIL_NEW_SERVICE=1 ATM_SERVICE_STATE_FILE="$rollback_service"
  if run_installer "$installer" "$rollback_legacy" "$TEMP_ROOT/rollback-${installer##*/}.calls" >/dev/null 2>"$TEMP_ROOT/rollback.err"; then
    unset ATM_TEST_FAIL_NEW_SERVICE ATM_SERVICE_STATE_FILE
    fail "$installer reported success after the new release service failed"
  fi
  unset ATM_TEST_FAIL_NEW_SERVICE ATM_SERVICE_STATE_FILE
  [[ -d "$rollback_legacy/.git" && ! -e "$rollback_legacy/install-state.json" ]] || fail "$installer did not restore the legacy checkout"
  [[ "$(<"$rollback_legacy/collected/collect-watch-state.json")" == *rollback-preserve* ]] || fail "$installer did not restore legacy watch state"
  rollback_after="$(find "$rollback_legacy" -type f -exec shasum -a 256 {} \; | sort)"
  [[ "$rollback_before" = "$rollback_after" ]] || fail "$installer changed legacy bytes after rollback"
  "$REAL_BUN" -e '
    const [path,suffix]=process.argv.slice(1);
    const events=(await Bun.file(path).text()).trim().split("\n").map(JSON.parse);
    if(events.length!==2||!events[1].cwd.endsWith(suffix)||events[1].area!=="collect")process.exit(1);
  ' "$rollback_service" "/rollback-${installer##*/}" || fail "$installer did not execute the legacy collector during service rollback"

  if [ "$installer" = scripts/install.sh ]; then
    custom_rollback="$TEMP_ROOT/custom-rollback"
    custom_rollback_output="$TEMP_ROOT/custom-rollback-output"
    initialize_checkout "$custom_rollback"
    mkdir -p "$custom_rollback/collected" "$custom_rollback_output"
    printf '%s\n' '{"cursor":"custom-rollback-preserve"}' >"$custom_rollback/collected/collect-watch-state.json"
    export ATM_TEST_FAIL_NEW_SERVICE=1 ATM_SERVICE_STATE_FILE="$TEMP_ROOT/custom-rollback.service.jsonl"
    if run_installer "$installer" "$custom_rollback" "$TEMP_ROOT/custom-rollback.calls" --out "$custom_rollback_output" >/dev/null 2>"$TEMP_ROOT/custom-rollback.err"; then
      unset ATM_TEST_FAIL_NEW_SERVICE ATM_SERVICE_STATE_FILE
      fail "$installer reported success after custom-output service failure"
    fi
    unset ATM_TEST_FAIL_NEW_SERVICE ATM_SERVICE_STATE_FILE
    [[ "$(<"$custom_rollback/collected/collect-watch-state.json")" == *custom-rollback-preserve* ]] || fail "$installer lost legacy data during custom-output rollback"
    [[ -d "$custom_rollback_output" && -z "$(find "$custom_rollback_output" -mindepth 1 -print -quit)" ]] || fail "$installer did not restore the preexisting empty custom output"
  fi

  for failure_phase in install build; do
    phase_legacy="$TEMP_ROOT/$failure_phase-${installer##*/}"
    initialize_checkout "$phase_legacy"
    mkdir -p "$phase_legacy/collected"
    printf '%s\n' "{\"cursor\":\"$failure_phase-preserve\"}" >"$phase_legacy/collected/collect-watch-state.json"
    phase_before="$(find "$phase_legacy" -type f -exec shasum -a 256 {} \; | sort)"
    export ATM_TEST_FAIL_PHASE="$failure_phase"
    if run_installer "$installer" "$phase_legacy" "$TEMP_ROOT/$failure_phase-${installer##*/}.calls" >/dev/null 2>"$TEMP_ROOT/$failure_phase.err"; then
      unset ATM_TEST_FAIL_PHASE
      fail "$installer reported success after $failure_phase failure"
    fi
    unset ATM_TEST_FAIL_PHASE
    phase_after="$(find "$phase_legacy" -type f -exec shasum -a 256 {} \; | sort)"
    [[ "$phase_before" = "$phase_after" ]] || fail "$installer changed legacy bytes after $failure_phase failure"
    [[ -d "$phase_legacy/.git" && ! -e "$phase_legacy/install-state.json" ]] || fail "$installer did not retain legacy checkout after $failure_phase failure"
  done

  custom_legacy="$TEMP_ROOT/custom-legacy-${installer##*/}"
  custom_output="$TEMP_ROOT/custom-output-${installer##*/}"
  initialize_checkout "$custom_legacy"
  mkdir -p "$custom_legacy/collected"
  printf '%s\n' '{"cursor":"custom-preserve"}' >"$custom_legacy/collected/collect-watch-state.json"
  printf '%s\n' '{"trace":"custom-preserve"}' >"$custom_legacy/collected/session.atf.json"
  run_installer "$installer" "$custom_legacy" "$TEMP_ROOT/custom-${installer##*/}.calls" --out "$custom_output" >/dev/null
  [[ "$(<"$custom_output/collect-watch-state.json")" == *custom-preserve* ]] || fail "$installer stranded watch state outside explicit --out"
  [[ "$(<"$custom_output/session.atf.json")" == *custom-preserve* ]] || fail "$installer stranded collected output outside explicit --out"
  [[ ! -e "$custom_legacy/collected" ]] || fail "$installer retained a second default output after explicit --out migration"

  collision_legacy="$TEMP_ROOT/collision-legacy-${installer##*/}"
  collision_output="$TEMP_ROOT/collision-output-${installer##*/}"
  initialize_checkout "$collision_legacy"
  mkdir -p "$collision_legacy/collected" "$collision_output"
  printf '%s\n' 'legacy bytes' >"$collision_legacy/collected/session.atf.json"
  printf '%s\n' 'target bytes' >"$collision_output/existing.atf.json"
  collision_before="$(find "$collision_legacy" "$collision_output" -type f -exec shasum -a 256 {} \; | sort)"
  if run_installer "$installer" "$collision_legacy" "$TEMP_ROOT/collision.calls" --out "$collision_output" >/dev/null 2>"$TEMP_ROOT/collision.err"; then
    fail "$installer overwrote a nonempty explicit --out target"
  fi
  collision_after="$(find "$collision_legacy" "$collision_output" -type f -exec shasum -a 256 {} \; | sort)"
  [[ "$collision_before" = "$collision_after" ]] || fail "$installer mutated legacy or target data on explicit --out collision"

  for kind in dirty partial unrecognized; do
    refused="$TEMP_ROOT/$kind-${installer##*/}"
    case "$kind" in
      dirty)
        initialize_checkout "$refused"
        printf '%s\n' 'user edit' >>"$refused/README.md"
        ;;
      partial)
        mkdir -p "$refused"
        printf '%s\n' '{"name":"agent-trajectory-marketplace","version":"1.0.0"}' >"$refused/package.json"
        ;;
      unrecognized)
        mkdir -p "$refused"
        printf '%s\n' 'hands off' >"$refused/sentinel"
        ;;
    esac
    before="$(find "$refused" -type f -exec shasum -a 256 {} \; | sort)"
    if run_installer "$installer" "$refused" "$TEMP_ROOT/refused.calls" >/dev/null 2>"$TEMP_ROOT/refused.err"; then
      fail "$installer accepted a $kind destination"
    fi
    after="$(find "$refused" -type f -exec shasum -a 256 {} \; | sort)"
    [[ "$before" = "$after" ]] || fail "$installer mutated a refused $kind destination"
  done
done

export ATM_TEST_CORRUPT_ARCHIVE=1
if run_installer scripts/install.sh "$TEMP_ROOT/corrupt-archive-install" "$TEMP_ROOT/corrupt-archive.calls" >/dev/null 2>"$TEMP_ROOT/corrupt-archive.err"; then
  unset ATM_TEST_CORRUPT_ARCHIVE
  fail "installer accepted a corrupt release archive"
fi
unset ATM_TEST_CORRUPT_ARCHIVE
[[ ! -e "$TEMP_ROOT/corrupt-archive-install" ]] || fail "corrupt archive mutated the install destination"
grep -Eq 'archive (size|digest) mismatch' "$TEMP_ROOT/corrupt-archive.err" || fail "corrupt archive emitted the wrong refusal"

for installer in scripts/install.sh scripts/install-agent.sh; do
  standalone="$TEMP_ROOT/standalone-${installer##*/}"
  cp "$ROOT/$installer" "$standalone"
  remote_environment=(
    ATM_REAL_BUN="$REAL_BUN"
    ATM_REAL_GIT="$REAL_GIT"
    ATM_TEST_CALLS="$TEMP_ROOT/remote.calls"
    ATM_TEST_RELEASE_META="$TEMP_ROOT/release-metadata.json"
    ATM_TEST_BAD_RELEASE_META="$TEMP_ROOT/release-metadata-bad.json"
    ATM_TEST_REMOTE_CORE="$TEMP_ROOT/remote-core.sh"
    ATM_TEST_REMOTE_CHECKSUM="$TEMP_ROOT/remote-core.sh.sha256"
    ATM_TEST_RELEASE_MANIFEST="$TEMP_ROOT/atm-release-manifest.json"
    ATM_TEST_RELEASE_ARCHIVE="$TEMP_ROOT/atm-v1.1.0.tar.gz"
    PATH="$TEMP_ROOT/bin:/usr/bin:/bin"
  )
  remote_output="$(env "${remote_environment[@]}" /bin/bash "$standalone")"
  [[ "$remote_output" = '{"status":"remote-bootstrap"}' ]] || fail "$installer did not execute a checksum-bound release core"
  if env "${remote_environment[@]}" ATM_TEST_CORRUPT_CORE=1 /bin/bash "$standalone" >"$TEMP_ROOT/corrupt.out" 2>"$TEMP_ROOT/corrupt.err"; then
    fail "$installer accepted a corrupt release core"
  fi
  grep -Fq 'digest mismatch' "$TEMP_ROOT/corrupt.err" || fail "$installer emitted the wrong corrupt-core refusal"
  if env "${remote_environment[@]}" ATM_TEST_BAD_METADATA=1 /bin/bash "$standalone" >"$TEMP_ROOT/tag-mismatch.out" 2>"$TEMP_ROOT/tag-mismatch.err"; then
    fail "$installer accepted a core asset from a different release tag"
  fi
done

ATM_REAL_BUN="$REAL_BUN" ATM_REAL_GIT="$REAL_GIT" ATM_TEST_RELEASE="$TEMP_ROOT/release" \
  ATM_TEST_CALLS="$TEMP_ROOT/old-bun.calls" ATM_TEST_BUN_VERSION=1.2.22 PATH="$TEMP_ROOT/bin:/usr/bin:/bin" \
  /bin/bash "$ROOT/scripts/install.sh" --dir "$TEMP_ROOT/old-bun" >"$TEMP_ROOT/old-bun.out" 2>"$TEMP_ROOT/old-bun.err" && fail "installer accepted Bun 1.2"
grep -Fq 'Bun 1.3.0 or newer is required.' "$TEMP_ROOT/old-bun.err" || fail "wrong Bun version error"

if [ -n "${ATM_TEST_ARTIFACT_DIR:-}" ]; then
  mkdir -p "$ATM_TEST_ARTIFACT_DIR"
  cp "$TEMP_ROOT/fresh-install.sh/install-state.json" "$ATM_TEST_ARTIFACT_DIR/fresh-install-state.json"
  cp "$TEMP_ROOT/fresh-install.sh.calls" "$ATM_TEST_ARTIFACT_DIR/fresh-calls.log"
  cp "$TEMP_ROOT/legacy-install.sh/install-state.json" "$ATM_TEST_ARTIFACT_DIR/migrated-install-state.json"
  cp "$TEMP_ROOT/legacy-install.sh/collected/collect-watch-state.json" "$ATM_TEST_ARTIFACT_DIR/preserved-watch-state.json"
  cp "$TEMP_ROOT/legacy-install.sh/collected/session.atf.json" "$ATM_TEST_ARTIFACT_DIR/preserved-session.atf.json"
  cp "$TEMP_ROOT/custom-output-install.sh/collect-watch-state.json" "$ATM_TEST_ARTIFACT_DIR/custom-output-watch-state.json"
  cp "$TEMP_ROOT/custom-output-install.sh/session.atf.json" "$ATM_TEST_ARTIFACT_DIR/custom-output-session.atf.json"
  cp "$TEMP_ROOT/collision.err" "$ATM_TEST_ARTIFACT_DIR/output-collision.stderr.log"
  printf 'before=%s\nafter=%s\n' "$collision_before" "$collision_after" >"$ATM_TEST_ARTIFACT_DIR/output-collision-fingerprint.txt"
  cp "$TEMP_ROOT/release-metadata.json" "$ATM_TEST_ARTIFACT_DIR/immutable-release-metadata.json"
  cp "$TEMP_ROOT/remote-core.sh.sha256" "$ATM_TEST_ARTIFACT_DIR/release-core.sha256"
  cp "$TEMP_ROOT/corrupt.err" "$ATM_TEST_ARTIFACT_DIR/corrupt-core.stderr.log"
  cp "$TEMP_ROOT/corrupt-archive.err" "$ATM_TEST_ARTIFACT_DIR/corrupt-archive.stderr.log"
  cp "$TEMP_ROOT/rollback-install.sh.service.jsonl" "$ATM_TEST_ARTIFACT_DIR/rollback-service-events.jsonl"
  cp "$TEMP_ROOT/rollback.err" "$ATM_TEST_ARTIFACT_DIR/rollback.stderr.log"
  cp "$TEMP_ROOT/atm-release-manifest.json" "$ATM_TEST_ARTIFACT_DIR/verified-release-manifest.json"
  printf '%s\n' "$remote_output" >"$ATM_TEST_ARTIFACT_DIR/remote-bootstrap.json"
  cp "$TEMP_ROOT/refused.err" "$ATM_TEST_ARTIFACT_DIR/refusal.stderr.log"
  printf 'before=%s\nafter=%s\n' "$before" "$after" >"$ATM_TEST_ARTIFACT_DIR/refusal-fingerprint.txt"
fi

printf '%s\n' 'installer migration and refusal scenarios passed'
