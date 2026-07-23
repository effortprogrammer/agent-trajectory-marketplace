#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/release.yml"
TEMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEMP_ROOT"' EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

[[ -f "$WORKFLOW" ]] || fail "release workflow is missing"
grep -Fq "'v*.*.*'" "$WORKFLOW" || fail "release workflow is not restricted to stable version tags"
grep -Fq 'github.ref_protected' "$WORKFLOW" || fail "release workflow does not require protected tags"
grep -Fq 'scripts/build-release-assets.sh "$TAG" "$GITHUB_SHA"' "$WORKFLOW" || fail "workflow does not execute the release artifact builder"
grep -Fq 'secrets.ATM_RELEASE_POSTHOG_API_KEY' "$WORKFLOW" || fail "workflow does not inject the telemetry key from a GitHub secret"
grep -Fq 'atm-release-manifest.json' "$WORKFLOW" || fail "release manifest asset is missing"
grep -Fq 'install-agent.sh.sha256' "$WORKFLOW" || fail "release bootstrap checksum asset is missing"
grep -Fq 'install-core.sh.sha256' "$WORKFLOW" || fail "release core checksum asset is missing"
grep -Fq 'sha256' "$WORKFLOW" || fail "release manifest omits the archive checksum"
grep -Fq 'stat -c%s' "$WORKFLOW" || fail "release manifest omits the archive size"
grep -Fq 'gh release create' "$WORKFLOW" || fail "workflow does not create a GitHub Release"
grep -Fq -- '--verify-tag' "$WORKFLOW" || fail "release creation does not require the triggering tag"
grep -Fq '.immutable == true' "$WORKFLOW" || fail "release workflow does not verify immutable release metadata"
grep -Fq '.digest == ("sha256:" + $manifest[0].archive.sha256)' "$WORKFLOW" || fail "release asset digest is not rebound to the manifest"

fixture="$TEMP_ROOT/repository"
output="$TEMP_ROOT/output"
mkdir -p "$fixture/scripts" "$output"
printf '%s\n' '{"name":"agent-trajectory-marketplace","version":"1.2.3"}' >"$fixture/package.json"
cp "$ROOT/scripts/install.sh" "$fixture/scripts/install.sh"
cp "$ROOT/scripts/install-agent.sh" "$fixture/scripts/install-agent.sh"
cp "$ROOT/scripts/install-core.sh" "$fixture/scripts/install-core.sh"
if rg -q 'export ATM_POSTHOG_API_KEY="phc_' "$fixture/scripts/install-core.sh"; then
  fail "installer core contains the telemetry key in source"
fi
git -C "$fixture" init -q
git -C "$fixture" add .
git -C "$fixture" -c user.name=ATM -c user.email=atm@example.invalid commit -qm fixture
commit="$(git -C "$fixture" rev-parse HEAD)"
ATM_RELEASE_REPOSITORY="$fixture" ATM_RELEASE_POSTHOG_API_KEY="phc_test_release_key" \
  bash "$ROOT/scripts/build-release-assets.sh" v1.2.3 "$commit" "$output"
grep -Fq 'export ATM_POSTHOG_API_KEY="phc_test_release_key"' "$output/install-core.sh" || fail "release installer core does not receive the configured telemetry key"
bun -e '
  import {parseUpdateReleaseManifest} from "./src/trajectory/update-release-contract";
  import {verifyUpdateReleaseArchive} from "./src/trajectory/update-release-archive";
  const [manifestPath,archivePath]=process.argv.slice(1);
  const input=await Bun.file(manifestPath).json();
  const manifest=parseUpdateReleaseManifest(input,{currentVersion:"1.2.2",releaseTag:input.tag,archiveAsset:{name:input.archive.name,size:input.archive.size,digest:`sha256:${input.archive.sha256}`}});
  const archive=new Uint8Array(await Bun.file(archivePath).arrayBuffer());
  const verified=await verifyUpdateReleaseArchive(archive,manifest);
  if(verified.version!=="1.2.3")process.exit(1);
' "$output/atm-release-manifest.json" "$output/atm-v1.2.3.tar.gz" || fail "generated release does not pass the production archive verifier"
if [ -n "${ATM_TEST_ARTIFACT_DIR:-}" ]; then
  mkdir -p "$ATM_TEST_ARTIFACT_DIR"
  cp "$output/atm-release-manifest.json" "$ATM_TEST_ARTIFACT_DIR/generated-release-manifest.json"
  cp "$output/atm-v1.2.3.tar.gz" "$ATM_TEST_ARTIFACT_DIR/generated-release.tar.gz"
  printf '%s\n' '{"status":"verified","version":"1.2.3"}' >"$ATM_TEST_ARTIFACT_DIR/generated-release-verification.json"
fi
printf '%s\n' corrupt >>"$output/atm-v1.2.3.tar.gz"
if bun -e '
  import {parseUpdateReleaseManifest} from "./src/trajectory/update-release-contract";
  import {verifyUpdateReleaseArchive} from "./src/trajectory/update-release-archive";
  const [manifestPath,archivePath]=process.argv.slice(1);
  const input=await Bun.file(manifestPath).json();
  const manifest=parseUpdateReleaseManifest(input,{currentVersion:"1.2.2",releaseTag:input.tag,archiveAsset:{name:input.archive.name,size:input.archive.size,digest:`sha256:${input.archive.sha256}`}});
  await verifyUpdateReleaseArchive(new Uint8Array(await Bun.file(archivePath).arrayBuffer()),manifest);
' "$output/atm-release-manifest.json" "$output/atm-v1.2.3.tar.gz" >/dev/null 2>&1; then
  fail "production verifier accepted a corrupt generated archive"
fi

if rg -n 'raw\.githubusercontent\.com/.*/main|github\.com/.*/main/' "$ROOT/README.md" "$ROOT/scripts/install.sh" "$ROOT/scripts/install-agent.sh"; then
  fail "bootstrap still executes mutable main"
fi
grep -Fq '/releases/latest/download/install-agent.sh' "$ROOT/README.md" || fail "README one-liner does not resolve the stable release installer asset"
grep -Fq '/releases/download/$ATM_BOOTSTRAP_TAG/install-core.sh' "$ROOT/scripts/install-agent.sh" || fail "agent wrapper does not bind its core asset to a release tag"
grep -Fq '/releases/download/$ATM_BOOTSTRAP_TAG/install-core.sh.sha256' "$ROOT/scripts/install-agent.sh" || fail "agent wrapper does not bind its checksum asset to the same release tag"

printf '%s\n' 'release workflow contract passed'
