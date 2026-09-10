import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { encodeDatasetManifest } from "../../../src/marketplace/archive-contract";
import { buildDatasetArchive } from "../../../src/marketplace/dataset-archive";
import { MarketplaceError } from "../../../src/marketplace/error";
import {
  PublishBundleError,
  parsePublishBundle,
} from "../../../src/marketplace/publish-bundle";
import {
  fullSelectorSchema,
  traceHashSchema,
} from "../../../src/marketplace/session-contract";
import type { FrozenTrace } from "../../../src/marketplace/session-contract";
import { scanSessionSnapshot } from "../../../src/marketplace/session-snapshot";
import { writeDatasetZip } from "../../../src/marketplace/stored-zip";

const roots: string[] = [];
const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const label = `s-${"0".repeat(64)}`;
const path = `traces/${label}.atf.json`;

const fixtureRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "trajectory-prompt-preservation-"));
  roots.push(root);
  return root;
};

const traceBytes = (event: object | undefined, runtime = "codex"): Buffer => {
  const events = event === undefined ? [] : [event];
  return Buffer.from(JSON.stringify({
    runtime,
    status: "collected",
    formatVersion: 2,
    eventCount: events.length,
    events,
  }), "utf8");
};

type UserEventOverrides = Readonly<{
  readonly kind?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}>;

const supportedUserEvent = (overrides: UserEventOverrides = {}): object => ({
  kind: overrides.kind ?? "function_enter",
  name: "turn",
  timestamp: "2026-09-01T00:00:00.000Z",
  sourceEventId: "prompt-0",
  payload: {
    role: "user",
    content: "Preserve this prompt.",
    usage: {
      inputTokens: 1,
      model: "claude-fable-5",
      outputTokens: 1,
    },
    ...overrides.payload,
  },
});

const missingPromptTrace = (): Buffer => traceBytes({
  kind: "message",
  name: "assistant",
  timestamp: "2026-09-01T00:00:00.000Z",
  sourceEventId: "usage-0",
  payload: {
    usage: {
      inputTokens: 1,
      model: "claude-fable-5",
      outputTokens: 1,
    },
  },
});

const invalidCodexTraces = [
  ["missing", missingPromptTrace()],
  ["wrong-kind", traceBytes(supportedUserEvent({ kind: "message" }))],
  ["blank", traceBytes(supportedUserEvent({ payload: { role: "user", content: " \t" } }))],
  ["unsupported-content", traceBytes(supportedUserEvent({
    payload: { role: "user", content: [{ type: "text", text: "Preserve this prompt." }] },
  }))],
  ["truncated", traceBytes(supportedUserEvent({
    payload: { role: "user", content: "Preserve this prompt.", truncated: true },
  }))],
  ["oversized-content", traceBytes(supportedUserEvent({
    payload: { role: "user", content: "x".repeat(16 * 1024 + 1) },
  }))],
] as const;

const frozenTrace = (bytes: Buffer): FrozenTrace => Object.freeze({
  selector: fullSelectorSchema.parse(label),
  relativePath: "selected.atf.json",
  hash: traceHashSchema.parse(digest(bytes)),
  byteCount: bytes.byteLength,
  runtime: "codex",
  eventCount: 1,
  earliestTimestamp: "unknown",
  get bytes(): Uint8Array {
    return new Uint8Array(bytes);
  },
});

const archiveForTrace = (trace: Buffer): Buffer => writeDatasetZip([
  {
    data: encodeDatasetManifest({
      artifacts: [{ byteCount: trace.byteLength, label, path, sha256: digest(trace) }],
      formatVersion: 1,
    }),
    name: "dataset-manifest.json",
  },
  { data: trace, name: path },
]);

const expectMarketplaceCode = (action: () => unknown, code: MarketplaceError["code"]): void => {
  try {
    action();
    throw new Error(`expected ${code}`);
  } catch (error) {
    if (!(error instanceof MarketplaceError)) throw error;
    expect(error.code).toBe(code);
  }
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("Codex prompt preservation", () => {
  test.each(invalidCodexTraces)("rejects %s Codex user payloads during snapshot preview", (_case, bytes) => {
    // Given: a schema-valid Codex trace whose user payload cannot preserve its original prompt.
    const root = fixtureRoot();
    writeFileSync(join(root, "invalid.atf.json"), bytes);

    // When: the seller preview freezes the collected trace.
    const preview = (): void => {
      scanSessionSnapshot(root);
    };

    // Then: unusable Codex prompts fail with the existing trace error.
    expectMarketplaceCode(preview, "invalid_trace");
  });

  test.each(invalidCodexTraces)("rejects %s Codex user payloads during archive construction", (_case, bytes) => {
    // Given: a frozen Codex trace that would otherwise have supported compensated usage.
    const trace = frozenTrace(bytes);

    // When: the selected trace is assembled into an archive.
    const build = (): Buffer => buildDatasetArchive([trace]);

    // Then: the local archive boundary rejects the unpreserved prompt.
    expectMarketplaceCode(build, "invalid_bundle_request");
  });

  test.each(invalidCodexTraces)("rejects %s Codex user payloads before stored bundle publication", (_case, bytes) => {
    // Given: a manifest-consistent stored ZIP created before construction-side admission.
    const archive = archiveForTrace(bytes);

    // When: publication re-admits the ZIP before credentials or transport.
    const preflight = (): void => {
      parsePublishBundle(archive);
    };

    // Then: stored bundles cannot bypass prompt-integrity admission.
    expect(preflight).toThrow(new PublishBundleError("invalid_bundle_request"));
  });

  test("provides payload-free recollection guidance from the CLI", () => {
    // Given: a Codex user payload whose event kind cannot preserve the original prompt.
    const root = fixtureRoot();
    writeFileSync(join(root, "invalid.atf.json"), traceBytes(supportedUserEvent({ kind: "message" })));

    // When: the real seller preview entry point reads the trace.
    const result = Bun.spawnSync([
      process.execPath,
      "src/cli/index.ts",
      "marketplace", "seller", "candidate", "bundle",
      "--root", root,
      "--print-selection",
    ], { cwd: process.cwd(), stderr: "pipe", stdin: "ignore", stdout: "pipe" });
    const stderr = new TextDecoder().decode(result.stderr);

    // Then: failure remains machine-readable, provides local recovery guidance, and retains no payload.
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(stderr)).toEqual({ error: "invalid_trace", guidance: expect.any(String) });
    expect(stderr).not.toContain("Preserve this prompt.");
  });

  test("preserves non-Codex archive admission", () => {
    // Given: a non-Codex trace with supported usage and no user prompt event.
    const trace = traceBytes({
      kind: "message",
      name: "assistant",
      timestamp: "2026-09-01T00:00:00.000Z",
      sourceEventId: "usage-0",
      payload: {
        usage: { inputTokens: 1, model: "claude-fable-5", outputTokens: 1 },
      },
    }, "claude-code");

    // When: it crosses archive construction and stored ZIP preflight.
    const archive = buildDatasetArchive([frozenTrace(trace)]);
    const bundle = parsePublishBundle(archive);

    // Then: the Codex-only rule does not change another runtime's admission.
    expect(bundle.artifacts).toHaveLength(1);
  });
});
