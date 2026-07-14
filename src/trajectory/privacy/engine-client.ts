import { z } from "zod"

import { type PrivacyFilter, PrivacyFilterUnavailableError, piiCategories } from "./contract"

// Client for the local MPS inference engine (privacy-filter-engine repo).
// When TRAJECTORY_PRIVACY_ENGINE_URL is set, collect uses this instead of the
// in-process Transformers.js runner — same PrivacyFilter contract, so the
// pass, gates, and stamps are identical; only the inference backend moves to
// the GPU. Engine failures surface as PrivacyFilterUnavailableError, which
// the sweep treats as transient (retry next sweep), never as silent fallback
// to a slower or different backend.

export const privacyEngineUrlEnv = "TRAJECTORY_PRIVACY_ENGINE_URL"

// The engine reports offsets in UTF-16 code units (JS string indices).
const detectResponseSchema = z
  .object({
    spans: z.array(
      z.array(
        z
          .object({
            start: z.number().int().nonnegative(),
            end: z.number().int().nonnegative(),
            category: z.enum(piiCategories),
            score: z.number().min(0).max(1),
          })
          .strict(),
      ),
    ),
  })
  .strict()

export const createEnginePrivacyFilter = (baseUrl: string): PrivacyFilter => ({
  detect: async (texts) => {
    let response: Response
    try {
      response = await fetch(new URL("/detect", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ texts }),
      })
    } catch (caught: unknown) {
      throw new PrivacyFilterUnavailableError(`privacy engine unreachable: ${baseUrl}`, {
        cause: caught,
      })
    }
    if (!response.ok) {
      throw new PrivacyFilterUnavailableError(
        `privacy engine responded ${response.status}: ${baseUrl}`,
      )
    }
    let body: unknown
    try {
      body = await response.json()
    } catch (caught: unknown) {
      throw new PrivacyFilterUnavailableError(`privacy engine returned invalid JSON: ${baseUrl}`, {
        cause: caught,
      })
    }
    const parsed = detectResponseSchema.safeParse(body)
    if (!parsed.success || parsed.data.spans.length !== texts.length) {
      throw new PrivacyFilterUnavailableError(
        `privacy engine response does not match the detect contract: ${baseUrl}`,
      )
    }
    return parsed.data.spans
  },
})
