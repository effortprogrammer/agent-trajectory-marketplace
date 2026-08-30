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

grep -Fq 'stage:' "$WORKFLOW" \
  || fail "release has no exact-tag staging prerequisite"
grep -Fq 'uses: ./.github/workflows/deploy-staging.yml' "$WORKFLOW" \
  || fail "release does not reuse the byte-attested staging deployment"
grep -Fq 'revision: ${{ github.sha }}' "$WORKFLOW" \
  || fail "release staging is not bound to the exact protected tag commit"
grep -Fq 'needs: stage' "$WORKFLOW" \
  || fail "production release can start before exact staging attestation"

source "$ROOT/scripts/version-contract.sh"
source "$RELEASE_NETWORK"

DOCKER_LOG="$TEMP_ROOT/docker.log"
atm_release_docker() {
  printf '%s\n' "$*" >>"$DOCKER_LOG"
}

revision="$(git -C "$ROOT" rev-parse HEAD)"
if (
  unset RAILWAY_TOKEN
  atm_release_railway_deploy \
    "$ROOT" "$revision" project-id staging service-name "staging:$revision"
) >/dev/null 2>&1; then
  fail "Railway deploy accepts a missing project token"
fi
if (
  export RAILWAY_TOKEN=test-token
  atm_release_railway_deploy \
    "$ROOT" not-a-revision project-id staging service-name "staging:$revision"
) >/dev/null 2>&1; then
  fail "Railway deploy accepts an invalid revision"
fi
export RAILWAY_TOKEN=test-token
atm_release_railway_deploy \
  "$ROOT" "$revision" project-id staging service-name "staging:$revision"
grep -Fq "railway variable set ATM_ORIGIN_REVISION=$revision" "$DOCKER_LOG" \
  || fail "Railway deploy does not persist the exact source revision"
grep -Fq -- '--project project-id --environment staging --service service-name --skip-deploys' \
  "$DOCKER_LOG" || fail "Railway revision mutation is not exactly scoped"
grep -Fq 'railway up /workspace' "$DOCKER_LOG" \
  || fail "Railway deploy does not upload the archived source"
grep -Fq -- "--message staging:$revision --ci" "$DOCKER_LOG" \
  || fail "Railway deploy does not wait for the named deployment"
if grep -Fq test-token "$DOCKER_LOG"; then
  fail "Railway project token leaked into the Docker command"
fi
unset RAILWAY_TOKEN

atm_is_stable_tag "v1.0.11" || fail "SemVer tag is no longer accepted"
atm_is_stable_tag "v2026.08.18.2" || fail "CalVer tag is not accepted"
if atm_is_stable_tag "v2026.02.30.1"; then
  fail "impossible CalVer date was accepted"
fi
if atm_is_stable_tag "v2026.08.18.02"; then
  fail "zero-padded CalVer revision was accepted"
fi

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
source "$RELEASE_NETWORK"
expected_marketplace_path="/marketplace.$(
  sha256sum "$ROOT/web/marketplace.js" | cut -d' ' -f1
).js"
actual_marketplace_path="$(
  atm_release_fingerprinted_asset_path "$ROOT" marketplace.js
)"
[[ "$actual_marketplace_path" == "$expected_marketplace_path" ]] \
  || fail "release fingerprint helper is not bound to asset bytes"
actual_deployed_path="$(
  atm_release_deployed_asset_path "$ROOT" marketplace.js
)"
[[ "$actual_deployed_path" == "$expected_marketplace_path" ]] \
  || fail "fingerprinted deployment path is not detected"
mkdir -p "$TEMP_ROOT/legacy/web" "$TEMP_ROOT/query/web"
printf '%s\n' '<script type="module" src="marketplace.js"></script>' \
  >"$TEMP_ROOT/legacy/web/index.html"
printf '%s\n' '<script type="module" src="marketplace.js?v=abc"></script>' \
  >"$TEMP_ROOT/query/web/index.html"
[[ "$(atm_release_deployed_asset_path "$TEMP_ROOT/legacy" marketplace.js)" == "/marketplace.js" ]] \
  || fail "legacy unversioned production path is not preserved"
[[ "$(atm_release_deployed_asset_path "$TEMP_ROOT/query" marketplace.js)" == "/marketplace.js" ]] \
  || fail "query-versioned production path is not preserved"
atm_release_require_attested true "unexpected failure" \
  || fail "successful release attestation is rejected"
if atm_release_require_attested false "expected exhaustion" >/dev/null 2>&1; then
  fail "release attestation exhaustion is not fatal"
fi
READY_TERMS_VERSION=2026-08-28
READY_PRIVACY_VERSION=2026-08-28
atm_release_curl() {
  local headers=""
  local body=""
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --dump-header)
        headers="$2"
        shift 2
        ;;
      --output)
        body="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done
  printf 'HTTP/2 200\r\ncache-control: no-store\r\nx-atm-account-terms-version: %s\r\nx-atm-account-privacy-version: %s\r\n\r\n' \
    "$READY_TERMS_VERSION" "$READY_PRIVACY_VERSION" >"$headers"
  printf '%s\n' '{"status":"ok"}' >"$body"
}
atm_release_require_registry_policy_ready \
  https://gateway.getatm.io 2026-08-28 2026-08-28 \
  || fail "matching Registry policy readiness is rejected"
READY_PRIVACY_VERSION=legacy-unversioned
if atm_release_require_registry_policy_ready \
    https://gateway.getatm.io 2026-08-28 2026-08-28; then
  fail "mismatched Registry privacy readiness is accepted"
fi
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
  .production.deploymentMode == "github-actions-cli" and
  .production.sourceIntegration == false and
  .production.revisionVariable == "ATM_ORIGIN_REVISION" and
  .production.revisionAttestation == "cli-deployed-revisions-only" and
  .production.workflow == ".github/workflows/release.yml" and
  .production.requiredStatus == "release-production-approved" and
  .production.trigger == "protected-release-tag"
' "$RAILWAY_CONTRACT" >/dev/null || fail "Railway deployment contract is invalid"
grep -Fq "'v*.*.*'" "$WORKFLOW" || fail "release workflow is not restricted to stable version tags"
grep -Fq 'github.ref_protected' "$WORKFLOW" || fail "release workflow does not require protected tags"
grep -Fq 'group: marketplace-production-release' "$WORKFLOW" || fail "production releases are not serialized"
grep -Fq 'cancel-in-progress: false' "$WORKFLOW" || fail "a newer release can cancel an active production deployment"
grep -Fq 'timeout-minutes: 120' "$WORKFLOW" || fail "release timeout cannot cover deploy, attestation, and rollback bounds"
grep -Fq 'source scripts/release-network.sh' "$WORKFLOW" || fail "release workflow does not load bounded network helpers"
grep -Fq 'atm_release_require_registry_policy_ready' "$RELEASE_NETWORK" \
  || fail "release helpers do not verify Registry account policy readiness"
grep -Fq 'x-atm-account-terms-version:' "$RELEASE_NETWORK" \
  || fail "Registry readiness omits the account terms version"
grep -Fq 'x-atm-account-privacy-version:' "$RELEASE_NETWORK" \
  || fail "Registry readiness omits the account privacy version"
grep -Fq 'atm_release_require_registry_policy_ready \' "$WORKFLOW" \
  || fail "release does not require Registry account policy readiness"
grep -Fq 'https://gateway.getatm.io 2026-08-28 2026-08-28' "$WORKFLOW" \
  || fail "release is not bound to the required Registry policy versions"
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
grep -Fq 'environment: production' "$WORKFLOW" || fail "production token is not isolated in a GitHub environment"
grep -Fq 'RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}' "$WORKFLOW" || fail "production project token is not sourced from the environment secret"
grep -Fq 'Deploy protected tag to Railway production' "$WORKFLOW" || fail "release does not explicitly deploy the protected tag"
grep -Fq 'atm_release_railway_deploy "$PWD" "$GITHUB_SHA"' "$WORKFLOW" || fail "production upload is not bound to the protected tag commit"
grep -Fq 'atm_release_railway_deploy "$ROLLBACK_ROOT" "$PREVIOUS_SHA"' "$WORKFLOW" || fail "rollback does not explicitly restore the prior Railway source"
grep -Fq '$ORIGIN_URL/.well-known/atm-origin-revision' "$WORKFLOW" || fail "release does not attest the Railway source revision"
grep -Fq 'x-atm-origin-revision: $GITHUB_SHA' "$WORKFLOW" || fail "release does not bind the Railway revision header"
grep -Fq '.revision == $revision' "$WORKFLOW" || fail "release does not bind the Railway revision body"
grep -Fq 'deployed_ref="$(' "$WORKFLOW" || fail "release does not re-read the production ref after deployment"
[[ "$(grep -cF 'if ! deployed_ref="$(' "$WORKFLOW")" -ge 2 ]] \
  || fail "transient production ref reads can abort attestation instead of retrying"
grep -Fq 'for ref_attempt in 1 2 3' "$WORKFLOW" \
  || fail "rollback production ref reads are not retried"
grep -Fq 'Roll back failed production promotion' "$WORKFLOW" || fail "failed release does not restore the prior production ref"
grep -Fq 'git worktree add --detach "$ROLLBACK_ROOT" "$PREVIOUS_SHA"' "$WORKFLOW" || fail "failed release does not restore the prior Worker source"
grep -Fq '"$ORIGIN_URL$rollback_js_path"' "$WORKFLOW" || fail "rollback does not read prior deployed bytes from the Railway origin"
grep -Fq 'atm_release_deployed_asset_path "$ROLLBACK_ROOT" marketplace.js' "$WORKFLOW" || fail "rollback path selection does not support legacy production"
grep -Fq 'rollback-origin-marketplace.js' "$WORKFLOW" || fail "rollback origin bytes are not isolated from apex bytes"
grep -Fq 'WORKER_REVISION:$PREVIOUS_SHA' "$WORKFLOW" || fail "Worker rollback is not bound to the prior production revision"
grep -Fq 'Attest tagged Marketplace production bytes' "$WORKFLOW" || fail "release does not attest tagged production bytes"
grep -Fq 'Re-attest Marketplace production after Worker deployment' "$WORKFLOW" || fail "release does not verify public bytes after Worker deployment"
grep -Fq 'for attempt in $(seq 1 24)' "$WORKFLOW" || fail "production attestation wait is not bounded"
grep -Fq 'for attempt in $(seq 1 18)' "$WORKFLOW" || fail "rollback attestation wait is not bounded"
grep -Fq 'for attempt in $(seq 1 6)' "$WORKFLOW" || fail "post-Worker attestation wait is not bounded"
validation_line="$(grep -nF 'Validate stable protected tag' "$WORKFLOW" | cut -d: -f1)"
registry_line="$(grep -nF 'Require Registry account policy readiness' "$WORKFLOW" | cut -d: -f1)"
build_line="$(grep -nF 'Build source archive and bound manifest' "$WORKFLOW" | cut -d: -f1)"
promotion_line="$(grep -nF 'Promote protected tag to production branch' "$WORKFLOW" | cut -d: -f1)"
deployment_line="$(grep -nF 'Deploy protected tag to Railway production' "$WORKFLOW" | cut -d: -f1)"
attestation_line="$(grep -nF 'Attest tagged Marketplace production bytes' "$WORKFLOW" | cut -d: -f1)"
worker_line="$(grep -nF 'Deploy and attest Marketplace apex Worker revision' "$WORKFLOW" | cut -d: -f1)"
post_worker_line="$(grep -nF 'Re-attest Marketplace production after Worker deployment' "$WORKFLOW" | cut -d: -f1)"
release_line="$(grep -nF 'Create immutable release assets' "$WORKFLOW" | cut -d: -f1)"
[[ -n "$validation_line" && -n "$registry_line" && -n "$build_line" && -n "$promotion_line" && -n "$deployment_line" && -n "$attestation_line" \
  && -n "$worker_line" && -n "$post_worker_line" && -n "$release_line" \
  && "$validation_line" -lt "$registry_line" \
  && "$registry_line" -lt "$build_line" \
  && "$build_line" -lt "$promotion_line" \
  && "$promotion_line" -lt "$deployment_line" \
  && "$deployment_line" -lt "$attestation_line" \
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
grep -Fq '"https://getatm.io$marketplace_js_path"' "$WORKFLOW" || fail "release does not fetch deployed fingerprinted Marketplace assets"
grep -Fq 'cmp web/marketplace.js "$RUNNER_TEMP/marketplace.js"' "$WORKFLOW" || fail "release does not attest deployed Marketplace bytes"
grep -Fq '/legal/account-terms/2026-08-28' "$WORKFLOW" || fail "release does not fetch account terms"
grep -Fq '/legal/account-privacy/2026-08-28' "$WORKFLOW" || fail "release does not fetch account privacy"
grep -Fq 'cmp web/legal-account-terms-2026-08-28.html' "$WORKFLOW" || fail "release does not attest account terms bytes"
grep -Fq 'cmp web/legal-account-privacy-2026-08-28.html' "$WORKFLOW" || fail "release does not attest account privacy bytes"
grep -Fq 'cmp web/legal-2026-08-28.css' "$WORKFLOW" || fail "release does not attest account policy CSS bytes"
grep -Fq 'atm_release_require_attested' "$WORKFLOW" || fail "release attestation does not fail closed"
if grep -Fq '[ "$attempt" -eq 60 ]' "$WORKFLOW"; then
  fail "release attestation contains an unreachable exhaustion check"
fi
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
  if [[ "$action" == ./* ]]; then
    continue
  fi
  [[ "$action" =~ ^[^[:space:]@]+@[a-f0-9]{40}[[:space:]]+\#[[:space:]]+v[0-9]+(\.[0-9]+){0,2}$ ]] \
    || fail "GitHub Action is not pinned to an immutable revision with a version comment: $action"
done < <(grep -RhE '^[[:space:]]*uses:[[:space:]]+' "$ROOT/.github/workflows" | sed -E 's/^[[:space:]]*uses:[[:space:]]+//')

CI_WORKFLOW="$ROOT/.github/workflows/ci.yml"
grep -Fq 'contents: read' "$CI_WORKFLOW" || fail "CI token permissions are not read-only"
grep -Fq 'rhysd/actionlint@sha256:887a259a5a534f3c4f36cb02dca341673c6089431057242cdc931e9f133147e9' \
  "$CI_WORKFLOW" || fail "CI does not pin the GitHub Actions parser image"
grep -Fq -- '--network none' "$CI_WORKFLOW" \
  || fail "GitHub Actions parser has unnecessary network access"
grep -Fq '"$GITHUB_WORKSPACE:/repo:ro"' "$CI_WORKFLOW" \
  || fail "GitHub Actions parser receives a writable repository mount"
grep -Fq -- "-name '*.test.js'" "$CI_WORKFLOW" || fail "CI does not discover JavaScript Worker tests"
grep -Fq 'b5d1a8278cb967c6caacde863d764abae5eaae053870084b0ac1659a7fd71674' "$CI_WORKFLOW" || fail "CI does not pin the waitlist contract revision"
grep -Fq 'sha256sum --check web/assets.sha256' "$CI_WORKFLOW" || fail "CI does not verify the Marketplace web asset revision"
grep -Fq 'startCommand = "bun web/server.ts"' "$ROOT/railway.toml" || fail "Railway deployment does not run the source-tracked Marketplace server"

fixture="$TEMP_ROOT/repository"
output="$TEMP_ROOT/output"
mkdir -p "$fixture/scripts" "$output"
printf '%s\n' '{"name":"agent-trajectory-marketplace","version":"2026.08.18.2"}' >"$fixture/package.json"
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
  bash "$ROOT/scripts/build-release-assets.sh" v2026.08.18.2 "$commit" "$output"
grep -Fq 'export ATM_POSTHOG_API_KEY="phc_test_release_key"' "$output/install-core.sh" || fail "release installer core does not receive the configured telemetry key"
fake_bin="$TEMP_ROOT/fake-bin"
mkdir -p "$fake_bin"
cat >"$fake_bin/sed" <<'SH'
#!/usr/bin/env bash
cat
SH
chmod +x "$fake_bin/sed"
if PATH="$fake_bin:$PATH" \
    ATM_RELEASE_REPOSITORY="$fixture" \
    ATM_RELEASE_POSTHOG_API_KEY="phc_test_release_key" \
    bash "$ROOT/scripts/build-release-assets.sh" \
      v2026.08.18.2 "$commit" "$TEMP_ROOT/incomplete-output" \
      >/dev/null 2>&1; then
  fail "release builder accepts an unsubstituted telemetry key"
fi
bun -e '
  import {parseUpdateReleaseManifest} from "./src/trajectory/update-release-contract";
  import {verifyUpdateReleaseArchive} from "./src/trajectory/update-release-archive";
  const [manifestPath,archivePath]=process.argv.slice(1);
  const input=await Bun.file(manifestPath).json();
  const manifest=parseUpdateReleaseManifest(input,{currentVersion:"1.2.2",releaseTag:input.tag,archiveAsset:{name:input.archive.name,size:input.archive.size,digest:`sha256:${input.archive.sha256}`}});
  const archive=new Uint8Array(await Bun.file(archivePath).arrayBuffer());
  const verified=await verifyUpdateReleaseArchive(archive,manifest);
  if(verified.version!=="2026.08.18.2")process.exit(1);
' "$output/atm-release-manifest.json" "$output/atm-v2026.08.18.2.tar.gz" || fail "generated release does not pass the production archive verifier"
if [ -n "${ATM_TEST_ARTIFACT_DIR:-}" ]; then
  mkdir -p "$ATM_TEST_ARTIFACT_DIR"
  cp "$output/atm-release-manifest.json" "$ATM_TEST_ARTIFACT_DIR/generated-release-manifest.json"
  cp "$output/atm-v2026.08.18.2.tar.gz" "$ATM_TEST_ARTIFACT_DIR/generated-release.tar.gz"
  printf '%s\n' '{"status":"verified","version":"2026.08.18.2"}' >"$ATM_TEST_ARTIFACT_DIR/generated-release-verification.json"
fi
printf '%s\n' corrupt >>"$output/atm-v2026.08.18.2.tar.gz"
if bun -e '
  import {parseUpdateReleaseManifest} from "./src/trajectory/update-release-contract";
  import {verifyUpdateReleaseArchive} from "./src/trajectory/update-release-archive";
  const [manifestPath,archivePath]=process.argv.slice(1);
  const input=await Bun.file(manifestPath).json();
  const manifest=parseUpdateReleaseManifest(input,{currentVersion:"1.2.2",releaseTag:input.tag,archiveAsset:{name:input.archive.name,size:input.archive.size,digest:`sha256:${input.archive.sha256}`}});
  await verifyUpdateReleaseArchive(new Uint8Array(await Bun.file(archivePath).arrayBuffer()),manifest);
' "$output/atm-release-manifest.json" "$output/atm-v2026.08.18.2.tar.gz" >/dev/null 2>&1; then
  fail "production verifier accepted a corrupt generated archive"
fi

if grep -nE 'raw\.githubusercontent\.com/.*/main|github\.com/.*/main/' "$ROOT/scripts/install.sh" "$ROOT/scripts/install-agent.sh"; then
  fail "bootstrap still executes mutable main"
fi
grep -Fq '/releases/download/$ATM_BOOTSTRAP_TAG/install-core.sh' "$ROOT/scripts/install-agent.sh" || fail "agent wrapper does not bind its core asset to a release tag"
grep -Fq '/releases/download/$ATM_BOOTSTRAP_TAG/install-core.sh.sha256' "$ROOT/scripts/install-agent.sh" || fail "agent wrapper does not bind its checksum asset to the same release tag"

printf '%s\n' 'release workflow contract passed'
