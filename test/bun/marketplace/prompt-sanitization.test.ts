import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  harnessPayloadPolicy, harnessTraceDocumentSchema, sanitizeHarnessPayload,
} from "../../../src/trajectory/adapters/contract";
import { buildDatasetArchive } from "../../../src/marketplace/dataset-archive";
import { MarketplaceError } from "../../../src/marketplace/error";
import { fullSelectorSchema, traceHashSchema, type FrozenTrace } from "../../../src/marketplace/session-contract";
import { scanSessionSnapshot } from "../../../src/marketplace/session-snapshot";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(extraUser: boolean): FrozenTrace {
  const payload = {
    role: "user" as const,
    content: "USER_SENTINEL",
    input: Array.from({ length: 4 }, () => "x".repeat(harnessPayloadPolicy.maxStringBytes)),
  };
  // The source is schema-valid, but aggregate payload sanitization loses its role and text.
  expect(sanitizeHarnessPayload(payload)).toEqual({ truncated: true });
  const document = harnessTraceDocumentSchema.parse({
    runtime: "codex", status: "collected", formatVersion: 2,
    eventCount: extraUser ? 3 : 2,
    events: [
      { kind: "function_enter", name: "large-user", payload },
      ...(extraUser ? [{
        kind: "function_enter", name: "other-user",
        payload: { role: "user", content: "OTHER_USER_SENTINEL" },
      }] : []),
      {
        kind: "llm_call", name: "assistant", timestamp: "2026-09-01T00:00:00.000Z",
        sourceEventId: "assistant-usage",
        payload: {
          role: "assistant", content: "ASSISTANT_SENTINEL",
          usage: { model: "claude-fable-5", inputTokens: 1, outputTokens: 1 },
        },
      },
    ],
  });
  const bytes = Buffer.from(JSON.stringify(document));
  return {
    selector: fullSelectorSchema.parse(`s-${"a".repeat(64)}`),
    relativePath: "input.atf.json",
    hash: traceHashSchema.parse(createHash("sha256").update(bytes).digest("hex")),
    byteCount: bytes.byteLength, runtime: "codex", eventCount: document.eventCount,
    earliestTimestamp: "unknown", bytes,
  };
}

for (const extraUser of [false, true]) {
  test(`snapshot rejects aggregate user-payload loss with another user=${extraUser}`, () => {
    // Given: a source whose user prompt disappears only during aggregate sanitization.
    const root = mkdtempSync(join(tmpdir(), "atm-prompt-sanitization-"));
    roots.push(root);
    writeFileSync(join(root, "input.atf.json"), fixture(extraUser).bytes);
    // When / Then: no apparently valid preview can include the lossy user payload.
    expect(() => scanSessionSnapshot(root)).toThrow(new MarketplaceError("invalid_trace"));
  });

  test(`archive rejects aggregate user-payload loss with another user=${extraUser}`, () => {
    // Given: valid positive usage on a different event cannot mask user payload loss.
    const trace = fixture(extraUser);
    // When / Then: the builder fails rather than successfully producing a lossy ZIP.
    expect(() => buildDatasetArchive([trace])).toThrow(new MarketplaceError("invalid_bundle_request"));
  });
}
