#!/usr/bin/env bash
set -euo pipefail

atm_release_curl() {
  command curl --connect-timeout 3 --max-time 8 "$@"
}

atm_release_gh_api() {
  command timeout --signal=TERM 20s gh api "$@"
}

atm_release_gh_release() {
  command timeout --signal=TERM 120s gh release "$@"
}

atm_release_wrangler() {
  command timeout --signal=TERM 180s bun run wrangler "$@"
}

atm_release_git_fetch() {
  command timeout --signal=TERM 60s git fetch "$@"
}

atm_release_fingerprinted_asset_path() {
  local root="$1"
  local file="$2"
  local stem="${file%.*}"
  local extension="${file##*.}"
  test "$stem" != "$file"
  local digest
  digest="$(sha256sum "$root/web/$file" | cut -d' ' -f1)"
  printf '/%s.%s.%s\n' "$stem" "$digest" "$extension"
}

atm_release_deployed_asset_path() {
  local root="$1"
  local file="$2"
  local stem="${file%.*}"
  local extension="${file##*.}"
  if grep --quiet --extended-regexp \
    "${stem}\\.[a-f0-9]{64}\\.${extension}" "$root/web/index.html"; then
    atm_release_fingerprinted_asset_path "$root" "$file"
    return
  fi
  printf '/%s\n' "$file"
}

atm_release_require_attested() {
  local attested="$1"
  local message="$2"
  if [ "$attested" != true ]; then
    printf '%s\n' "$message" >&2
    return 1
  fi
}
