#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/release.yml"
RAILWAY_CONTRACT="$ROOT/infra/railway/deployment-contract.json"
RELEASE_NETWORK="$ROOT/scripts/release-network.sh"
TEMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEMP_ROOT"' EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

[[ -f "$WORKFLOW" ]] || fail "release workflow is missing"
[[ -f "$ROOT/.github/workflows/promotion-policy.yml" ]] || fail "promotion policy workflow is missing"
[[ -f "$RAILWAY_CONTRACT" ]] || fail "Railway deployment contract is missing"
[[ -x "$RELEASE_NETWORK" ]] || fail "bounded release network helpers are missing or not executable"
grep -Fq -- '--connect-timeout 3' "$RELEASE_NETWORK" || fail "release curl connect timeout is missing"
grep -Fq -- '--max-time 8' "$RELEASE_NETWORK" || fail "release curl request timeout is missing"
grep -Fq 'timeout --signal=TERM 20s gh api' "$RELEASE_NETWORK" || fail "release GitHub API timeout is missing"
grep -Fq 'timeout --signal=TERM 120s gh release' "$RELEASE_NETWORK" || fail "GitHub release timeout is missing"
grep -Fq 'timeout --signal=TERM 180s bun run wrangler' "$RELEASE_NETWORK" || fail "Worker deploy timeout is missing"
grep -Fq 'timeout --signal=TERM 60s git fetch' "$RELEASE_NETWORK" || fail "release fetch timeout is missing"
jq -e '
  .projectId == "ac736878-3095-4c1d-b8c4-e0a184c06ece" and
  .staging.environment == "staging" and
  .staging.service == "marketplace-web" and
  .staging.branch == "dev" and
  .staging.domain == "https://marketplace-web-staging.up.railway.app" and
  .production.environment == "production" and
  .production.service == "marketplace-web-production" and
  .production.branch == "production" and
  .production.domain == "https://marketplace-web-production-production.up.railway.app" and
  .production.revisionPath == "/.well-known/atm-origin-revision" and
  .production.requiredStatus == "release-production-approved" and
  .production.trigger == "protected-release-tag"
' "$RAILWAY_CONTRACT" >/dev/null || fail "Railway deployment contract is invalid"
grep -Fq "'v*.*.*'" "$WORKFLOW" || fail "release workflow is not restricted to stable version tags"
grep -Fq 'github.ref_protected' "$WORKFLOW" || fail "release workflow does not require protected tags"
grep -Fq 'group: marketplace-production-release' "$WORKFLOW" || fail "production releases are not serialized"
grep -Fq 'cancel-in-progress: false' "$WORKFLOW" || fail "a newer release can cancel an active production deployment"
grep -Fq 'timeout-minutes: 60' "$WORKFLOW" || fail "release timeout cannot cover deploy, attestation, and rollback bounds"
grep -Fq 'source scripts/release-network.sh' "$WORKFLOW" || fail "release workflow does not load bounded network helpers"
if grep -Eq '(^|[[:space:]])(curl|gh api|gh release create|bun run wrangler deploy|git fetch)([[:space:]]|$)' "$WORKFLOW"; then
  fail "release workflow contains an unbounded external command"
fi
grep -Fq 'statuses: write' "$WORKFLOW" || fail "release cannot authorize the production ref update"
grep -Fq 'statuses/$GITHUB_SHA' "$WORKFLOW" || fail "release does not bind production approval to the tag commit"
grep -Fq 'release-production-approved' "$WORKFLOW" || fail "release does not emit the production approval status"
grep -Fq 'atm_release_git_fetch --no-tags origin main dev production' "$WORKFLOW" || fail "release does not refresh approved branch tips"
grep -Fq 'refs/remotes/origin/main' "$WORKFLOW" || fail "release tag is not bound to the approved main head"
grep -Fq 'merge-base --is-ancestor refs/remotes/origin/dev "$GITHUB_SHA"' "$WORKFLOW" || fail "release tag is not descended from tested dev"
grep -Fq 'merge-base --is-ancestor refs/remotes/origin/production "$GITHUB_SHA"' "$WORKFLOW" || fail "release cannot prove a production fast-forward"
grep -Fq 'PRODUCTION_BRANCH: production' "$WORKFLOW" || fail "release does not target the Railway production branch"
grep -Fq 'git/refs/heads/$PRODUCTION_BRANCH' "$WORKFLOW" || fail "release does not advance the production branch"
grep -Fq -- '--field "sha=$GITHUB_SHA"' "$WORKFLOW" || fail "production branch is not bound to the protected tag commit"
grep -Fq -- '--field force=false' "$WORKFLOW" || fail "production branch promotion permits non-fast-forward updates"
grep -Fq 'ORIGIN_URL: https://marketplace-web-production-production.up.railway.app' "$WORKFLOW" || fail "release does not target the Railway production origin"
grep -Fq '$ORIGIN_URL/.well-known/atm-origin-revision' "$WORKFLOW" || fail "release does not attest the Railway source revision"
grep -Fq 'x-atm-origin-revision: $GITHUB_SHA' "$WORKFLOW" || fail "release does not bind the Railway revision header"
grep -Fq '.revision == $revision' "$WORKFLOW" || fail "release does not bind the Railway revision body"
grep -Fq 'deployed_ref="$(' "$WORKFLOW" || fail "release does not re-read the production ref after deployment"
grep -Fq 'Roll back failed production promotion' "$WORKFLOW" || fail "failed release does not restore the prior production ref"
grep -Fq 'git worktree add --detach "$ROLLBACK_ROOT" "$PREVIOUS_SHA"' "$WORKFLOW" || fail "failed release does not restore the prior Worker source"
grep -Fq '$ORIGIN_URL/marketplace.js' "$WORKFLOW" || fail "rollback does not read prior bytes from the Railway origin"
grep -Fq 'rollback-origin-marketplace.js' "$WORKFLOW" || fail "rollback origin bytes are not isolated from apex bytes"
grep -Fq 'WORKER_REVISION:$PREVIOUS_SHA' "$WORKFLOW" || fail "Worker rollback is not bound to the prior production revision"
grep -Fq 'Wait for and attest tagged Marketplace production bytes' "$WORKFLOW" || fail "release does not wait for tagged production bytes"
grep -Fq 'Re-attest Marketplace production after Worker deployment' "$WORKFLOW" || fail "release does not verify public bytes after Worker deployment"
grep -Fq 'for attempt in $(seq 1 24)' "$WORKFLOW" || fail "production attestation wait is not bounded"
grep -Fq 'for attempt in $(seq 1 18)' "$WORKFLOW" || fail "rollback attestation wait is not bounded"
grep -Fq 'for attempt in $(seq 1 6)' "$WORKFLOW" || fail "post-Worker attestation wait is not bounded"
validation_line="$(grep -nF 'Validate stable protected tag' "$WORKFLOW" | cut -d: -f1)"
build_line="$(grep -nF 'Build source archive and bound manifest' "$WORKFLOW" | cut -d: -f1)"
promotion_line="$(grep -nF 'Promote protected tag to production branch' "$WORKFLOW" | cut -d: -f1)"
attestation_line="$(grep -nF 'Wait for and attest tagged Marketplace production bytes' "$WORKFLOW" | cut -d: -f1)"
worker_line="$(grep -nF 'Deploy and attest Marketplace apex Worker revision' "$WORKFLOW" | cut -d: -f1)"
post_worker_line="$(grep -nF 'Re-attest Marketplace production after Worker deployment' "$WORKFLOW" | cut -d: -f1)"
release_line="$(grep -nF 'Create immutable release assets' "$WORKFLOW" | cut -d: -f1)"
[[ -n "$validation_line" && -n "$build_line" && -n "$promotion_line" && -n "$attestation_line" \
  && -n "$worker_line" && -n "$post_worker_line" && -n "$release_line" \
  && "$validation_line" -lt "$build_line" \
  && "$build_line" -lt "$promotion_line" \
  && "$promotion_line" -lt "$attestation_line" \
  && "$attestation_line" -lt "$worker_line" \
  && "$worker_line" -lt "$post_worker_line" \
  && "$post_worker_line" -lt "$release_line" ]] \
  || fail "production bytes are attested before the protected tag is promoted"
grep -Fq 'scripts/build-release-assets.sh "$TAG" "$GITHUB_SHA"' "$WORKFLOW" || fail "workflow does not execute the release artifact builder"
grep -Fq 'secrets.ATM_RELEASE_POSTHOG_API_KEY' "$WORKFLOW" || fail "workflow does not inject the telemetry key from a GitHub secret"
grep -Fq 'atm-release-manifest.json' "$WORKFLOW" || fail "release manifest asset is missing"
grep -Fq 'install-agent.sh.sha256' "$WORKFLOW" || fail "release bootstrap checksum asset is missing"
grep -Fq 'install-core.sh.sha256' "$WORKFLOW" || fail "release core checksum asset is missing"
grep -Fq 'sha256' "$WORKFLOW" || fail "release manifest omits the archive checksum"
grep -Fq 'stat -c%s' "$WORKFLOW" || fail "release manifest omits the archive size"
grep -Fq 'atm_release_gh_release create' "$WORKFLOW" || fail "workflow does not create a GitHub Release"
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
grep -Fq 'atm_release_wrangler deploy --config "$WORKER_CONFIG"' "$WORKFLOW" || fail "release does not deploy the repository-controlled Worker revision"
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
