#!/usr/bin/env bash
# allow: SIZE_OK — this checksum-bound standalone bootstrap cannot source an unverified companion.

ATM_REPOSITORY="https://github.com/effortprogrammer/agent-trajectory-marketplace.git"
ATM_DESTINATION="agent-trajectory-marketplace"
ATM_AGENT=""
ATM_COLLECT_OUT=""
ATM_COLLECT_OUT_SET=0
ATM_RELEASE_VERSION=""
ATM_RELEASE_SOURCE=""
export ATM_POSTHOG_API_KEY="__ATM_RELEASE_POSTHOG_API_KEY__"

atm_usage() {
  cat <<'EOF'
Usage: install.sh [--dir PATH] [--out PATH] [--agent claude-code|codex]

Requires Git and Bun 1.3 or newer. Installs the latest stable ATM release,
starts the collector, and enables six-hour stable-release updates. Persistent
services require macOS launchd or Linux systemd --user.
EOF
}

atm_fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

atm_parse_options() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --dir)
        [ "$#" -ge 2 ] || atm_fail '--dir requires a path'
        ATM_DESTINATION="$2"
        shift 2
        ;;
      --agent)
        [ "$#" -ge 2 ] || atm_fail '--agent requires claude-code or codex'
        ATM_AGENT="$2"
        shift 2
        ;;
      --out)
        [ "$#" -ge 2 ] || atm_fail '--out requires a path'
        ATM_COLLECT_OUT="$2"
        ATM_COLLECT_OUT_SET=1
        shift 2
        ;;
      --help|-h)
        atm_usage
        exit 0
        ;;
      *)
        atm_usage >&2
        atm_fail "Unknown option: $1"
        ;;
    esac
  done
  case "$ATM_AGENT" in
    ""|claude-code|codex) ;;
    *) atm_fail "Unsupported agent: $ATM_AGENT" ;;
  esac
}

atm_require_tools() {
  command -v git >/dev/null || atm_fail 'git is required.'
  command -v bun >/dev/null || atm_fail 'Bun 1.3.0 or newer is required.'
  local version major remainder minor
  version="$(bun --version)"
  major="${version%%.*}"
  remainder="${version#*.}"
  minor="${remainder%%.*}"
  case "$major:$minor" in
    *[!0-9:]*) atm_fail 'Bun 1.3.0 or newer is required.' ;;
  esac
  if [ "$major" -lt 1 ] || { [ "$major" -eq 1 ] && [ "$minor" -lt 3 ]; }; then
    atm_fail 'Bun 1.3.0 or newer is required.'
  fi
}

atm_package_version() {
  bun -e 'const p=await Bun.file(process.argv[1]).json(); if(p.name!=="agent-trajectory-marketplace"||!/^\d+\.\d+\.\d+$/.test(p.version))process.exit(1); process.stdout.write(p.version)' "$1/package.json"
}

atm_classify_legacy() {
  local root="$1" origin status dirty_line
  [ -d "$root/.git" ] || { printf '%s' 'partial'; return; }
  origin="$(git -C "$root" config --get remote.origin.url 2>/dev/null || true)"
  origin="${origin%.git}"
  case "$origin" in
    https://github.com/effortprogrammer/agent-trajectory-marketplace|git@github.com:effortprogrammer/agent-trajectory-marketplace|ssh://git@github.com/effortprogrammer/agent-trajectory-marketplace) ;;
    *) printf '%s' 'unrecognized'; return ;;
  esac
  atm_package_version "$root" >/dev/null 2>&1 || { printf '%s' 'unrecognized'; return; }
  status="$(git -C "$root" status --porcelain --untracked-files=all 2>/dev/null)" || { printf '%s' 'partial'; return; }
  while IFS= read -r dirty_line; do
    [ -z "$dirty_line" ] && continue
    case "$dirty_line" in
      '?? collected/'*) ;;
      *) printf '%s' 'dirty'; return ;;
    esac
  done <<<"$status"
  printf '%s' 'recognized_clean'
}

atm_classify_destination() {
  local root="$1"
  if [ ! -e "$root" ]; then printf '%s' 'absent'; return; fi
  if [ ! -d "$root" ]; then printf '%s' 'unrecognized'; return; fi
  if [ -f "$root/install-state.json" ]; then
    if bun -e '
      import { lstatSync, realpathSync } from "node:fs";
      import { resolve } from "node:path";
      const root=resolve(process.argv[1]);
      const state=await Bun.file(`${root}/install-state.json`).json();
      const valid=state.schemaVersion===1&&realpathSync(state.installRoot)===realpathSync(root)&&typeof state.outputDir==="string"&&resolve(state.outputDir)===state.outputDir&&lstatSync(`${root}/current`).isSymbolicLink()&&realpathSync(`${root}/current`).startsWith(`${realpathSync(`${root}/releases`)}/`);
      if(!valid) process.exit(1);
    ' "$root" >/dev/null 2>&1; then
      printf '%s' 'stable'
    else
      printf '%s' 'partial'
    fi
    return
  fi
  if [ -f "$root/package.json" ]; then atm_classify_legacy "$root"; return; fi
  printf '%s' 'unrecognized'
}

atm_sha256() {
  if command -v sha256sum >/dev/null; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

atm_file_size() {
  if stat -c%s "$1" >/dev/null 2>&1; then stat -c%s "$1"; else stat -f%z "$1"; fi
}

atm_fetch_verified_release() {
  local staging="$1" metadata manifest archive_info archive_url archive_sha archive_size archive_name
  mkdir -p "$staging"
  metadata="$staging/release.json"
  manifest="$staging/atm-release-manifest.json"
  command -v curl >/dev/null || atm_fail 'curl is required.'
  curl -fsSL "https://api.github.com/repos/effortprogrammer/agent-trajectory-marketplace/releases/latest" -o "$metadata"
  IFS=$'\t' read -r manifest_url manifest_sha < <(bun -e '
    const release=await Bun.file(process.argv[1]).json();
    if(release.immutable!==true||release.draft!==false||release.prerelease!==false||!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.tag_name))process.exit(1);
    const matches=release.assets.filter((asset)=>asset.name==="atm-release-manifest.json");
    if(matches.length!==1)process.exit(1);
    const asset=matches[0], expected=`https://github.com/effortprogrammer/agent-trajectory-marketplace/releases/download/${release.tag_name}/atm-release-manifest.json`;
    if(asset.browser_download_url!==expected||!/^sha256:[a-f0-9]{64}$/.test(asset.digest))process.exit(1);
    console.log(`${asset.browser_download_url}\t${asset.digest.slice(7)}`);
  ' "$metadata") || atm_fail 'Invalid immutable GitHub Release metadata.'
  curl -fsSL "$manifest_url" -o "$manifest"
  [ "$(atm_sha256 "$manifest")" = "$manifest_sha" ] || atm_fail 'Release manifest digest mismatch.'
  archive_info="$(bun -e '
    const [releasePath,manifestPath]=process.argv.slice(1);
    const release=await Bun.file(releasePath).json(), manifest=await Bun.file(manifestPath).json();
    if(manifest.schemaVersion!==1||manifest.packageName!=="agent-trajectory-marketplace"||manifest.tag!==release.tag_name||manifest.version!==release.tag_name.slice(1)||manifest.archive?.name!==`atm-${release.tag_name}.tar.gz`||!Number.isSafeInteger(manifest.archive.size)||manifest.archive.size<1||!`${manifest.archive.sha256}`.match(/^[a-f0-9]{64}$/))process.exit(1);
    const matches=release.assets.filter((asset)=>asset.name===manifest.archive.name);
    if(matches.length!==1)process.exit(1);
    const asset=matches[0], expected=`https://github.com/effortprogrammer/agent-trajectory-marketplace/releases/download/${release.tag_name}/${manifest.archive.name}`;
    if(asset.browser_download_url!==expected||asset.size!==manifest.archive.size||asset.digest!==`sha256:${manifest.archive.sha256}`)process.exit(1);
    console.log([manifest.version,manifest.archive.name,asset.browser_download_url,manifest.archive.sha256,manifest.archive.size].join("\t"));
  ' "$metadata" "$manifest")" || atm_fail 'Release manifest is not bound to GitHub Release metadata.'
  IFS=$'\t' read -r ATM_RELEASE_VERSION archive_name archive_url archive_sha archive_size <<<"$archive_info"
  archive="$staging/$archive_name"
  curl -fsSL "$archive_url" -o "$archive"
  [ "$(atm_file_size "$archive")" = "$archive_size" ] || atm_fail 'Release archive size mismatch.'
  [ "$(atm_sha256 "$archive")" = "$archive_sha" ] || atm_fail 'Release archive digest mismatch.'
  tar -tzf "$archive" >"$staging/archive.list" || atm_fail 'Release archive is not a valid gzip tar.'
  bun -e '
    const paths=(await Bun.file(process.argv[1]).text()).split(/\n/).filter(Boolean);
    if(paths.length===0)process.exit(1);
    for(const path of paths){
      if(path.startsWith("/")||path.includes("\\")||path.split("/").includes("..")||!(path==="agent-trajectory-marketplace"||path.startsWith("agent-trajectory-marketplace/")))process.exit(1);
    }
  ' "$staging/archive.list" || atm_fail 'Release archive contains an unsafe path.'
  mkdir -p "$staging/extracted"
  tar -xzf "$archive" -C "$staging/extracted" --no-same-owner
  ATM_RELEASE_SOURCE="$staging/extracted/agent-trajectory-marketplace"
  [ "$(atm_package_version "$ATM_RELEASE_SOURCE")" = "$ATM_RELEASE_VERSION" ] || atm_fail 'Release archive package version mismatch.'
}

atm_write_state() {
  local root="$1" output="$2" temporary="$1/install-state.json.tmp"
  bun -e '
    const [root,out]=process.argv.slice(1);
    const state={schemaVersion:1,installRoot:root,outputDir:out,service:{runtimes:[],intervalSeconds:30,settleSeconds:60}};
    process.stdout.write(`${JSON.stringify(state,null,2)}\n`);
  ' "$root" "$output" >"$temporary"
  chmod 600 "$temporary"
  mv "$temporary" "$root/install-state.json"
}

atm_build_release() {
  local source="$1"
  (
    cd "$source"
    if [ "${ATM_NONINTERACTIVE:-0}" = 1 ]; then CI=1 bun install --frozen-lockfile; else bun install --frozen-lockfile; fi
    bun run build:collector
  )
}

atm_install_services() {
  local root="$1"
  (
    cd "$root/current"
    # Reconcile drift instead of erroring on it: service install refuses to
    # replace a differing service file, and installs from other releases can
    # legitimately differ (telemetry environment, output dir, runtime flags).
    # Install already restarts the service either way, so clearing the old
    # file first costs nothing and keeps installer reruns idempotent.
    bun dist/collector.js trajectory collect service uninstall >/dev/null 2>&1 || true
    bun dist/collector.js trajectory collect service install --out "$ATM_COLLECT_OUT" >/dev/null || return
    bun dist/collector.js trajectory update service install --state-root "$root" >/dev/null || return
    bun dist/collector.js trajectory collect telemetry installed --out "$ATM_COLLECT_OUT" >/dev/null 2>&1 &
  )
}

atm_restore_legacy_service() {
  local legacy="$1"
  if [ -f "$legacy/dist/collector.js" ]; then
    # The failed migration may have left its own service file behind; service
    # install refuses to replace a differing file, so clear it first or the
    # restore would silently strand a service pointing at the removed root.
    (cd "$legacy" && bun dist/collector.js trajectory collect service uninstall >/dev/null 2>&1) || true
    (cd "$legacy" && bun dist/collector.js trajectory collect service install --out "$legacy/collected" >/dev/null 2>&1) || true
  fi
}

atm_install_fresh() {
  local root="$1" release
  release="$root/releases/$ATM_RELEASE_VERSION"
  mkdir -p "$root/releases" "$ATM_COLLECT_OUT"
  mv "$ATM_RELEASE_SOURCE" "$release"
  ln -s "releases/$ATM_RELEASE_VERSION" "$root/current"
  atm_write_state "$root" "$ATM_COLLECT_OUT"
  if ! atm_install_services "$root"; then
    rm -rf "$root"
    return 1
  fi
}

atm_migrate_legacy() {
  local root="$1" legacy_version backup release source_output output_preexisting=0
  legacy_version="$(atm_package_version "$root")"
  backup="${root}.atm-legacy.$$"
  release="$root/releases/$ATM_RELEASE_VERSION"
  source_output="$root/collected"
  if [ "$ATM_COLLECT_OUT" != "$source_output" ] && [ -e "$ATM_COLLECT_OUT" ]; then
    if [ ! -d "$ATM_COLLECT_OUT" ] || [ -n "$(find "$ATM_COLLECT_OUT" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
      atm_fail "Refusing nonempty output destination without changes: $ATM_COLLECT_OUT"
    fi
  fi
  mv "$root" "$backup"
  mkdir -p "$root/releases"
  mv "$ATM_RELEASE_SOURCE" "$release"
  if [ "$ATM_COLLECT_OUT" = "$source_output" ]; then
    mkdir -p "$ATM_COLLECT_OUT"
    if [ -d "$backup/collected" ]; then cp -R "$backup/collected/." "$ATM_COLLECT_OUT/"; fi
  else
    if [ -e "$ATM_COLLECT_OUT" ]; then output_preexisting=1; else mkdir -p "$ATM_COLLECT_OUT"; fi
    if [ -d "$backup/collected" ]; then cp -R "$backup/collected/." "$ATM_COLLECT_OUT/"; fi
  fi
  ln -s "releases/$ATM_RELEASE_VERSION" "$root/current"
  atm_write_state "$root" "$ATM_COLLECT_OUT"
  if ! atm_install_services "$root"; then
    rm -rf "$root"
    if [ "$ATM_COLLECT_OUT" != "$source_output" ]; then
      rm -rf "$ATM_COLLECT_OUT"
      [ "$output_preexisting" -eq 0 ] || mkdir -p "$ATM_COLLECT_OUT"
    fi
    mv "$backup" "$root"
    atm_restore_legacy_service "$root"
    return 1
  fi
  if [ "$ATM_COLLECT_OUT" != "$source_output" ]; then rm -rf "$backup/collected"; fi
  mv "$backup" "$root/releases/$legacy_version"
  ln -s "releases/$legacy_version" "$root/previous"
}

atm_install() {
  atm_parse_options "$@"
  atm_require_tools
  ATM_DESTINATION="$(bun -e 'import {resolve} from "node:path";process.stdout.write(resolve(process.argv[1]))' "$ATM_DESTINATION")"
  if [ "$ATM_COLLECT_OUT_SET" -eq 1 ]; then
    ATM_COLLECT_OUT="$(bun -e 'import {resolve} from "node:path";process.stdout.write(resolve(process.argv[1]))' "$ATM_COLLECT_OUT")"
  else
    ATM_COLLECT_OUT="$ATM_DESTINATION/collected"
  fi
  local classification version download
  classification="$(atm_classify_destination "$ATM_DESTINATION")"
  case "$classification" in
    dirty|partial|unrecognized) atm_fail "Refusing $classification destination without changes: $ATM_DESTINATION" ;;
    stable)
      version="$(atm_package_version "$ATM_DESTINATION/current")"
      if [ "$ATM_COLLECT_OUT_SET" -eq 0 ]; then
        ATM_COLLECT_OUT="$(bun -e 'const s=await Bun.file(process.argv[1]).json();process.stdout.write(s.outputDir)' "$ATM_DESTINATION/install-state.json")"
      fi
      atm_install_services "$ATM_DESTINATION"
      bun -e 'console.log(JSON.stringify({status:"installed",version:process.argv[1],installRoot:process.argv[2],outputDir:process.argv[3]}))' "$version" "$ATM_DESTINATION" "$ATM_COLLECT_OUT"
      return
      ;;
  esac
  download="$(mktemp -d "${TMPDIR:-/tmp}/atm-release.XXXXXX")"
  trap 'rm -rf "$download"' RETURN
  atm_fetch_verified_release "$download"
  version="$ATM_RELEASE_VERSION"
  atm_build_release "$ATM_RELEASE_SOURCE"
  case "$classification" in
    absent) atm_install_fresh "$ATM_DESTINATION" ;;
    recognized_clean) atm_migrate_legacy "$ATM_DESTINATION" ;;
  esac
  bun -e 'console.log(JSON.stringify({status:"installed",version:process.argv[1],installRoot:process.argv[2],outputDir:process.argv[3]}))' "$version" "$ATM_DESTINATION" "$ATM_COLLECT_OUT"
}
