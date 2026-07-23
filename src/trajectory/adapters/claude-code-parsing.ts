import { readFileSync } from "node:fs"

import {
  type ContentBlock,
  type TranscriptRecord,
  transcriptRecordSchema,
} from "./claude-code-schema"

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

export const summarizeToolInput = (input: Readonly<Record<string, unknown>> | undefined): string => {
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

export const contentBlocks = (record: TranscriptRecord): readonly ContentBlock[] => {
  const content = record.message?.content
  return Array.isArray(content) ? content : []
}

// A tool_result block's content is a string, or an array of {type:"text",text}
// (and occasionally other) blocks. Flatten to the actual returned text — the
// observation the buyer is paying for.
export const toolResultOutput = (content: unknown): string => {
  if (typeof content === "string") {
    return content
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") {
          return block
        }
        if (block !== null && typeof block === "object" && "text" in block) {
          const text = (block as { text?: unknown }).text
          return typeof text === "string" ? text : ""
        }
        return ""
      })
      .join("")
  }
  return content === undefined ? "" : JSON.stringify(content)
}

export const humanPromptText = (record: TranscriptRecord): string | undefined => {
  const content = record.message?.content
  if (typeof content === "string") {
    return content.trim().length > 0 ? content : undefined
  }
  const blocks = contentBlocks(record)
  if (blocks.some((block) => block.type === "tool_result")) {
    return undefined
  }
  const text = blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join(" ")
    .trim()
  return text.length > 0 ? text : undefined
}

export const parseTranscriptRecords = (sessionPath: string): readonly TranscriptRecord[] => {
  const records: TranscriptRecord[] = []
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
    const parsed = transcriptRecordSchema.safeParse(rawRecord)
    if (parsed.success) {
      records.push(parsed.data)
    }
  }
  return records
}
