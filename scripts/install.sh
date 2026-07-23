#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"
CORE="$SCRIPT_DIR/install-core.sh"
if [ ! -f "$CORE" ]; then
  command -v curl >/dev/null || { printf '%s\n' 'curl is required.' >&2; exit 1; }
  command -v bun >/dev/null || { printf '%s\n' 'Bun 1.3.0 or newer is required.' >&2; exit 1; }
  ATM_BOOTSTRAP_TEMP="$(mktemp -d "${TMPDIR:-/tmp}/atm-bootstrap.XXXXXX")"
  trap 'rm -rf "$ATM_BOOTSTRAP_TEMP"' EXIT
  curl -fsSL "https://api.github.com/repos/effortprogrammer/agent-trajectory-marketplace/releases/latest" -o "$ATM_BOOTSTRAP_TEMP/release.json"
  IFS=$'\t' read -r ATM_BOOTSTRAP_TAG ATM_CORE_DIGEST ATM_CHECKSUM_DIGEST < <(bun -e '
    const release=await Bun.file(process.argv[1]).json();
    if(release.immutable!==true||release.draft!==false||release.prerelease!==false||!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.tag_name))process.exit(1);
    const asset=(name)=>{const matches=release.assets.filter((value)=>value.name===name);if(matches.length!==1)process.exit(1);const value=matches[0];const expected=`https://github.com/effortprogrammer/agent-trajectory-marketplace/releases/download/${release.tag_name}/${name}`;if(value.browser_download_url!==expected||!/^sha256:[a-f0-9]{64}$/.test(value.digest))process.exit(1);return value.digest.slice(7)};
    console.log([release.tag_name,asset("install-core.sh"),asset("install-core.sh.sha256")].join("\t"));
  ' "$ATM_BOOTSTRAP_TEMP/release.json")
  CORE="$ATM_BOOTSTRAP_TEMP/install-core.sh"
  curl -fsSL "https://github.com/effortprogrammer/agent-trajectory-marketplace/releases/download/$ATM_BOOTSTRAP_TAG/install-core.sh" -o "$CORE"
  curl -fsSL "https://github.com/effortprogrammer/agent-trajectory-marketplace/releases/download/$ATM_BOOTSTRAP_TAG/install-core.sh.sha256" -o "$ATM_BOOTSTRAP_TEMP/install-core.sh.sha256"
  atm_sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
  [ "$(atm_sha256 "$CORE")" = "$ATM_CORE_DIGEST" ] || { printf '%s\n' 'Release installer core digest mismatch.' >&2; exit 1; }
  [ "$(atm_sha256 "$ATM_BOOTSTRAP_TEMP/install-core.sh.sha256")" = "$ATM_CHECKSUM_DIGEST" ] || { printf '%s\n' 'Release checksum asset digest mismatch.' >&2; exit 1; }
  ATM_EXPECTED_CORE="$(tr -d '[:space:]' <"$ATM_BOOTSTRAP_TEMP/install-core.sh.sha256")"
  [[ "$ATM_EXPECTED_CORE" =~ ^[a-f0-9]{64}$ ]] && [ "$ATM_EXPECTED_CORE" = "$ATM_CORE_DIGEST" ] || { printf '%s\n' 'Release installer checksum mismatch.' >&2; exit 1; }
fi
# shellcheck source=install-core.sh
source "$CORE"
atm_install "$@"
