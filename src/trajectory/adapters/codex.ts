import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, relative } from "node:path"

import { z } from "zod"

import {
  extractHarnessSourceAttestation,
  type HarnessAdapter,
  type HarnessEventPayload,
  type HarnessSessionInput,
  type HarnessSessionRef,
  type HarnessSourceAttestation,
  type HarnessTraceDocument,
  type HarnessTraceEvent,
  harnessCollectedStatus,
  harnessTraceDocumentSchema,
  redactHarnessDetail,
  TrajectoryAdapterError,
} from "./contract"

// allow: SIZE_OK — single-responsibility Codex adapter; attestation source-ID
// builders are intrinsic to per-event emission and follow the established
// claude-code.ts pattern. Splitting would duplicate schemas or create a
// single-call sibling without improving cohesion.
const codexRuntime = "codex"

const messageContentBlockSchema = z
  .object({
    type: z.string(),
    text: z.string().optional(),
  })
  .passthrough()

const tokenUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().optional(),
    cached_input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    reasoning_output_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative().optional(),
  })
  .passthrough()

const tokenCountInfoSchema = z
  .object({
    last_token_usage: tokenUsageSchema.optional(),
    total_token_usage: tokenUsageSchema.optional(),
    model_context_window: z.number().int().nonnegative().optional(),
  })
  .passthrough()

const rolloutPayloadSchema = z
  .object({
    // Only event_msg/response_item payloads carry a nested type; session_meta
    // and turn_context payloads are discriminated by the envelope type alone.
    type: z.string().optional(),
    id: z.string().optional(),
    session_id: z.string().optional(),
    cwd: z.string().optional(),
    originator: z.string().optional(),
    cli_version: z.string().optional(),
    model: z.string().optional(),
    message: z.string().optional(),
    role: z.string().optional(),
    content: z.array(messageContentBlockSchema).optional(),
    name: z.string().optional(),
    arguments: z.string().optional(),
    call_id: z.string().optional(),
    output: z.string().optional(),
    // event_msg token_count payloads carry per-call and cumulative usage; the
    // adapter attaches the per-call delta (last_token_usage) to the most recent
    // llm_call event so codex traces finally carry real token counts instead
    // of the 240-char detail-only summary.
    info: tokenCountInfoSchema.optional(),
  })
  .passthrough()

const rolloutRecordSchema = z
  .object({
    type: z.string(),
    timestamp: z.string().optional(),
    payload: rolloutPayloadSchema.optional(),
  })
  .passthrough()

type RolloutRecord = z.infer<typeof rolloutRecordSchema>

const toolArgumentSummaryKeys = [
  "cmd",
  "command",
  "file_path",
  "path",
  "pattern",
  "query",
  "prompt",
  "url",
] as const

const summarizeFunctionArguments = (rawArguments: string | undefined): string => {
  if (rawArguments === undefined || rawArguments.trim().length === 0) {
    return ""
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawArguments)
  } catch {
    return rawArguments
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return rawArguments
  }
  const record = parsed as Readonly<Record<string, unknown>>
  for (const key of toolArgumentSummaryKeys) {
    const value = record[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value
    }
  }
  return rawArguments
}

const exitCodePattern = /process exited with code (\d+)/i

const functionOutputStatus = (output: string | undefined): string => {
  if (output === undefined) {
    return "ok"
  }
  const match = exitCodePattern.exec(output)
  if (match?.[1] !== undefined && match[1] !== "0") {
    return "error"
  }
  return "ok"
}

// Stable string signature for a token_count total_token_usage snapshot. Two
// snapshots with the same signature are the same cumulative baseline, so the
// later one carries no new information and the caller skips it.
const totalUsageSignature = (
  total:
    | Readonly<{
        readonly input_tokens?: number | undefined
        readonly cached_input_tokens?: number | undefined
        readonly output_tokens?: number | undefined
        readonly reasoning_output_tokens?: number | undefined
        readonly total_tokens?: number | undefined
      }>
    | undefined,
): string => {
  if (total === undefined) return ""
  return [
    total.input_tokens ?? 0,
    total.cached_input_tokens ?? 0,
    total.output_tokens ?? 0,
    total.reasoning_output_tokens ?? 0,
    total.total_tokens ?? 0,
  ].join(":")
}

const assistantText = (record: RolloutRecord): string => {
  const blocks = record.payload?.content ?? []
  return blocks
    .filter((block) => block.type === "output_text")
    .map((block) => block.text ?? "")
    .join(" ")
    .trim()
}

const parseRolloutRecords = (sessionPath: string): readonly RolloutRecord[] => {
  const records: RolloutRecord[] = []
  const lines = readFileSync(sessionPath, "utf8").split("\n")
  for (const line of lines) {
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
    const parsed = rolloutRecordSchema.safeParse(rawRecord)
    if (parsed.success) {
      records.push(parsed.data)
    }
  }
  return records
}

// Conversion rules (v1):
// - session_start once, from the session_meta record.
// - Each event_msg user_message opens a turn: function_enter/function_exit
//   spans mirroring the claude-code adapter's turn structure.
// - llm_call per assistant response_item message, named after the model from
//   the most recent turn_context.
// - event_msg token_count records are NOT emitted as events; their
//   info.last_token_usage is attached as payload.usage on the most recent
//   llm_call so codex traces carry real per-call token counts.
// - function_call items become tool_call events; function_call_output items
//   become tool_result events named after the originating function, with
//   ok/error derived from the reported process exit code.
// - reasoning items (encrypted model reasoning), developer/user response
//   messages, and other event_msg bookkeeping (task lifecycle) are never
//   exported.
const convertCodexSession = (session: HarnessSessionInput): HarnessTraceDocument => {
  const sessionPath = session.sessionPath
  if (!existsSync(sessionPath) || !statSync(sessionPath).isFile()) {
    throw new TrajectoryAdapterError("missing_session", `missing_session: ${sessionPath}`)
  }
  if (!sessionPath.endsWith(".jsonl")) {
    throw new TrajectoryAdapterError("invalid_session", `invalid_session: ${sessionPath}`)
  }
  const records = parseRolloutRecords(sessionPath)
  const sessionMeta = records.find((record) => record.type === "session_meta")
  if (sessionMeta === undefined) {
    throw new TrajectoryAdapterError(
      "invalid_session",
      `invalid_session: no session_meta record in ${sessionPath}`,
    )
  }

  const events: HarnessTraceEvent[] = []
  let hasAttestation = false
  let hasPayload = false
  // Last llm_call index that a subsequent token_count event should attach
  // usage to. Undefined until the first assistant message is emitted, so a
  // pre-roll token_count (rare but possible) cannot target a missing event.
  let lastLlmCallIndex: number | undefined
  const emit = (
    kind: string,
    name: string,
    detail: string,
    attestation?: HarnessSourceAttestation,
    payload?: HarnessEventPayload,
  ): HarnessTraceEvent => {
    if (attestation !== undefined) {
      hasAttestation = true
    }
    if (payload !== undefined) {
      hasPayload = true
    }
    const event: HarnessTraceEvent = {
      kind,
      name,
      detail: redactHarnessDetail(detail),
      ...(attestation === undefined
        ? {}
        : {
            timestamp: attestation.timestamp,
            sourceEventId: attestation.sourceEventId,
            ...(attestation.parentSourceEventId === undefined
              ? {}
              : { parentSourceEventId: attestation.parentSourceEventId }),
          }),
      ...(payload === undefined ? {} : { payload }),
    }
    events.push(event)
    return event
  }

  const meta = sessionMeta.payload
  const sessionId = meta?.id ?? meta?.session_id ?? basename(sessionPath, ".jsonl")
  emit(
    "session_start",
    sessionId,
    `codex ${meta?.cli_version ?? "unknown"} cwd=${meta?.cwd ?? "unknown"} originator=${meta?.originator ?? "unknown"}`,
    extractHarnessSourceAttestation({
      ...(sessionMeta.timestamp === undefined ? {} : { timestamp: sessionMeta.timestamp }),
      sourceEventId: `codex:session:${sessionId}`,
    }),
  )

  let turnCount = 0
  let currentModel = "codex"
  // String signature of the previous token_count's total_token_usage; used
  // to skip duplicate cumulative snapshots (same total ⇒ same delta ⇒ skip).
  let previousTotalSignature: string | undefined
  const functionNamesByCallId = new Map<string, string>()
  const toolCallSourceEventIdByCallId = new Map<string, string>()
  const closeTurn = () => {
    if (turnCount > 0) {
      emit("function_exit", `turn-${turnCount}`, "")
    }
  }

  records.forEach((record, recordIndex) => {
    const payload = record.payload
    if (payload === undefined) {
      return
    }
    if (record.type === "turn_context") {
      if (payload.model !== undefined && payload.model.length > 0) {
        currentModel = payload.model
      }
      return
    }
    if (record.type === "event_msg" && payload.type === "user_message") {
      closeTurn()
      turnCount += 1
      emit(
        "function_enter",
        `turn-${turnCount}`,
        payload.message ?? "",
        extractHarnessSourceAttestation({
          ...(record.timestamp === undefined ? {} : { timestamp: record.timestamp }),
          sourceEventId: `codex:user_message:${sessionId}:${recordIndex}`,
        }),
      )
      return
    }
    if (record.type === "event_msg" && payload.type === "token_count") {
      // token_count fires after each assistant response. info.last_token_usage
      // is the per-call delta; total_token_usage is the cumulative baseline
      // used only for dedup/monotonicity (tokscale parity). Skip duplicates
      // (same total signature as previous) and post-compaction zero snapshots
      // (advance-baseline would inflate subsequent deltas). cached_input_tokens
      // is clamped to <= input_tokens then subtracted from input_tokens so a
      // buyer summing inputTokens + cachedInputTokens does not double-count
      // cache-read tokens. Pre-roll token_counts (before any llm_call) drop.
      const lastUsage = payload.info?.last_token_usage
      const totalUsage = payload.info?.total_token_usage
      const currentSig = totalUsageSignature(totalUsage)
      if (previousTotalSignature !== undefined && currentSig === previousTotalSignature) {
        return
      }
      const isAllZeroDelta =
        lastUsage !== undefined &&
        (lastUsage.input_tokens ?? 0) === 0 &&
        (lastUsage.cached_input_tokens ?? 0) === 0 &&
        (lastUsage.output_tokens ?? 0) === 0 &&
        (lastUsage.reasoning_output_tokens ?? 0) === 0 &&
        (lastUsage.total_tokens ?? 0) === 0
      if (isAllZeroDelta) {
        return
      }
      if (lastUsage !== undefined && lastLlmCallIndex !== undefined) {
        const rawInput = lastUsage.input_tokens
        const rawCached = lastUsage.cached_input_tokens
        let usageInput = rawInput
        let usageCached = rawCached
        if (rawInput !== undefined && rawCached !== undefined) {
          const clamped = Math.min(rawCached, rawInput)
          usageInput = rawInput - clamped
          usageCached = clamped
        }
        const usage: NonNullable<HarnessEventPayload["usage"]> = {
          model: currentModel,
          ...(usageInput === undefined ? {} : { inputTokens: usageInput }),
          ...(lastUsage.output_tokens === undefined
            ? {}
            : { outputTokens: lastUsage.output_tokens }),
          ...(usageCached === undefined ? {} : { cachedInputTokens: usageCached }),
          ...(lastUsage.reasoning_output_tokens === undefined
            ? {}
            : { reasoningOutputTokens: lastUsage.reasoning_output_tokens }),
        }
        const target = events[lastLlmCallIndex]
        if (target === undefined) {
          return
        }
        events[lastLlmCallIndex] = {
          ...target,
          payload: { ...(target.payload ?? {}), usage },
        }
        hasPayload = true
        // Only advance the dedup baseline after a successful emit; otherwise
        // a pre-roll token_count (no llm_call yet) or a missing last_token_usage
        // would advance the baseline without attributing usage, and a later
        // token_count with the same total signature would be wrongly skipped.
        previousTotalSignature = currentSig
      }
      return
    }
    if (record.type !== "response_item") {
      return
    }
    if (payload.type === "message" && payload.role === "assistant") {
      const messageId = payload.id
      emit(
        "llm_call",
        currentModel,
        assistantText(record),
        extractHarnessSourceAttestation({
          ...(record.timestamp === undefined ? {} : { timestamp: record.timestamp }),
          sourceEventId:
            messageId === undefined
              ? `codex:message:${sessionId}:${recordIndex}`
              : `codex:message:${messageId}`,
        }),
      )
      lastLlmCallIndex = events.length - 1
      return
    }
    if (payload.type === "function_call") {
      const functionName = payload.name ?? "function"
      const callId = payload.call_id
      if (callId !== undefined) {
        functionNamesByCallId.set(callId, functionName)
      }
      const sourceEventId =
        callId === undefined
          ? `codex:function_call:${sessionId}:${recordIndex}`
          : `codex:function_call:${callId}`
      const toolEvent = emit(
        "tool_call",
        functionName,
        summarizeFunctionArguments(payload.arguments),
        extractHarnessSourceAttestation({
          ...(record.timestamp === undefined ? {} : { timestamp: record.timestamp }),
          sourceEventId,
        }),
      )
      if (callId !== undefined && toolEvent.sourceEventId !== undefined) {
        toolCallSourceEventIdByCallId.set(callId, toolEvent.sourceEventId)
      }
      return
    }
    if (payload.type === "function_call_output") {
      const callId = payload.call_id
      const functionName = functionNamesByCallId.get(callId ?? "") ?? "function"
      const parentSourceEventId =
        callId === undefined ? undefined : toolCallSourceEventIdByCallId.get(callId)
      emit(
        "tool_result",
        functionName,
        functionOutputStatus(payload.output),
        extractHarnessSourceAttestation({
          ...(record.timestamp === undefined ? {} : { timestamp: record.timestamp }),
          sourceEventId:
            callId === undefined
              ? `codex:function_call_output:${sessionId}:${recordIndex}`
              : `codex:function_call_output:${callId}`,
          ...(parentSourceEventId === undefined ? {} : { parentSourceEventId }),
        }),
      )
    }
  })
  closeTurn()

  return harnessTraceDocumentSchema.parse({
    runtime: codexRuntime,
    status: harnessCollectedStatus,
    ...(hasAttestation || hasPayload ? { formatVersion: 2 as const } : {}),
    eventCount: events.length,
    events,
  })
}

const collectSessionFiles = (
  rootDir: string,
  currentDir: string,
  refs: HarnessSessionRef[],
): void => {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const entryPath = join(currentDir, entry.name)
    if (entry.isDirectory()) {
      collectSessionFiles(rootDir, entryPath, refs)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue
    }
    const stats = statSync(entryPath)
    const parentDir = relative(rootDir, join(entryPath, ".."))
    refs.push({
      sessionId: basename(entryPath, ".jsonl"),
      sessionPath: entryPath,
      modifiedAt: stats.mtime.toISOString(),
      sizeBytes: stats.size,
      ...(parentDir === "" || parentDir === "." ? {} : { projectDir: parentDir }),
    })
  }
}

const listCodexSessions = (sourceDir: string): readonly HarnessSessionRef[] => {
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new TrajectoryAdapterError("missing_source_dir", `missing_source_dir: ${sourceDir}`)
  }
  const refs: HarnessSessionRef[] = []
  collectSessionFiles(sourceDir, sourceDir, refs)
  // Codex rotates sessions → archived_sessions under the same parent. When the
  // caller passes the standard sessions dir, auto-include the archived sibling
  // so the default collection covers history. Custom source dirs are skipped
  // (no opinionated sibling scan).
  const archivedSibling = join(dirname(sourceDir), "archived_sessions")
  if (
    basename(sourceDir) === "sessions" &&
    existsSync(archivedSibling) &&
    statSync(archivedSibling).isDirectory()
  ) {
    collectSessionFiles(archivedSibling, archivedSibling, refs)
  }
  return refs.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
}

export const codexAdapter: HarnessAdapter = {
  runtime: codexRuntime,
  displayName: "Codex CLI",
  logHint: "~/.codex/sessions/ and ~/.codex/archived_sessions/ (rollout-<timestamp>-<id>.jsonl)",
  defaultSourceDir: () => {
    const home = homedir()
    return home.length === 0 ? undefined : join(home, ".codex", "sessions")
  },
  listSessions: listCodexSessions,
  convertSession: convertCodexSession,
}
