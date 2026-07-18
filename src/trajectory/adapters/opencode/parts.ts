import type { OpenCodePartRow } from "./database"
import { type OpenCodeTokenSet, partDataSchema } from "./schema"

export type OpenCodeToolPart = {
  readonly tool: string
  readonly state: Readonly<{
    readonly status?: string | undefined
    readonly input?: unknown
    readonly output?: unknown
  }>
}

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

export const summarizeToolInput = (input: unknown): string => {
  if (input === null || input === undefined || typeof input !== "object" || Array.isArray(input)) {
    return ""
  }
  const entries = new Map(Object.entries(input))
  for (const key of toolArgumentSummaryKeys) {
    const value = entries.get(key)
    if (typeof value === "string" && value.trim().length > 0) return value
  }
  return JSON.stringify(input)
}

export const toolStatusDetail = (status: string | undefined): string =>
  status === "error" ? "error" : "ok"

export const safeJsonParse = (raw: string | null): unknown => {
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// Concatenates every `text` part under one message. Reasoning text is
// skipped on purpose so private thoughts never leak.
export const collectTextParts = (parts: readonly OpenCodePartRow[]): string => {
  let text = ""
  for (const part of parts) {
    const parsed = partDataSchema.safeParse(safeJsonParse(part.data))
    if (!parsed.success) continue
    if (parsed.data.type !== "text") continue
    const segment = parsed.data.text
    if (segment === undefined || segment.length === 0) continue
    text = text.length === 0 ? segment : `${text} ${segment}`
  }
  return text
}

// Returns the tokens from the first step-finish part under one message, used
// as a fallback when message.data.tokens is absent.
export const collectStepFinishTokens = (
  parts: readonly OpenCodePartRow[],
): OpenCodeTokenSet | undefined => {
  for (const part of parts) {
    const parsed = partDataSchema.safeParse(safeJsonParse(part.data))
    if (!parsed.success) continue
    if (parsed.data.type === "step-finish") return parsed.data.tokens
  }
  return undefined
}

export const readToolPart = (part: OpenCodePartRow): OpenCodeToolPart | undefined => {
  const parsed = partDataSchema.safeParse(safeJsonParse(part.data))
  if (!parsed.success) return undefined
  if (parsed.data.type !== "tool") return undefined
  return {
    tool: parsed.data.tool ?? "tool",
    state: parsed.data.state ?? {},
  }
}
