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
[[ -f "$ROOT/.github/workflows/promotion-policy.yml" ]] || fail "promotion policy workflow is missing"
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
grep -Fq 'b5d1a8278cb967c6caacde863d764abae5eaae053870084b0ac1659a7fd71674' "$WORKFLOW" || fail "release does not pin the waitlist contract revision"
grep -Fq 'sha256sum --check web/assets.sha256' "$WORKFLOW" || fail "release does not verify the Marketplace web asset revision"
(cd "$ROOT" && sha256sum --check web/assets.sha256 >/dev/null) || fail "Marketplace web asset manifest is stale"
grep -Fq 'https://getatm.io/marketplace.js' "$WORKFLOW" || fail "release does not fetch deployed Marketplace assets"
grep -Fq 'cmp web/marketplace.js "$RUNNER_TEMP/marketplace.js"' "$WORKFLOW" || fail "release does not attest deployed Marketplace bytes"
grep -Fq 'CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}' "$WORKFLOW" || fail "release does not keep the Cloudflare token external"
grep -Fq '"wrangler": "4.58.0"' "$ROOT/package.json" || fail "Wrangler is not pinned in the package manifest"
grep -Fq '"wrangler": ["wrangler@4.58.0"' "$ROOT/bun.lock" || fail "Wrangler is not integrity-pinned in the Bun lockfile"
grep -Fq 'bun install --frozen-lockfile --ignore-scripts' "$WORKFLOW" || fail "release does not install locked tooling before exposing deploy credentials"
grep -Fq 'bun run wrangler deploy --config "$WORKER_CONFIG" --var "WORKER_REVISION:$WORKER_REVISION"' "$WORKFLOW" || fail "release does not deploy the repository-controlled Worker revision"
if grep -Fq 'bunx wrangler' "$WORKFLOW"; then
  fail "release resolves Wrangler dynamically while deploy credentials are present"
fi
grep -Fq 'https://getatm.io/.well-known/atm-worker-revision' "$WORKFLOW" || fail "release does not request the deployed Worker attestation"
grep -Fq 'x-atm-worker-revision: $WORKER_REVISION' "$WORKFLOW" || fail "release does not bind the deployed Worker header to the release revision"
grep -Fq '.revision == $revision' "$WORKFLOW" || fail "release does not bind the deployed Worker body to the release revision"

WORKER_CONFIG="$ROOT/infra/cloudflare/marketplace-apex/wrangler.jsonc"
[[ -f "$WORKER_CONFIG" ]] || fail "Marketplace Worker configuration is missing"
grep -Fq '"main": "index.js"' "$WORKER_CONFIG" || fail "Marketplace Worker deployment does not use the source-tracked entrypoint"
grep -Fq '"pattern": "getatm.io/*"' "$WORKER_CONFIG" || fail "Marketplace Worker deployment does not bind the apex route"

while IFS= read -r action; do
  [[ "$action" =~ ^[^[:space:]@]+@[a-f0-9]{40}[[:space:]]+\#[[:space:]]+v[0-9]+(\.[0-9]+){0,2}$ ]] \
    || fail "GitHub Action is not pinned to an immutable revision with a version comment: $action"
done < <(grep -RhE '^[[:space:]]*uses:[[:space:]]+' "$ROOT/.github/workflows" | sed -E 's/^[[:space:]]*uses:[[:space:]]+//')

CI_WORKFLOW="$ROOT/.github/workflows/ci.yml"
grep -Fq -- "-name '*.test.js'" "$CI_WORKFLOW" || fail "CI does not discover JavaScript Worker tests"
grep -Fq 'b5d1a8278cb967c6caacde863d764abae5eaae053870084b0ac1659a7fd71674' "$CI_WORKFLOW" || fail "CI does not pin the waitlist contract revision"
grep -Fq 'sha256sum --check web/assets.sha256' "$CI_WORKFLOW" || fail "CI does not verify the Marketplace web asset revision"
grep -Fq 'startCommand = "bun web/server.ts"' "$ROOT/railway.toml" || fail "Railway deployment does not run the source-tracked Marketplace server"

fixture="$TEMP_ROOT/repository"
output="$TEMP_ROOT/output"
mkdir -p "$fixture/scripts" "$output"
printf '%s\n' '{"name":"agent-trajectory-marketplace","version":"1.2.3"}' >"$fixture/package.json"
cp "$ROOT/scripts/install.sh" "$fixture/scripts/install.sh"
cp "$ROOT/scripts/install-agent.sh" "$fixture/scripts/install-agent.sh"
cp "$ROOT/scripts/install-core.sh" "$fixture/scripts/install-core.sh"
if grep -q 'export ATM_POSTHOG_API_KEY="phc_' "$fixture/scripts/install-core.sh"; then
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

if grep -nE 'raw\.githubusercontent\.com/.*/main|github\.com/.*/main/' "$ROOT/scripts/install.sh" "$ROOT/scripts/install-agent.sh"; then
  fail "bootstrap still executes mutable main"
fi
grep -Fq '/releases/download/$ATM_BOOTSTRAP_TAG/install-core.sh' "$ROOT/scripts/install-agent.sh" || fail "agent wrapper does not bind its core asset to a release tag"
grep -Fq '/releases/download/$ATM_BOOTSTRAP_TAG/install-core.sh.sha256' "$ROOT/scripts/install-agent.sh" || fail "agent wrapper does not bind its checksum asset to the same release tag"

printf '%s\n' 'release workflow contract passed'
