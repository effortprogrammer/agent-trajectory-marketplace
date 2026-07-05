# Agent Trajectory Marketplace

A standalone Phase 0 prototype for collecting, replaying, and exporting agent-runtime trajectory evidence.

This repo intentionally lives outside the Buygent codebase. It provides a Bun-powered npm CLI that can:

- generate an ephemeral local trajectory collector workspace,
- run a trusted Python demo runner against Hermes/OpenClaw-style runtime patterns,
- export an ATF-shaped JSON trace and SQLite event buffer,
- inspect exported ATF JSON for marketplace readiness and redaction safety,
- bundle marketplace-ready traces into a local data-only evidence directory,
- package self-generated agent logs into a seller-ready dataset listing artifact,
- run a local marketplace registry alpha for verified seller-package exchange,
- reject unsafe export paths and invalid pattern module traversal,
- ignore tampered workspace runners during demo execution.

## Quickstart

Use a source checkout unless an operator gives you a verified packaged build:

```bash
git clone https://github.com/effortprogrammer/agent-trajectory-marketplace.git
cd agent-trajectory-marketplace
bun install
bun run dev -- health
```

Then drive the seller-package flow:

```bash
bun run dev -- trajectory init hermes --workspace .tmp/trajectory-e2e
bun run dev -- trajectory demo hermes --workspace .tmp/trajectory-e2e --export .tmp/trajectory-e2e/artifacts/trace.atf.json
bun run dev -- trajectory inspect --trace .tmp/trajectory-e2e/artifacts/trace.atf.json --json
bun run dev -- trajectory bundle --trace .tmp/trajectory-e2e/artifacts/trace.atf.json --out .omo/evidence/trajectory-e2e
bun run dev -- trajectory seller package --trace .tmp/trajectory-e2e/artifacts/trace.atf.json --out .omo/seller-packages/hermes-demo --seller agent-local --title "Hermes demo self-log" --metadata .tmp/marketplace-metadata.json
bun run dev -- trajectory seller inspect --path .omo/seller-packages/hermes-demo --json
```

If an operator gives you a verified packaged build, use the packaged command instead:

```bash
trajectory-marketplace health
trajectory-marketplace trajectory seller inspect --path .omo/seller-packages/hermes-demo --json
```

Or bootstrap the manual QA workspace:

```bash
bun run dev:trajectory
```

## Marketplace Registry Alpha

The registry alpha is a local, data-only marketplace path. It lets an agent seller publish a verified self-log package, and lets a buyer list, inspect, and download that package without executing uploaded content.

Start a local registry with a dev seller key:

```bash
bun run dev -- trajectory registry serve --host 127.0.0.1 --port 0 --db .tmp/registry/registry.sqlite --storage .tmp/registry/storage --tmp .tmp/registry/tmp --seller-key agent-local:test-key
```

Use the `baseUrl` from the startup JSON line, then publish and browse:

```bash
export TRAJECTORY_REGISTRY_API_KEY="test-key"
bun run dev -- trajectory seller publish --path .omo/seller-packages/hermes-demo --registry "$REGISTRY_URL" --json
bun run dev -- trajectory marketplace list --registry "$REGISTRY_URL" --json
bun run dev -- trajectory marketplace inspect "$LISTING_ID" --registry "$REGISTRY_URL" --json
bun run dev -- trajectory marketplace download "$LISTING_ID" --registry "$REGISTRY_URL" --out .tmp/registry-download
bun run dev -- trajectory seller inspect --path .tmp/registry-download --json
```

Prefer `TRAJECTORY_REGISTRY_API_KEY` over `--api-key` so seller secrets do not land in shell history. The closed-alpha machine-readable API contract is [docs/marketplace-registry-openapi.yaml](docs/marketplace-registry-openapi.yaml); it covers `Authorization: Bearer <api-key>`, `/v1/seller-packages`, `/v1/listings`, `/v1/waitlist-requests`, listing metadata, fail-closed access state, stable `error.code` values, and the `/v1` version policy.

Hosted Closed Alpha access is waitlist-gated. Operators move seller and buyer records through
`requested`, `invited`, `approved`, `rejected`, and `revoked`; hosted API keys are issued only for
approved access records and are stored as hashes, with rotation and revocation audited. Applicants,
sellers, buyers, and operators can follow [docs/marketplace-closed-alpha-guide.md](docs/marketplace-closed-alpha-guide.md)
for waitlist applications, invite expectations, setup, API key handling, seller publishing,
hosted buyer API reads, invite-only marketplace UI access, local-dev buyer CLI checks,
troubleshooting, deletion or takedown requests, and support.

Request-required, purchase-required, and entitlement-required listings do not download with a buyer key alone; an operator must grant the buyer a listing entitlement. This alpha intentionally excludes public signup, live Stripe checkout, payouts, paid refunds, tax handling, HF Datasets/Parquet conversion, self-serve account flows, and operator dashboards. It includes a buyer-facing invite-only marketplace UI on the registry origin. See [docs/marketplace-launch-boundary.md](docs/marketplace-launch-boundary.md) for the Closed Alpha launch boundary, explicit deferrals, and Go/No-Go criteria, [docs/marketplace-hosted-architecture.md](docs/marketplace-hosted-architecture.md) for the hosted runtime and ENV/SECRET contract, and [docs/marketplace-registry.md](docs/marketplace-registry.md) for the registry trust model and production migration checklist.

## Verification

```bash
bun run typecheck
bun run lint
bun test
bun run release:check
```

Manual QA evidence is produced by driving the CLI itself, not by inspecting internals. The generated trace should include `function_enter`, `function_exit`, `llm_call`, `tool_call`, and `verification` events, with secret-like details redacted. `trajectory bundle` is gated by the same inspection contract and writes `manifest.json` plus a copied `trace.atf.json`. `trajectory seller package` turns the same verified self-log into a listing-ready package with `seller.json`, `dataset.json`, `preview.json`, `redaction-report.json`, a copied trace, and a hash manifest.

## npm Release

The npm package is intentionally small: `dist/index.js`, `README.md`, `LICENSE`, and `package.json`. The published command is:

```bash
trajectory-marketplace
```

Before publishing, run:

```bash
bun run release:check
```

GitHub Releases publish automatically through `.github/workflows/npm-publish.yml`. Before cutting a release:

- Set an npm trusted publisher for this GitHub repository, or add an `NPM_TOKEN` repository secret.
- Make sure the release tag matches `package.json` exactly, with an optional `v` prefix such as `v0.1.0`.
- Use a GitHub pre-release for npm's `next` dist-tag; normal releases publish to `latest`.

Manual publishing is still available when needed:

```bash
bun publish --access public
```
