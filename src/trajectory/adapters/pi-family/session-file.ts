import { existsSync, readFileSync, statSync } from "node:fs"

import { z } from "zod"

import { TrajectoryAdapterError } from "../contract"

// pi-mono lineage session JSONL: line 1 is the session header, remaining lines
// are tree entries ({id, parentId}) or — in gajae-code v4/v5 files —
// append-only patch records replayed over earlier lines.

export const piSessionHeaderSchema = z
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
  .passthrough()
export type PiSessionHeader = z.infer<typeof piSessionHeaderSchema>

// Content blocks inside AgentMessage (pi-ai types). `toolCall` carries
// `arguments` (not `input`); thinking blocks carry private reasoning and are
// never exported.
const piContentBlockSchema = z
  .object({
    type: z.string(),
    text: z.string().optional(),
    thinking: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    arguments: z.record(z.unknown()).optional(),
  })
  .passthrough()
export type PiContentBlock = z.infer<typeof piContentBlockSchema>

const piUsageSchema = z
  .object({
    input: z.number().optional(),
    output: z.number().optional(),
    cacheRead: z.number().optional(),
    cacheWrite: z.number().optional(),
  })
  .passthrough()

export const piAgentMessageSchema = z
  .object({
    role: z.string(),
    content: z.union([z.string(), z.array(piContentBlockSchema)]).optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    usage: piUsageSchema.optional(),
    stopReason: z.string().optional(),
    // ToolResultMessage fields.
    toolCallId: z.string().optional(),
    toolName: z.string().optional(),
    isError: z.boolean().optional(),
    // UserMessage injection markers (auto-continue / mid-turn steering).
    synthetic: z.boolean().optional(),
    steering: z.boolean().optional(),
  })
  .passthrough()
export type PiAgentMessage = z.infer<typeof piAgentMessageSchema>

export const piSessionEntrySchema = z
  .object({
    type: z.string(),
    id: z.string().min(1),
    parentId: z.string().nullable().optional(),
    timestamp: z.string().optional(),
    message: piAgentMessageSchema.optional(),
  })
  .passthrough()
export type PiSessionEntry = z.infer<typeof piSessionEntrySchema>

// gajae-code v4/v5 append-only patch records (session-manager.ts upstream):
// header_patch merges mutable header fields; entry_patch replaces the message
// payload of one earlier entry (written when replay metadata is sanitized), so
// replaying them yields the transcript the tool itself would reconstruct.
const piHeaderPatchSchema = z
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
  .passthrough()

const piEntryPatchSchema = z
  .object({
    type: z.literal("entry_patch"),
    entryId: z.string().min(1),
    patch: z.object({ message: piAgentMessageSchema.optional() }).passthrough(),
  })
  .passthrough()

export type PiSessionFile = Readonly<{
  header: PiSessionHeader
  // Entries in file order with patch records already replayed.
  entries: readonly PiSessionEntry[]
  // Raw record `type` values seen in the file (pre-replay), for variant
  // fingerprinting.
  rawRecordTypes: ReadonlySet<string>
  patchRecordCount: number
}>

export const parsePiSessionFile = (sessionPath: string): PiSessionFile => {
  if (!existsSync(sessionPath) || !statSync(sessionPath).isFile()) {
    throw new TrajectoryAdapterError("missing_session", `missing_session: ${sessionPath}`)
  }
  if (!sessionPath.endsWith(".jsonl")) {
    throw new TrajectoryAdapterError("invalid_session", `invalid_session: ${sessionPath}`)
  }

  let header: PiSessionHeader | undefined
  const entries: PiSessionEntry[] = []
  const entriesById = new Map<string, PiSessionEntry>()
  const rawRecordTypes = new Set<string>()
  let patchRecordCount = 0

  for (const line of readFileSync(sessionPath, "utf8").split("\n")) {
    if (line.trim().length === 0) {
      continue
    }
    let rawRecord: unknown
    try {
      rawRecord = JSON.parse(line)
    } catch {
      // Tolerate torn tail lines from live sessions; everything else must parse.
      continue
    }
    if (rawRecord === null || typeof rawRecord !== "object") {
      continue
    }
    const recordType = (rawRecord as { type?: unknown }).type
    if (typeof recordType === "string") {
      rawRecordTypes.add(recordType)
    }

    if (header === undefined) {
      const headerResult = piSessionHeaderSchema.safeParse(rawRecord)
      if (!headerResult.success) {
        throw new TrajectoryAdapterError(
          "invalid_session",
          `invalid_session: first record is not a pi-family session header in ${sessionPath}`,
        )
      }
      header = headerResult.data
      continue
    }

    if (recordType === "header_patch") {
      patchRecordCount += 1
      const patchResult = piHeaderPatchSchema.safeParse(rawRecord)
      if (patchResult.success) {
        const { title, cwd } = patchResult.data.patch
        if (title !== undefined) header = { ...header, title }
        if (cwd !== undefined) header = { ...header, cwd }
      }
      continue
    }
    if (recordType === "entry_patch") {
      patchRecordCount += 1
      const patchResult = piEntryPatchSchema.safeParse(rawRecord)
      if (patchResult.success && patchResult.data.patch.message !== undefined) {
        const target = entriesById.get(patchResult.data.entryId)
        if (target !== undefined && target.type === "message") {
          target.message = patchResult.data.patch.message
        }
      }
      continue
    }

    const entryResult = piSessionEntrySchema.safeParse(rawRecord)
    if (entryResult.success) {
      entries.push(entryResult.data)
      entriesById.set(entryResult.data.id, entryResult.data)
    }
  }

  if (header === undefined) {
    throw new TrajectoryAdapterError(
      "invalid_session",
      `invalid_session: no session header in ${sessionPath}`,
    )
  }
  return { header, entries, rawRecordTypes, patchRecordCount }
}
