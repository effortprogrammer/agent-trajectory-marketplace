# Agent Trajectory CLI

## Purpose

This repository contains a Bun-only collector and encrypted candidate-publish CLI. It has no web UI or collector HTTP bridge.

## Commands

- `bun run build:collector` — bundle the Bun CLI
- `bun run trajectory -- collect runtimes` — list supported runtimes
- `bun test test/bun` — run the Bun test suite
- `bash test/installers.test.sh` — verify installer preflights
- `bun run typecheck` — type-check without emitting files

## Collector rules

- Preserve native Bun adapters, credential redaction, watch state, launchd integration, and explicit output confinement.
- `--source` overrides are explicit; do not silently broaden filesystem access.
- No `--runtime` on watch means all supported native runtimes.

## Publish rules

- Candidate publication is `trajectory marketplace seller candidate publish` only.
- Keep the framed wire contract: 4-byte big-endian candidate JSON length, JSON UTF-8, then the dataset zip.
- The archive contains `dataset-manifest.json` and `traces/*.atf.json` entries.
- `--api-key` takes precedence over `TRAJECTORY_REGISTRY_API_KEY`.
- Validate all local inputs and credentials before making a request.

## Development rules

- Keep TypeScript strict and avoid `any`.
- Use Bun for installation, build, tests, and runtime.
- Cover machine-observable behavior; do not test documentation prose.
- Do not commit generated build output, credentials, local session data, or `.env` files.
