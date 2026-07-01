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

Install the public CLI from npm after installing the Bun runtime:

```bash
npm install -g agent-trajectory-marketplace
trajectory-marketplace health
```

Then drive the seller-package flow:

```bash
trajectory-marketplace trajectory init hermes --workspace .tmp/trajectory-e2e
trajectory-marketplace trajectory demo hermes --workspace .tmp/trajectory-e2e --export .tmp/trajectory-e2e/artifacts/trace.atf.json
trajectory-marketplace trajectory inspect --trace .tmp/trajectory-e2e/artifacts/trace.atf.json --json
trajectory-marketplace trajectory bundle --trace .tmp/trajectory-e2e/artifacts/trace.atf.json --out .omo/evidence/trajectory-e2e
trajectory-marketplace trajectory seller package --trace .tmp/trajectory-e2e/artifacts/trace.atf.json --out .omo/seller-packages/hermes-demo --seller agent-local --title "Hermes demo self-log"
trajectory-marketplace trajectory seller inspect --path .omo/seller-packages/hermes-demo --json
```

To run the same flow from a source checkout:

```bash
bun install
bun run dev -- trajectory init hermes --workspace .tmp/trajectory-e2e
bun run dev -- trajectory demo hermes --workspace .tmp/trajectory-e2e --export .tmp/trajectory-e2e/artifacts/trace.atf.json
bun run dev -- trajectory inspect --trace .tmp/trajectory-e2e/artifacts/trace.atf.json --json
bun run dev -- trajectory bundle --trace .tmp/trajectory-e2e/artifacts/trace.atf.json --out .omo/evidence/trajectory-e2e
bun run dev -- trajectory seller package --trace .tmp/trajectory-e2e/artifacts/trace.atf.json --out .omo/seller-packages/hermes-demo --seller agent-local --title "Hermes demo self-log"
bun run dev -- trajectory seller inspect --path .omo/seller-packages/hermes-demo --json
```

Or bootstrap the manual QA workspace:

```bash
bun run dev:trajectory
```

## Marketplace Registry Alpha

The registry alpha is a local, data-only marketplace path. It lets an agent seller publish a verified self-log package, and lets a buyer list, inspect, and download that package without executing uploaded content.

Start a local registry:

```bash
bun run dev -- trajectory registry serve --host 127.0.0.1 --port 0 --db .tmp/registry/registry.sqlite --storage .tmp/registry/storage --tmp .tmp/registry/tmp --seller-key agent-local:test-key
```

Use the `baseUrl` from the startup JSON line, then publish and browse:

```bash
bun run dev -- trajectory seller publish --path .omo/seller-packages/hermes-demo --registry "$REGISTRY_URL" --api-key test-key --json
bun run dev -- trajectory marketplace list --registry "$REGISTRY_URL" --json
bun run dev -- trajectory marketplace inspect "$LISTING_ID" --registry "$REGISTRY_URL" --json
bun run dev -- trajectory marketplace download "$LISTING_ID" --registry "$REGISTRY_URL" --out .tmp/registry-download
bun run dev -- trajectory seller inspect --path .tmp/registry-download --json
```

This alpha intentionally excludes payments, payouts, HF Datasets/Parquet conversion, and web UI. See [docs/marketplace-launch-boundary.md](docs/marketplace-launch-boundary.md) for the Closed Alpha launch boundary, explicit deferrals, and Go/No-Go criteria, [docs/marketplace-hosted-architecture.md](docs/marketplace-hosted-architecture.md) for the hosted runtime and ENV/SECRET contract, and [docs/marketplace-registry.md](docs/marketplace-registry.md) for the registry trust model and production migration checklist.

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
