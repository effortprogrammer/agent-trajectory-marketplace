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
