import { z } from "zod"

const hermesContentJsonPrefix = "\x00json:"

export const hermesToolCallSchema = z
  .object({
    id: z.string().optional(),
    function: z
      .object({
        name: z.string().optional(),
        arguments: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

const hermesToolArgumentsSchema = z.record(z.string(), z.unknown())

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

export const summarizeArgumentsJson = (rawArguments: string | undefined): string => {
  if (rawArguments === undefined || rawArguments.trim().length === 0) {
    return ""
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawArguments)
  } catch {
    return rawArguments
  }
  const record = hermesToolArgumentsSchema.safeParse(parsed)
  if (!record.success) {
    return rawArguments
  }
  for (const key of toolArgumentSummaryKeys) {
    const value = record.data[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value
    }
  }
  return rawArguments
}

export const decodeHermesContent = (content: string | null): string => {
  if (content === null) {
    return ""
  }
  if (!content.startsWith(hermesContentJsonPrefix)) {
    return content
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(content.slice(hermesContentJsonPrefix.length))
  } catch {
    return ""
  }
  if (!Array.isArray(parsed)) {
    return typeof parsed === "string" ? parsed : ""
  }
  return parsed
    .map((part) => {
      if (typeof part === "string") {
        return part
      }
      if (typeof part === "object" && part !== null && "text" in part) {
        const text = part.text
        return typeof text === "string" ? text : ""
      }
      return ""
    })
    .join(" ")
    .trim()
}
