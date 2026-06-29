# Agent Trajectory Marketplace

A standalone Phase 0 prototype for collecting, replaying, and exporting agent-runtime trajectory evidence.

This repo intentionally lives outside the Buygent codebase. It provides a small Bun CLI that can:

- generate an ephemeral local trajectory collector workspace,
- run a trusted Python demo runner against Hermes/OpenClaw-style runtime patterns,
- export an ATF-shaped JSON trace and SQLite event buffer,
- reject unsafe export paths and invalid pattern module traversal,
- ignore tampered workspace runners during demo execution.

## Quickstart

```bash
bun install
bun run dev -- trajectory init hermes --workspace .tmp/trajectory-e2e
bun run dev -- trajectory demo hermes --workspace .tmp/trajectory-e2e --export .tmp/trajectory-e2e/artifacts/trace.atf.json
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

Manual QA evidence is produced by driving the CLI itself, not by inspecting internals. The generated trace should include `function_enter`, `function_exit`, `llm_call`, `tool_call`, and `verification` events, with secret-like details redacted.

