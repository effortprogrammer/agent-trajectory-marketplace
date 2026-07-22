# Agent Trajectory Marketplace

A standalone Phase 0 prototype for collecting, replaying, and exporting agent-runtime trajectory evidence.

This repo intentionally lives outside the Buygent codebase. It provides a Bun-powered npm CLI that can:

- generate an ephemeral local trajectory collector workspace,
- run a trusted Python demo runner against Hermes/OpenClaw-style runtime patterns,
- export an ATF-shaped JSON trace and SQLite event buffer,
- inspect exported ATF JSON for marketplace readiness and redaction safety,
- bundle marketplace-ready traces into a local data-only evidence directory,
- package self-generated agent logs into a seller-ready dataset listing artifact,
- run a local marketplace registry alpha for encrypted seller-archive escrow and anonymous supply browse,
- reject unsafe export paths and invalid pattern module traversal,
- ignore tampered workspace runners during demo execution.

## Documentation

Polished guides live in the VitePress site under [`website/`](website) — seller onboarding
(collect → package locally → framed escrow publish), the resident collector, buyer flows, and CLI/adapter/API
reference:

```bash
bun run docs:dev      # local docs at http://localhost:5173
bun run docs:build    # static build to website/.vitepress/dist
```

Operational runbooks (registry, telemetry, launch boundary) remain under [`docs/`](docs).

## Quickstart

Use a source checkout unless an operator gives you a verified packaged build:

```bash
git clone https://github.com/effortprogrammer/agent-trajectory-marketplace.git
cd agent-trajectory-marketplace
bun install
bun run dev -- health
```

Collect a real coding-harness session and produce a local seller artifact (see
[docs/harness-adapters.md](docs/harness-adapters.md) for the adapter contract and event mapping):

```bash
bun run dev -- trajectory collect runtimes
bun run dev -- trajectory collect sessions claude-code
bun run dev -- trajectory collect export claude-code --session <sessionId> --export .tmp/trajectory-e2e/artifacts/trace.atf.json
bun run dev -- trajectory inspect --trace .tmp/trajectory-e2e/artifacts/trace.atf.json --json
bun run dev -- trajectory seller package --trace .tmp/trajectory-e2e/artifacts/trace.atf.json --out .omo/seller-packages/claude-code-session --seller agent-local --title "Claude Code session self-log" --metadata .tmp/marketplace-metadata.json
bun run dev -- trajectory seller inspect --path .omo/seller-packages/claude-code-session --json
```

### Local Seller Session Browser

Sync a fixture-scoped or local seller source into the session index, start the loopback browser, and open the printed URL:

```bash
bun run dev -- trajectory collect index sync --db .tmp/seller-browser/session-index.db --runtime claude-code --source <source-dir>
bun run dev -- trajectory collect serve --db .tmp/seller-browser/session-index.db --port 0 --no-sync
```

The browser presents indexed sessions with token metrics, an archetype, and trace-derived signals. Search uses indexed session messages; all data remains local to the machine running the command.

Or exercise the synthetic prototype workspace instead of a real harness log:

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

The registry alpha is a local, data-only marketplace path. It lets an approved seller publish a canonical seller ATF archive through framed encrypted escrow; the registry validates and holds ciphertext after publication. Anonymous supply browse exposes a bounded redacted legacy proof preview plus optional aggregate-only evidence, never raw archive bytes or a download.

Start a local registry with a dev seller key:

```bash
bun run dev -- trajectory registry serve --host 127.0.0.1 --port 0 --db .tmp/registry/registry.sqlite --storage .tmp/registry/storage --tmp .tmp/registry/tmp --seller-key agent-local:test-key
```

The six-file package publish/list/inspect/download endpoints are test-only legacy and retired: `trajectory seller publish` and `trajectory marketplace list/inspect/download` now fail with the typed `410 gone` error. Marketplace supply is seller-originated canonical ATF held in encrypted registry escrow after publication: sellers publish Candidate Datasets and commit the delivery terms (reserve price, delivery SLA, proof profile, and failure consequences). Anonymous browse exposes the bounded redacted legacy proof preview plus optional aggregate-only evidence, never raw archive bytes or a download; an operator selects an approved buyer access record, validates fulfillment, and releases the entitlement before download. Local packaging (`trajectory seller package` / `seller inspect`) remains supported for producing hash-verifiable delivery artifacts.

Prefer `TRAJECTORY_REGISTRY_API_KEY` over `--api-key` so seller secrets do not land in shell history. The closed-alpha machine-readable API contract is [docs/marketplace-registry-openapi.yaml](docs/marketplace-registry-openapi.yaml); it covers `Authorization: Bearer <api-key>`, the `/v1/supply/*` encrypted-escrow supply surface, `/v1/auth/signup`, `/v1/auth/device`, `/v1/auth/token`, `/v1/waitlist-requests`, listing access requests and reviews, fail-closed access state, stable `error.code` values, and the `/v1` version policy.

Hosted Closed Alpha privileged access is operator-gated. Operators move seller and buyer records through
`requested`, `invited`, `approved`, `rejected`, and `revoked`; hosted seller or buyer API keys are
issued only for approved access records and are stored as hashes, with rotation and revocation
audited. Web sign-in creates an identity only. It does not approve buyer/seller access,
grant listing entitlements, start checkout, or issue payment artifacts. CLI device-code login starts
from `trajectory auth login`, opens the marketplace approval URL, and stores a CLI account token
only after a signed-in web account approves the code. `trajectory auth signup` prints the web signup
URL; CLI account creation is intentionally disabled.

Web sign-in is passwordless: `/v1/auth/signup` emails a one-time code and `/v1/auth/login`
verifies it. Anonymous callers can browse current supply metadata, the bounded legacy proof
preview and optional aggregate-only evidence; signed-in accounts can submit authenticated interest,
fulfillment, and legacy listing access requests. Request-required,
purchase-required, and entitlement-required listings do not download with account login or a legacy
buyer key alone; an operator must approve the buyer record and grant the listing entitlement. This alpha intentionally excludes live Stripe checkout,
payouts, paid refunds, tax handling, HF Datasets/Parquet conversion, seller/operator dashboards, and
self-serve entitlement approval. It includes a buyer-facing marketplace UI on the
registry origin. See [docs/marketplace-launch-boundary.md](docs/marketplace-launch-boundary.md) for
the Closed Alpha launch boundary, explicit deferrals, and Go/No-Go criteria,
[docs/marketplace-hosted-architecture.md](docs/marketplace-hosted-architecture.md) for the hosted
runtime and ENV/SECRET contract, and [docs/marketplace-registry.md](docs/marketplace-registry.md)
for the registry trust model and production migration checklist.

## Verification

```bash
bun run typecheck
bun run lint
bun test
bun run release:check
```

Manual QA evidence is produced by driving the CLI itself, not by inspecting internals. The generated trace should include `function_enter`, `function_exit`, `llm_call`, `tool_call`, and `verification` events, with secret-like details redacted. `trajectory bundle` is gated by the same inspection contract and writes `manifest.json` plus a copied `trace.atf.json`. `trajectory seller package` turns the same verified self-log into a local hash-verifiable delivery artifact with `seller.json`, `dataset.json`, `preview.json`, `redaction-report.json`, a copied trace, and a hash manifest; marketplace publication uses the framed escrow command.

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
