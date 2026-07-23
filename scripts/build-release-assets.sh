#!/usr/bin/env bash
set -euo pipefail

TAG="${1:?release tag is required}"
COMMIT="${2:?release commit is required}"
OUTPUT="${3:?output directory is required}"
REPOSITORY="${ATM_RELEASE_REPOSITORY:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
TELEMETRY_KEY="${ATM_RELEASE_POSTHOG_API_KEY:?ATM_RELEASE_POSTHOG_API_KEY is required}"

[[ "$TELEMETRY_KEY" =~ ^[A-Za-z0-9_]+$ ]]

sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

[[ "$TAG" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
version="${TAG#v}"
[ "$(git -C "$REPOSITORY" show "$COMMIT:package.json" | jq -r '.version')" = "$version" ]

mkdir -p "$OUTPUT"
test -z "$(git -C "$REPOSITORY" ls-tree -r "$COMMIT" | awk '$1 == "120000" { print; exit }')"

archive="$OUTPUT/atm-$TAG.tar.gz"
stage="$(mktemp -d "${TMPDIR:-/tmp}/atm-release-stage.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/agent-trajectory-marketplace"
git -C "$REPOSITORY" archive --format=tar "$COMMIT" |
  tar -xf - -C "$stage/agent-trajectory-marketplace"
if tar --version 2>/dev/null | grep -q 'GNU tar'; then
  timestamp="$(git -C "$REPOSITORY" show -s --format=%ct "$COMMIT")"
  tar --format=ustar --sort=name --mtime="@$timestamp" --owner=0 --group=0 --numeric-owner \
    -cf - -C "$stage" agent-trajectory-marketplace | gzip -n >"$archive"
else
  COPYFILE_DISABLE=1 tar --format ustar --uid 0 --gid 0 --uname root --gname root \
    -cf - -C "$stage" agent-trajectory-marketplace | gzip -n >"$archive"
fi
checksum="$(sha256 "$archive")"
size="$(wc -c <"$archive" | tr -d '[:space:]')"
jq -n \
  --arg version "$version" \
  --arg tag "$TAG" \
  --arg name "$(basename "$archive")" \
  --arg sha256 "$checksum" \
  --argjson size "$size" \
  '{schemaVersion:1,packageName:"agent-trajectory-marketplace",version:$version,tag:$tag,archive:{name:$name,size:$size,sha256:$sha256}}' \
  >"$OUTPUT/atm-release-manifest.json"

for installer in install.sh install-agent.sh install-core.sh; do
  if [ "$installer" = install-core.sh ]; then
    git -C "$REPOSITORY" show "$COMMIT:scripts/$installer" |
      sed "s/__ATM_RELEASE_POSTHOG_API_KEY__/$TELEMETRY_KEY/" >"$OUTPUT/$installer"
    ! grep -Fq '__ATM_RELEASE_POSTHOG_API_KEY__' "$OUTPUT/$installer"
  else
    git -C "$REPOSITORY" show "$COMMIT:scripts/$installer" >"$OUTPUT/$installer"
  fi
  sha256 "$OUTPUT/$installer" >"$OUTPUT/$installer.sha256"
done
