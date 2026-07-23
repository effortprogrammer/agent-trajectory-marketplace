import { z } from "zod";

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
  .passthrough();

export type OpenCodeTokenSet = z.infer<typeof tokenSetSchema>;

export const messageDataSchema = z
  .object({
    role: z.string(),
    modelID: z.string().optional(),
    tokens: tokenSetSchema.optional(),
  })
  .passthrough();

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
  .passthrough();
