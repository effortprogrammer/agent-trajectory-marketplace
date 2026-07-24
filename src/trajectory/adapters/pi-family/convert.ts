import {
  extractHarnessSourceAttestation,
  type HarnessEventPayload,
  type HarnessSessionInput,
  type HarnessSourceAttestation,
  type HarnessTraceDocument,
  type HarnessTraceEvent,
  harnessCollectedStatus,
  harnessTraceDocumentSchema,
  redactHarnessDetail,
  sanitizeHarnessPayload,
  TrajectoryAdapterError,
} from "../contract"
import { detectPiFamilyVariant } from "./detect"
import {
  type PiAgentMessage,
  type PiContentBlock,
  type PiSessionEntry,
  parsePiSessionFile,
} from "./session-file"
import type { PiFamilyVariant } from "./variants"

type AssistantPayloadBlock = {
  readonly type: "text" | "tool_use"
  readonly text?: string | undefined
  readonly id?: string | undefined
  readonly name?: string | undefined
  readonly input?: unknown
}

const toolInputSummaryKeys = [
  "command",
  "file_path",
  "path",
  "description",
  "prompt",
  "query",
  "pattern",
  "url",
] as const

const summarizeToolInput = (input: Readonly<Record<string, unknown>> | undefined): string => {
  if (input === undefined) {
    return ""
  }
  for (const key of toolInputSummaryKeys) {
    const value = input[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value
    }
  }
  return JSON.stringify(input)
}

const messageBlocks = (message: PiAgentMessage): readonly PiContentBlock[] =>
  Array.isArray(message.content) ? message.content : []

const messageText = (message: PiAgentMessage): string => {
  if (typeof message.content === "string") {
    return message.content
  }
  return messageBlocks(message)
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("")
}

// A toolResult message's content is (TextContent | ImageContent)[]; flatten to
// the returned text — the observation the buyer is paying for.
const toolResultOutput = (message: PiAgentMessage): string => {
  if (typeof message.content === "string") {
    return message.content
  }
  return messageBlocks(message)
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("")
}

// Conversion rules (v1), mirroring the claude-code adapter's event vocabulary:
// - session_start once, from the JSONL header (variant evidence in detail).
// - Each non-synthetic user message opens a turn (function_enter/function_exit).
// - Each assistant message becomes one llm_call; its toolCall blocks become
//   tool_call events parented to the llm_call.
// - toolResult messages become tool_result events parented to the tool_call.
// - thinking blocks are never exported (private reasoning); synthetic/steering
//   user injections, extension entries (custom/custom_message/label), and
//   bookkeeping entries (model_change, compaction, tool selections, …) are
//   skipped in v1.
export const convertPiFamilySession = (
  variant: PiFamilyVariant,
  session: HarnessSessionInput,
): HarnessTraceDocument => {
  const sessionPath = session.sessionPath
  const file = parsePiSessionFile(sessionPath)

  // Provenance gate: a session whose fingerprint strongly claims a sibling
  // fork must be exported under that fork's runtime, never misattributed.
  const detection = detectPiFamilyVariant(sessionPath, file)
  if (
    detection.strong &&
    detection.runtime !== undefined &&
    detection.runtime !== variant.runtime
  ) {
    throw new TrajectoryAdapterError(
      "invalid_session",
      `invalid_session: ${sessionPath} fingerprints as ${detection.runtime} (${detection.evidence.join(", ")}); export it with runtime ${detection.runtime}`,
    )
  }

  const version = file.header.version ?? 1
  if (version > variant.maxSessionVersion) {
    throw new TrajectoryAdapterError(
      "invalid_session",
      `invalid_session: session version ${version} exceeds ${variant.runtime} max ${variant.maxSessionVersion} in ${sessionPath}`,
    )
  }

  const messageEntries = file.entries.filter(
    (entry): entry is PiSessionEntry & { message: PiAgentMessage } =>
      entry.type === "message" && entry.message !== undefined,
  )
  if (messageEntries.length === 0) {
    throw new TrajectoryAdapterError(
      "invalid_session",
      `invalid_session: no message entries in ${sessionPath}`,
    )
  }

  const events: HarnessTraceEvent[] = []
  let hasPayload = false
  let hasAttestation = false
  // Guard against duplicate source IDs (the document schema rejects them):
  // attestation is dropped for a repeated ID rather than failing the export.
  const seenSourceEventIds = new Set<string>()
  let currentLlmSourceEventId: string | undefined
  const toolCallSourceEventIdByCallId = new Map<string, string>()
  const toolNamesByCallId = new Map<string, string>()

  type EmitOptions = {
    readonly payload?: HarnessEventPayload | undefined
    readonly attestation?: HarnessSourceAttestation | undefined
  }

  const emit = (
    kind: string,
    name: string,
    detail: string,
    options?: EmitOptions,
  ): HarnessTraceEvent => {
    const sanitized =
      options?.payload === undefined ? undefined : sanitizeHarnessPayload(options.payload)
    if (sanitized !== undefined) {
      hasPayload = true
    }
    let attestation = options?.attestation
    if (attestation !== undefined && seenSourceEventIds.has(attestation.sourceEventId)) {
      attestation = undefined
    }
    if (attestation !== undefined) {
      hasAttestation = true
      seenSourceEventIds.add(attestation.sourceEventId)
    }
    const event: HarnessTraceEvent = {
      kind,
      name,
      detail: redactHarnessDetail(detail),
      ...(sanitized === undefined ? {} : { payload: sanitized }),
      ...(attestation === undefined
        ? {}
        : {
            timestamp: attestation.timestamp,
            sourceEventId: attestation.sourceEventId,
            ...(attestation.parentSourceEventId === undefined
              ? {}
              : { parentSourceEventId: attestation.parentSourceEventId }),
          }),
    }
    events.push(event)
    return event
  }

  const evidence = detection.evidence.length === 0 ? "none" : detection.evidence.join("+")
  emit(
    "session_start",
    file.header.id,
    `${variant.runtime} sessionVersion=${version} cwd=${file.header.cwd ?? "unknown"} variantEvidence=${evidence}`,
    {
      attestation: extractHarnessSourceAttestation({
        ...(file.header.timestamp === undefined ? {} : { timestamp: file.header.timestamp }),
        sourceEventId: `${variant.runtime}:session:${file.header.id}`,
      }),
    },
  )

  let turnCount = 0
  const closeTurn = () => {
    if (turnCount > 0) {
      emit("function_exit", `turn-${turnCount}`, "")
    }
  }

  for (const entry of messageEntries) {
    const message = entry.message
    const entryAttestation = (sourceEventId: string, parentSourceEventId?: string) =>
      extractHarnessSourceAttestation({
        ...(entry.timestamp === undefined ? {} : { timestamp: entry.timestamp }),
        sourceEventId,
        ...(parentSourceEventId === undefined ? {} : { parentSourceEventId }),
      })

    if (message.role === "user") {
      if (message.synthetic === true || message.steering === true) {
        continue
      }
      const prompt = messageText(message).trim()
      if (prompt.length === 0) {
        continue
      }
      closeTurn()
      turnCount += 1
      // Payload carries the full prompt; detail stays the capped summary.
      emit("function_enter", `turn-${turnCount}`, prompt, {
        payload: { role: "user", content: prompt },
        attestation: entryAttestation(`${variant.runtime}:entry:${entry.id}`),
      })
      continue
    }

    if (message.role === "assistant") {
      const blocks = messageBlocks(message)
      const assistantBlocks: AssistantPayloadBlock[] = []
      for (const block of blocks) {
        if (block.type === "text") {
          assistantBlocks.push({ type: "text", text: block.text ?? "" })
        } else if (block.type === "toolCall") {
          assistantBlocks.push({
            type: "tool_use",
            ...(block.id === undefined ? {} : { id: block.id }),
            ...(block.name === undefined ? {} : { name: block.name }),
            input: block.arguments ?? {},
          })
        }
      }
      if (assistantBlocks.length === 0) {
        // Thinking-only or empty (errored/aborted) assistant message.
        continue
      }
      const model = message.model ?? "unknown"
      const usage = message.usage
      const payload: HarnessEventPayload = {
        role: "assistant",
        content: assistantBlocks,
        usage: {
          model,
          ...(usage?.input === undefined ? {} : { inputTokens: usage.input }),
          ...(usage?.output === undefined ? {} : { outputTokens: usage.output }),
          // pi-ai splits cacheRead (cached-input reads) from cacheWrite (cache
          // creation); both map onto the cross-adapter usage schema.
          ...(usage?.cacheRead === undefined ? {} : { cachedInputTokens: usage.cacheRead }),
          ...(usage?.cacheWrite === undefined ? {} : { cacheWriteTokens: usage.cacheWrite }),
        },
      }
      const llmEvent = emit("llm_call", model, messageText(message).trim(), {
        payload,
        attestation: entryAttestation(`${variant.runtime}:entry:${entry.id}`),
      })
      currentLlmSourceEventId = llmEvent.sourceEventId
      for (const block of blocks) {
        if (block.type !== "toolCall") {
          continue
        }
        const toolName = block.name ?? "tool"
        if (block.id !== undefined) {
          toolNamesByCallId.set(block.id, toolName)
        }
        // Action: the full tool input; the tool name is already the event name.
        const toolEvent = emit("tool_call", toolName, summarizeToolInput(block.arguments), {
          payload: {
            ...(block.id === undefined ? {} : { toolUseId: block.id }),
            input: block.arguments ?? {},
          },
          attestation:
            block.id === undefined
              ? undefined
              : entryAttestation(`${variant.runtime}:tool:${block.id}`, currentLlmSourceEventId),
        })
        if (block.id !== undefined && toolEvent.sourceEventId !== undefined) {
          toolCallSourceEventIdByCallId.set(block.id, toolEvent.sourceEventId)
        }
      }
      continue
    }

    if (message.role === "toolResult") {
      const toolCallId = message.toolCallId
      const toolName =
        message.toolName ??
        (toolCallId === undefined ? undefined : toolNamesByCallId.get(toolCallId)) ??
        "tool"
      const output = toolResultOutput(message)
      const parentToolSourceId =
        toolCallId === undefined ? undefined : toolCallSourceEventIdByCallId.get(toolCallId)
      emit("tool_result", toolName, message.isError === true ? "error" : "ok", {
        payload: {
          ...(toolCallId === undefined ? {} : { toolUseId: toolCallId }),
          isError: message.isError === true,
          output,
          byteCount: Buffer.byteLength(output, "utf8"),
        },
        attestation:
          toolCallId === undefined
            ? undefined
            : entryAttestation(`${variant.runtime}:result:${toolCallId}`, parentToolSourceId),
      })
    }
  }
  closeTurn()

  return harnessTraceDocumentSchema.parse({
    runtime: variant.runtime,
    status: harnessCollectedStatus,
    ...(hasPayload || hasAttestation ? { formatVersion: 2 as const } : {}),
    eventCount: events.length,
    events,
  })
}
