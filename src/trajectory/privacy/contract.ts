import { createHash } from "node:crypto"

import { z } from "zod"

// ML-based PII masking for collected traces. The credential-redaction lane
// catches secret *shapes* (sk-..., JWTs); this lane catches PII the shapes
// cannot express — names, emails, phone numbers, addresses — using the
// openai/privacy-filter token classifier. Both lanes stay active:
// defense in depth, not replacement.

export const piiCategories = [
  "account_number",
  "address",
  "date",
  "email",
  "person_name",
  "phone_number",
  "secret",
  "url",
] as const

export type PiiCategory = (typeof piiCategories)[number]

const piiCategorySchema = z.enum(piiCategories)

// url/date stay unmasked by default: registry URLs and log timestamps are
// core training signal in coding trajectories, and masking them guts the
// dataset. secret overlaps the credential regex lane on purpose.
export const defaultMaskCategories: readonly PiiCategory[] = [
  "account_number",
  "address",
  "email",
  "person_name",
  "phone_number",
  "secret",
]

export const defaultPrivacyModelId = "openai/privacy-filter"
// 0.85, not 0.5: measured on real coding-trajectory sessions, the model's
// low-confidence (~0.7) firings are almost all out-of-distribution false
// positives — shell flags split into subwords ("git --oneline" → a
// person_name on "on"), tool-use ids read as account numbers, JSON "name"
// values primed as people. Raising the bar drops those while real PII
// (names, emails, credentials) fires at ~1.0 and survives; leaked secrets
// are additionally caught by the credential-regex lane regardless.
export const defaultPrivacyThreshold = 0.85

// The valid confidence range is privacy-pass policy; consumers that carry a
// threshold (e.g. the launchd service config) reuse this instead of
// re-declaring the bounds.
export const privacyThresholdSchema = z.number().min(0).max(1)

export const privacyPassConfigSchema = z
  .object({
    modelId: z.string().min(1).default(defaultPrivacyModelId),
    threshold: privacyThresholdSchema.default(defaultPrivacyThreshold),
    maskCategories: z
      .array(piiCategorySchema)
      .min(1)
      .default([...defaultMaskCategories]),
  })
  .strict()

export type PrivacyPassConfig = z.infer<typeof privacyPassConfigSchema>

export const resolvePrivacyPassConfig = (
  overrides: Partial<PrivacyPassConfig> = {},
): PrivacyPassConfig => privacyPassConfigSchema.parse(overrides)

// Stable digest of the effective filter config. Stored per session in the
// collect-watch state so a model/threshold/category change invalidates the
// unchanged-session skip and re-exports with the new policy.
export const privacyConfigHash = (config: PrivacyPassConfig): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        modelId: config.modelId,
        threshold: config.threshold,
        maskCategories: [...config.maskCategories].sort(),
      }),
    )
    .digest("hex")

// One detected PII span in one input text: [start, end) character offsets.
export type PrivacySpan = Readonly<{
  start: number
  end: number
  category: PiiCategory
  score: number
}>

// The model boundary. detect() takes a batch of strings and returns, for each
// input, its detected spans. Implementations: the Transformers.js runner
// (production) and fixed-span fakes (tests).
export type PrivacyFilter = Readonly<{
  detect: (texts: readonly string[]) => Promise<readonly (readonly PrivacySpan[])[]>
}>

// Embedded in the trace document as proof the pass ran, so inspect and the
// escrow intake can gate on it without re-running the model.
export const privacyStampSchema = z
  .object({
    schemaVersion: z.literal(1),
    modelId: z.string().min(1),
    threshold: z.number().min(0).max(1),
    maskedCategories: z.array(piiCategorySchema).min(1),
    spanCounts: z.record(z.number().int().nonnegative()),
    filteredAt: z.string().min(1),
  })
  .strict()

export type PrivacyStamp = z.infer<typeof privacyStampSchema>

// The inline replacement marker. The secret category masks as "credential"
// because the evidence detail-lane dictionary scan rejects any detail
// containing the literal word "secret" — the marker must not trip the gate
// it exists to satisfy.
export const privacyMarker = (category: PiiCategory): string =>
  `[pii:${category === "secret" ? "credential" : category}]`

// The single gate predicate shared by inspect (evidence.ts) and escrow
// intake: a trace may ship without a privacy stamp only when its status is
// in the explicit exemption set. Unknown or seller-invented statuses require
// the stamp — the gate fails closed rather than keying on one literal.
const privacyExemptStatuses: ReadonlySet<string> = new Set([
  // Python prototype demo traces never pass through the collector.
  "instrumented",
])

export const privacyStampSatisfied = (status: string, stamp: unknown): boolean =>
  privacyExemptStatuses.has(status) || privacyStampSchema.safeParse(stamp).success

// Model load/inference infrastructure failure (missing download, broken
// backend). Collect treats this as transient: the session is left unrecorded
// in watch state so the next sweep retries, instead of being permanently
// skipped like a conversion failure.
export class PrivacyFilterUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "PrivacyFilterUnavailableError"
  }
}
