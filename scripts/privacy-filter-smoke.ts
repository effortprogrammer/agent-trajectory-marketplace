// Manual smoke check for the privacy filter runtime under Bun.
//
// Exercises the production runner (createTransformersPrivacyFilter) end to
// end: model load, offset reconstruction, BIOES span folding, and masking via
// applyPrivacyPass — the same code path collect uses.
//
// Run: bun scripts/privacy-filter-smoke.ts
// First run downloads openai/privacy-filter into the HF cache (~1GB).

import type { HarnessTraceDocument } from "../src/trajectory/adapters/contract"
import { applyPrivacyPass } from "../src/trajectory/privacy/apply"
import { resolvePrivacyPassConfig } from "../src/trajectory/privacy/contract"
import { createTransformersPrivacyFilter } from "../src/trajectory/privacy/transformers-runner"

const config = resolvePrivacyPassConfig()

const samples = [
  "Contact Jane Doe at jane.doe@example.com or +1 (415) 555-0199 about invoice 4021.",
  "The retry logic in src/queue.ts polls https://api.example.com/v1/jobs every 30s; see the 2026-07-14 incident notes.",
  "Seller address: 221B Baker Street, London. Routing/account: 021000021 / 123456789012.",
]

const trace: HarnessTraceDocument = {
  runtime: "claude-code",
  status: "collected",
  formatVersion: 2,
  eventCount: samples.length,
  events: samples.map((sample, index) => ({
    kind: "tool_call",
    name: `sample_${index}`,
    detail: "smoke sample",
    payload: { output: sample },
  })),
}

console.log(`loading ${config.modelId}…`)
const loadStartedAt = performance.now()
const filter = createTransformersPrivacyFilter(config.modelId)
// Warm the model with a tiny input so load time reports separately.
await filter.detect(["warmup"])
console.log(`model ready in ${Math.round(performance.now() - loadStartedAt)}ms`)

const inferenceStartedAt = performance.now()
const result = await applyPrivacyPass(trace, filter, config)
console.log(
  `pass over ${samples.length} samples in ${Math.round(performance.now() - inferenceStartedAt)}ms`,
)
console.log(`masked spans: ${result.maskedSpanCount}`)
console.log(`stamp: ${JSON.stringify(result.trace.privacy, null, 2)}`)
for (const [index, event] of result.trace.events.entries()) {
  console.log(`\n--- sample ${index}`)
  console.log(`before: ${samples[index]}`)
  console.log(`after:  ${String((event.payload as { output?: string })?.output)}`)
}
