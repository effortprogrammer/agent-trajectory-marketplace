import { isAbsolute } from "node:path"

import { z } from "zod"

import { MarketplaceError } from "./error"
import { readFixtureFile } from "./fixture-reader"
import { parseAdmissionJson } from "./json-preflight"
import { sanitizedTraceBytes } from "./dataset-archive"
import { normalizedSanitizedTraceProjection } from "./sanitized-search-projection"
import type { FrozenTrace } from "./session-contract"

const maximumPolicyBytes = 16 * 1024
const maximumPatterns = 32
const maximumPatternCharacters = 256

const denyPolicySchema = z
  .object({
    patterns: z.array(z.string().min(1).max(maximumPatternCharacters)).max(maximumPatterns),
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.patterns).size !== value.patterns.length) {
      context.addIssue({ code: "custom", path: ["patterns"], message: "duplicate pattern" })
    }
  })

export type CandidateDenyPolicy = Readonly<{
  readonly patterns: readonly string[]
  readonly schemaVersion: 1
}>

const invalidPolicy = (): never => {
  throw new MarketplaceError("invalid_deny_policy")
}

export const readCandidateDenyPolicy = (path: string): CandidateDenyPolicy => {
  if (!isAbsolute(path)) return invalidPolicy()
  let bytes: Buffer
  try {
    bytes = readFixtureFile(path, maximumPolicyBytes)
  } catch {
    return invalidPolicy()
  }
  const input = parseAdmissionJson(bytes)
  const parsed = denyPolicySchema.safeParse(input)
  if (!parsed.success) return invalidPolicy()
  return parsed.data
}

const normalizedText = (text: string): string => text.normalize("NFC").toLowerCase()

// This is the sole policy/search view: the bounded bytes that would be uploaded,
// never the editable selection summary or unsanitized native session content.
const searchableText = (trace: FrozenTrace): string =>
  normalizedSanitizedTraceProjection(sanitizedTraceBytes(trace.bytes))

export const isDeniedCandidate = (trace: FrozenTrace, policy: CandidateDenyPolicy): boolean => {
  const text = searchableText(trace)
  return policy.patterns.some((pattern) => text.includes(normalizedText(pattern)))
}

export const allowedCandidates = (
  traces: readonly FrozenTrace[],
  policy: CandidateDenyPolicy | undefined,
): readonly FrozenTrace[] => policy === undefined ? traces : traces.filter((trace) => !isDeniedCandidate(trace, policy))

export const searchCandidates = (
  traces: readonly FrozenTrace[],
  query: string,
  policy: CandidateDenyPolicy | undefined,
): readonly FrozenTrace[] => {
  const normalizedQuery = normalizedText(query)
  return allowedCandidates(traces, policy).filter((trace) => searchableText(trace).includes(normalizedQuery))
}
