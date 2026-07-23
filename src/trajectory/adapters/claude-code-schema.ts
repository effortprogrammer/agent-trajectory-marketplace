import { z } from "zod"

export const contentBlockSchema = z
  .object({
    type: z.string(),
    text: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    input: z.record(z.string(), z.unknown()).optional(),
    tool_use_id: z.string().optional(),
    is_error: z.boolean().optional(),
    content: z.unknown().optional(),
  })
  .passthrough()

export const transcriptRecordSchema = z
  .object({
    type: z.string(),
    isMeta: z.boolean().optional(),
    isSidechain: z.boolean().optional(),
    isApiErrorMessage: z.boolean().optional(),
    // Raw transcript stamp and parentage. Both are typed but only timestamp
    // feeds source attestation; parentMessageId is never used to infer turn
    // parents (synthetic turn spans stay unattested by design).
    timestamp: z.string().optional(),
    parentMessageId: z.string().optional(),
    cwd: z.string().optional(),
    sessionId: z.string().optional(),
    version: z.string().optional(),
    gitBranch: z.string().optional(),
    message: z
      .object({
        id: z.string().optional(),
        model: z.string().optional(),
        content: z.union([z.string(), z.array(contentBlockSchema)]).optional(),
        usage: z
          .object({
            input_tokens: z.number().optional(),
            output_tokens: z.number().optional(),
            cache_read_input_tokens: z.number().optional(),
            cache_creation_input_tokens: z.number().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

export type TranscriptRecord = z.infer<typeof transcriptRecordSchema>
export type ContentBlock = z.infer<typeof contentBlockSchema>
export type AssistantPayloadBlock = {
  readonly type: "text" | "tool_use"
  readonly text?: string | undefined
  readonly id?: string | undefined
  readonly name?: string | undefined
  readonly input?: unknown
}

export type ClaudeUsage = {
  readonly input_tokens?: number | undefined
  readonly output_tokens?: number | undefined
  readonly cache_read_input_tokens?: number | undefined
  readonly cache_creation_input_tokens?: number | undefined
}

export const syntheticModel = "<synthetic>"
