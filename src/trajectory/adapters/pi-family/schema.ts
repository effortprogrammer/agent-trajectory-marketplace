import { z } from "zod";

// pi-mono lineage session JSONL: line 1 is the session header, remaining
// lines are tree entries ({id, parentId}) wrapping pi-ai messages, or — in
// gajae-code v4/v5 files — append-only patch records replayed over earlier
// lines. `toolCall` blocks carry `arguments` (not `input`); thinking blocks
// carry private reasoning and are never exported.
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
    provider: z.string().optional(),
    usage: usageSchema.optional(),
    stopReason: z.string().optional(),
    toolCallId: z.string().optional(),
    toolName: z.string().optional(),
    isError: z.boolean().optional(),
    // UserMessage injection markers (auto-continue / mid-turn steering).
    synthetic: z.boolean().optional(),
    steering: z.boolean().optional(),
  })
  .passthrough();

export const sessionHeaderSchema = z
  .object({
    type: z.literal("session"),
    // Absent in v1 files; absence means v1.
    version: z.number().int().positive().optional(),
    id: z.string().min(1),
    timestamp: z.string().optional(),
    cwd: z.string().optional(),
    title: z.string().optional(),
    parentSession: z.string().optional(),
  })
  .passthrough();

export const sessionEntrySchema = z
  .object({
    type: z.string(),
    id: z.string().min(1),
    parentId: z.string().nullable().optional(),
    timestamp: z.string().optional(),
    message: messageSchema.optional(),
  })
  .passthrough();

// gajae-code v4/v5 append-only patch records: header_patch merges mutable
// header fields; entry_patch replaces the message payload of one earlier
// entry (written when replay metadata is sanitized), so replaying them yields
// the transcript the tool itself would reconstruct.
export const headerPatchSchema = z
  .object({
    type: z.literal("header_patch"),
    patch: z
      .object({
        title: z.string().optional(),
        titleSource: z.string().optional(),
        cwd: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const entryPatchSchema = z
  .object({
    type: z.literal("entry_patch"),
    entryId: z.string().min(1),
    patch: z.object({ message: messageSchema.optional() }).passthrough(),
  })
  .passthrough();

export type PiSessionHeader = z.infer<typeof sessionHeaderSchema>;
export type PiSessionEntry = z.infer<typeof sessionEntrySchema>;
export type PiAgentMessage = z.infer<typeof messageSchema>;
export type PiContentBlock = z.infer<typeof contentBlockSchema>;
