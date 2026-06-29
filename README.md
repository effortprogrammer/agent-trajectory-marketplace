# Agent Trajectory Marketplace

A standalone Phase 0 prototype for collecting, replaying, and exporting agent-runtime trajectory evidence.

This repo intentionally lives outside the Buygent codebase. It provides a small Bun CLI that can:

- generate an ephemeral local trajectory collector workspace,
- run a trusted Python demo runner against Hermes/OpenClaw-style runtime patterns,
- export an ATF-shaped JSON trace and SQLite event buffer,
- inspect exported ATF JSON for marketplace readiness and redaction safety,
- bundle marketplace-ready traces into a local data-only evidence directory,
- reject unsafe export paths and invalid pattern module traversal,
- ignore tampered workspace runners during demo execution.

## Quickstart

```bash
bun install
bun run dev -- trajectory init hermes --workspace .tmp/trajectory-e2e
bun run dev -- trajectory demo hermes --workspace .tmp/trajectory-e2e --export .tmp/trajectory-e2e/artifacts/trace.atf.json
bun run dev -- trajectory inspect --trace .tmp/trajectory-e2e/artifacts/trace.atf.json --json
bun run dev -- trajectory bundle --trace .tmp/trajectory-e2e/artifacts/trace.atf.json --out .omo/evidence/trajectory-e2e
```

Or bootstrap the manual QA workspace:

```bash
bun run dev:trajectory
```

## Verification

```bash
bun run typecheck
bun run lint
bun test
```

Manual QA evidence is produced by driving the CLI itself, not by inspecting internals. The generated trace should include `function_enter`, `function_exit`, `llm_call`, `tool_call`, and `verification` events, with secret-like details redacted. `trajectory bundle` is gated by the same inspection contract and writes `manifest.json` plus a copied `trace.atf.json`.
