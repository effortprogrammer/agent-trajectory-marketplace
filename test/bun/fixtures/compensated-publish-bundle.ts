import { createHash } from "node:crypto"

import {
  buildDatasetArchive,
} from "../../../src/marketplace/dataset-archive"
import {
  parsePublishBundle,
  type PublishBundle,
} from "../../../src/marketplace/publish-bundle"
import {
  fullSelectorSchema,
  traceHashSchema,
  type FrozenTrace,
} from "../../../src/marketplace/session-contract"

const relativePath = "supported.atf.json"

const supportedTrace = (): FrozenTrace => {
  const bytes = Buffer.from(JSON.stringify({
    runtime: "codex",
    status: "collected",
    formatVersion: 2,
    eventCount: 1,
    events: [{
      kind: "message",
      name: "assistant",
      timestamp: "2026-09-01T00:00:00.000Z",
      sourceEventId: "usage-0",
      payload: {
        usage: {
          model: "claude-fable-5",
          inputTokens: 10,
          outputTokens: 5,
        },
      },
    }],
  }), "utf8")
  const retained = new Uint8Array(bytes)
  return Object.freeze({
    selector: fullSelectorSchema.parse(
      `s-${createHash("sha256").update(relativePath).digest("hex")}`,
    ),
    relativePath,
    hash: traceHashSchema.parse(
      createHash("sha256").update(retained).digest("hex"),
    ),
    byteCount: retained.byteLength,
    runtime: "codex",
    eventCount: 1,
    earliestTimestamp: "2026-09-01T00:00:00.000Z",
    get bytes(): Uint8Array {
      return new Uint8Array(retained)
    },
  })
}

export const compensatedPublishArchive = (): Buffer =>
  buildDatasetArchive([supportedTrace()])

export const compensatedPublishBundle = (): PublishBundle =>
  parsePublishBundle(compensatedPublishArchive())
