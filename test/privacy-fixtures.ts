import type { PrivacyFilter, PrivacyStamp } from "../src/trajectory/privacy/contract"
import {
  defaultMaskCategories,
  defaultPrivacyModelId,
  defaultPrivacyThreshold,
} from "../src/trajectory/privacy/contract"
import type { CollectPrivacyOptions } from "../src/trajectory/privacy/pipeline"

// Detects nothing: exercises the privacy pass wiring (stamping, hashing,
// async plumbing) without the model download.
export const noopPrivacyFilter: PrivacyFilter = {
  detect: (texts) => Promise.resolve(texts.map(() => [])),
}

export const testPrivacyOptions: CollectPrivacyOptions = { filter: noopPrivacyFilter }

// A valid stamp for fixture traces that never went through the real pass.
export const testPrivacyStamp = (): PrivacyStamp => ({
  schemaVersion: 1,
  modelId: defaultPrivacyModelId,
  threshold: defaultPrivacyThreshold,
  maskedCategories: [...defaultMaskCategories].sort(),
  spanCounts: {},
  filteredAt: "2026-07-14T00:00:00.000Z",
})

// Stamps an in-memory trace document (fixture JSON) as privacy-filtered.
export const stampPrivacyForTest = <T extends Record<string, unknown>>(
  trace: T,
): T & { privacy: PrivacyStamp } => ({ ...trace, privacy: testPrivacyStamp() })
