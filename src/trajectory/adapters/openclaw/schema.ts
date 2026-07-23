import { z } from "zod";

const contentBlockSchema = z
  .object({
    type: z.string(),
    text: z.string().optional(),
    thinking: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    arguments: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const usageSchema = z
  .object({
    input: z.number().int().nonnegative().optional(),
    output: z.number().int().nonnegative().optional(),
    cacheRead: z.number().int().nonnegative().optional(),
    cacheWrite: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const messageSchema = z
  .object({
    role: z.string(),
    content: z.union([z.string(), z.array(contentBlockSchema)]).optional(),
    model: z.string().optional(),
    toolCallId: z.string().optional(),
    toolName: z.string().optional(),
    isError: z.boolean().optional(),
    runtimeContextCarrier: z.boolean().optional(),
    command: z.string().optional(),
    exitCode: z.number().nullable().optional(),
    cancelled: z.boolean().optional(),
    usage: usageSchema.optional(),
    provider: z.string().optional(),
  })
  .passthrough();

export const transcriptLineSchema = z
  .object({
    type: z.string(),
    version: z.number().optional(),
    id: z.string().optional(),
    timestamp: z.string().optional(),
    parentId: z.string().nullable().optional(),
    cwd: z.string().optional(),
    message: messageSchema.optional(),
  })
  .passthrough();

export type TranscriptLine = z.infer<typeof transcriptLineSchema>;
export type ContentBlock = z.infer<typeof contentBlockSchema>;
