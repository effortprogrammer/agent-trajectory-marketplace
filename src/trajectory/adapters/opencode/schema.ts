import { z } from "zod"

// Boundary schemas for OpenCode's `data` JSON columns. Each schema is
// permissive (.passthrough()) so unknown sibling keys survive unchanged;
// only the keys the adapter actually reads are constrained. `cost` is
// intentionally absent from the assistant schema — the adapter never reads
// or exports it.

const tokenSetSchema = z
  .object({
    input: z.number().int().nonnegative().optional(),
    output: z.number().int().nonnegative().optional(),
    reasoning: z.number().int().nonnegative().optional(),
    cache: z
      .object({
        read: z.number().int().nonnegative().optional(),
        write: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

export type OpenCodeTokenSet = z.infer<typeof tokenSetSchema>

export const messageDataSchema = z
  .object({
    role: z.string(),
    modelID: z.string().optional(),
    providerID: z.string().optional(),
    tokens: tokenSetSchema.optional(),
    metadata: z
      .object({
        time: z
          .object({
            created: z.number().optional(),
            completed: z.number().optional(),
          })
          .passthrough()
          .optional(),
        sessionID: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

export type OpenCodeMessageData = z.infer<typeof messageDataSchema>

export const partDataSchema = z
  .object({
    type: z.string(),
    text: z.string().optional(),
    tool: z.string().optional(),
    state: z
      .object({
        status: z.string().optional(),
        input: z.unknown().optional(),
        output: z.unknown().optional(),
      })
      .passthrough()
      .optional(),
    tokens: tokenSetSchema.optional(),
  })
  .passthrough()

export type OpenCodePartData = z.infer<typeof partDataSchema>
