#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/deploy-staging.yml"
RAILWAY_CONTRACT="$ROOT/infra/railway/deployment-contract.json"
RELEASE_NETWORK="$ROOT/scripts/release-network.sh"
SERVER="$ROOT/web/server.ts"
RAILWAY_CLI_IMAGE='ghcr.io/railwayapp/cli@sha256:9b52f6d5c0d9d4878c1d7b9a3d1f6299030b19cb3a4ae4cc1e42995311b6327b'

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

[[ -f "$WORKFLOW" ]] || fail "staging deployment workflow is missing"
[[ -f "$RAILWAY_CONTRACT" ]] || fail "Railway deployment contract is missing"
grep -Fq 'workflow_call:' "$WORKFLOW" \
  || fail "staging deployment cannot be reused by the protected release"
grep -Fq 'DEPLOY_REVISION: ${{ inputs.revision || github.sha }}' "$WORKFLOW" \
  || fail "staging deployment does not bind the requested exact revision"
grep -Fq 'contract/seller-beta/v1/registry-revision.txt' "$WORKFLOW" \
  || fail "staging does not bind the deployed Registry beta revision"
grep -Fq 'bun scripts/ops/marketplace-probe.ts' "$WORKFLOW" \
  || fail "staging does not run the cross-repository beta probe"
grep -Fq 'REQUIRE_WORKER_REVISION: "false"' "$WORKFLOW" \
  || fail "direct staging incorrectly requires the production Worker revision"

grep -Fq 'branches: [dev]' "$WORKFLOW" \
  || fail "staging deployment is not restricted to dev pushes"
if grep -Fq 'pull_request:' "$WORKFLOW"; then
  fail "untrusted pull requests can invoke the staging deployment workflow"
fi
grep -Fq 'contents: read' "$WORKFLOW" \
  || fail "staging deployment permissions are not read-only"
grep -Fq 'group: marketplace-staging-deploy' "$WORKFLOW" \
  || fail "staging deployments are not serialized"
grep -Fq 'cancel-in-progress: false' "$WORKFLOW" \
  || fail "an in-flight staging deployment can be cancelled"
grep -Fq 'timeout-minutes: 60' "$WORKFLOW" \
  || fail "staging timeout cannot cover bounded CLI calls and attestation"
grep -Fq 'environment: staging' "$WORKFLOW" \
  || fail "staging token is not isolated in a GitHub environment"
grep -Fq 'RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}' "$WORKFLOW" \
  || fail "staging project token is not sourced from the environment secret"
grep -Fq "$RAILWAY_CLI_IMAGE" "$RELEASE_NETWORK" \
  || fail "Railway CLI image is not pinned by digest"
grep -Fq 'atm_release_railway_deploy "$PWD" "$DEPLOY_REVISION"' "$WORKFLOW" \
  || fail "staging origin revision is not bound to the requested commit"
grep -Fq 'atm_release_require_registry_policy_ready \' "$WORKFLOW" \
  || fail "staging does not require Registry account policy readiness"
grep -Fq 'https://gateway.getatm.io 2026-08-28 2026-08-28' "$WORKFLOW" \
  || fail "staging is not bound to the required Registry policy versions"
registry_line="$(grep -nF 'Require Registry account policy readiness' "$WORKFLOW" | cut -d: -f1)"
deployment_line="$(grep -nF 'Deploy exact dev commit to Railway staging' "$WORKFLOW" | cut -d: -f1)"
[[ -n "$registry_line" && -n "$deployment_line" && "$registry_line" -lt "$deployment_line" ]] \
  || fail "staging deploys before Registry policy readiness is proven"
grep -Fq 'atm_release_railway_deploy' "$WORKFLOW" \
  || fail "staging workflow does not use the bounded Railway deploy helper"
grep -Fq '"ATM_ORIGIN_REVISION=$revision"' "$RELEASE_NETWORK" \
  || fail "Railway deploy helper does not persist the attested revision"
if grep -Fq 'RAILWAY_GIT_COMMIT_SHA' "$SERVER"; then
  fail "Railway-native source deployments can satisfy revision attestation"
fi
grep -Fq 'git -C "$source_root" archive "$revision"' "$RELEASE_NETWORK" \
  || fail "Railway upload is not built from the exact requested commit"
grep -Fq 'railway variable set' "$RELEASE_NETWORK" \
  || fail "staging revision variable is not configured"
grep -Fq -- '--skip-deploys' "$RELEASE_NETWORK" \
  || fail "revision variable mutation can trigger a duplicate deployment"
grep -Fq 'railway up /workspace' "$RELEASE_NETWORK" \
  || fail "staging source is not uploaded through Railway CLI"
grep -Fq -- '--project "$project"' "$RELEASE_NETWORK" \
  || fail "staging upload is not bound to the Railway project"
grep -Fq -- '--environment "$environment"' "$RELEASE_NETWORK" \
  || fail "staging upload is not bound to the Railway environment"
grep -Fq -- '--service "$service"' "$RELEASE_NETWORK" \
  || fail "staging upload is not bound to the Railway service"
grep -Fq -- '--ci' "$RELEASE_NETWORK" \
  || fail "staging workflow does not wait for deployment completion"
if grep -Fq -- '--detach' "$RELEASE_NETWORK" || grep -Fq -- '--no-wait' "$RELEASE_NETWORK"; then
  fail "staging deployment can report success before Railway is ready"
fi
grep -Fq '$ORIGIN_URL/.well-known/atm-origin-revision' "$WORKFLOW" \
  || fail "staging origin revision is not attested"
grep -Fq 'for attempt in $(seq 1 24)' "$WORKFLOW" \
  || fail "staging attestation retry budget is missing or unbounded"
grep -Fq 'sleep 5' "$WORKFLOW" \
  || fail "staging attestation retry interval cannot cover Railway edge propagation"
grep -Fq 'atm_release_require_attested' "$WORKFLOW" \
  || fail "staging attestation exhaustion does not fail closed"
grep -Fq 'x-atm-origin-revision: $DEPLOY_REVISION' "$WORKFLOW" \
  || fail "staging revision header is not bound to the pushed commit"
grep -Fq '.revision == $revision' "$WORKFLOW" \
  || fail "staging revision body is not bound to the pushed commit"
grep -Fq 'cmp web/index.html' "$WORKFLOW" \
  || fail "staging HTML bytes are not attested"
grep -Fq 'cmp web/marketplace.css' "$WORKFLOW" \
  || fail "staging CSS bytes are not attested"
grep -Fq 'cmp web/marketplace.js' "$WORKFLOW" \
  || fail "staging JavaScript bytes are not attested"
grep -Fq '/agent-onboarding-prompt.txt' "$WORKFLOW" \
  || fail "staging agent onboarding prompt URL is not attested"
grep -Fq 'cmp web/agent-onboarding-prompt.txt' "$WORKFLOW" \
  || fail "staging agent onboarding prompt bytes are not attested"
grep -Fq '/legal/account-terms/2026-08-28' "$WORKFLOW" \
  || fail "staging account terms URL is not attested"
grep -Fq '/legal/account-privacy/2026-08-28' "$WORKFLOW" \
  || fail "staging account privacy URL is not attested"
grep -Fq 'cmp web/legal-account-terms-2026-08-28.html' "$WORKFLOW" \
  || fail "staging account terms bytes are not attested"
grep -Fq 'cmp web/legal-account-privacy-2026-08-28.html' "$WORKFLOW" \
  || fail "staging account privacy bytes are not attested"
grep -Fq 'cmp web/legal-2026-08-28.css' "$WORKFLOW" \
  || fail "staging account policy CSS bytes are not attested"

jq -e '
  .staging.deploymentMode == "github-actions-cli" and
  .staging.sourceIntegration == false and
  .staging.revisionVariable == "ATM_ORIGIN_REVISION" and
  .staging.workflow == ".github/workflows/deploy-staging.yml" and
  .staging.trigger == "dev-push"
' "$RAILWAY_CONTRACT" >/dev/null \
  || fail "staging Railway contract does not declare the CLI deployment boundary"

printf 'staging deployment workflow contract passed\n'
