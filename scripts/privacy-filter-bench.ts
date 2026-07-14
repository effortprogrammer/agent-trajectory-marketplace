// Local benchmark for the privacy filter runner. Converts one real harness
// session, extracts every string the privacy pass would scan, and times
// detect() over them. Run before/after a runner change to measure it, and
// pass a second runner config to A/B both speed and span-output equality.
//
//   bun scripts/privacy-filter-bench.ts [--session <idOrPath>] [--limit <n>]
//
// Requires the model in the local HF cache (~1GB on first use).

import { getHarnessAdapter } from "../src/trajectory/adapters/registry"
import type { PrivacySpan } from "../src/trajectory/privacy/contract"
import { createEnginePrivacyFilter } from "../src/trajectory/privacy/engine-client"
import { createTransformersPrivacyFilter } from "../src/trajectory/privacy/transformers-runner"
import { mapStringLeaves } from "../src/trajectory/string-leaves"

const args = process.argv.slice(2)
const argValue = (name: string): string | undefined => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

const runtime = "claude-code"
const adapter = getHarnessAdapter(runtime)
const sourceDir = adapter.defaultSourceDir()
if (sourceDir === undefined) {
  throw new Error("no default source dir for claude-code")
}
const sessionArg = argValue("--session")
const session = sessionArg ?? adapter.listSessions(sourceDir).at(1)?.sessionId ?? "missing-session"
const ref = adapter
  .listSessions(sourceDir)
  .find((candidate) => candidate.sessionId === session || candidate.sessionPath === session)
if (ref === undefined) {
  throw new Error(`session not found: ${session}`)
}
console.log(`session: ${ref.sessionId} (${Math.round(ref.sizeBytes / 1024)}KB)`)

const trace = adapter.convertSession({ sessionPath: ref.sessionPath, sessionId: ref.sessionId })
const texts: string[] = []
for (const event of trace.events) {
  texts.push(event.detail)
  if (event.payload !== undefined) {
    mapStringLeaves(event.payload, (leaf) => {
      texts.push(leaf)
      return leaf
    })
  }
}
const limit = Number(argValue("--limit") ?? texts.length)
const deduped = args.includes("--unique")
const sliced = texts.slice(0, limit)
const sample = deduped ? [...new Set(sliced)] : sliced
const uniqueCount = new Set(sample).size
const totalChars = sample.reduce((sum, text) => sum + text.length, 0)
console.log(
  `strings: ${sample.length} (${uniqueCount} unique), total ${Math.round(totalChars / 1024)}K chars`,
)

const batchSize = Number(argValue("--batch-size") ?? 16)
const batchTokens = Number(argValue("--batch-tokens") ?? 8192)
console.log(`batch: ${batchSize} rows / ${batchTokens} tokens`)
const dtype = (argValue("--dtype") ?? "fp32") as never
const engineUrl = argValue("--engine")
console.log(engineUrl === undefined ? `dtype: ${dtype}` : `engine: ${engineUrl}`)
const filter =
  engineUrl === undefined
    ? createTransformersPrivacyFilter("openai/privacy-filter", {
        maxBatchSize: batchSize,
        maxBatchTokens: batchTokens,
        dtype,
      })
    : createEnginePrivacyFilter(engineUrl)
// Warm the model so load time is excluded from the measurement.
await filter.detect(["warmup"])

const startedAt = performance.now()
const results = await filter.detect(sample)
const elapsedMs = performance.now() - startedAt
const spanCount = results.reduce((sum, spans) => sum + spans.length, 0)
console.log(
  `detect: ${Math.round(elapsedMs)}ms total, ${(elapsedMs / sample.length).toFixed(2)}ms/string, ${spanCount} spans`,
)

// Machine-readable line for before/after comparison and span diffing.
const digest = (spans: readonly (readonly PrivacySpan[])[]) =>
  JSON.stringify(
    spans.map((perText) =>
      perText.map((span) => `${span.start}:${span.end}:${span.category}:${span.score.toFixed(4)}`),
    ),
  )
const { createHash } = await import("node:crypto")
console.log(
  JSON.stringify({
    strings: sample.length,
    unique: uniqueCount,
    elapsedMs: Math.round(elapsedMs),
    msPerString: Number((elapsedMs / sample.length).toFixed(3)),
    spanCount,
    spanDigest: createHash("sha256").update(digest(results)).digest("hex").slice(0, 16),
    // Score-free digest: compares span boundaries/categories across dtypes,
    // where scores legitimately differ in low decimals.
    structureDigest: createHash("sha256")
      .update(
        JSON.stringify(
          results.map((perText) =>
            perText.map((span) => `${span.start}:${span.end}:${span.category}`),
          ),
        ),
      )
      .digest("hex")
      .slice(0, 16),
  }),
)
