#!/usr/bin/env bash
set -euo pipefail

if [ -z "${ATM_RELEASE_RAILWAY_CLI_IMAGE+x}" ]; then
  readonly ATM_RELEASE_RAILWAY_CLI_IMAGE='ghcr.io/railwayapp/cli@sha256:9b52f6d5c0d9d4878c1d7b9a3d1f6299030b19cb3a4ae4cc1e42995311b6327b'
fi

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

atm_release_docker() {
  command timeout --signal=TERM 1200s docker "$@"
}

atm_release_railway_deploy() (
  set -euo pipefail
  test "$#" -eq 6 || return 1

  local source_root
  source_root="$(cd "$1" && pwd)" || return 1
  local revision="$2"
  local project="$3"
  local environment="$4"
  local service="$5"
  local message="$6"

  test -n "${RAILWAY_TOKEN:-}" || return 1
  test -n "$project" || return 1
  test -n "$environment" || return 1
  test -n "$service" || return 1
  test -n "$message" || return 1
  [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || return 1
  git -C "$source_root" cat-file -e "$revision^{commit}" || return 1

  local deploy_root
  deploy_root="$(mktemp -d)" || return 1
  trap 'rm -rf "$deploy_root"' EXIT
  git -C "$source_root" archive "$revision" \
    | tar -xf - -C "$deploy_root" || return 1

  atm_release_docker run --rm --platform linux/amd64 \
    -e RAILWAY_TOKEN \
    "$ATM_RELEASE_RAILWAY_CLI_IMAGE" \
    railway variable set "ATM_ORIGIN_REVISION=$revision" \
    --project "$project" \
    --environment "$environment" \
    --service "$service" \
    --skip-deploys || return 1

  atm_release_docker run --rm --platform linux/amd64 \
    -e RAILWAY_TOKEN \
    --volume "$deploy_root:/workspace:ro" \
    --workdir /workspace \
    "$ATM_RELEASE_RAILWAY_CLI_IMAGE" \
    railway up /workspace \
    --project "$project" \
    --environment "$environment" \
    --service "$service" \
    --message "$message" \
    --ci
)

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
