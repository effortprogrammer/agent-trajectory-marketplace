import { isAbsolute } from "node:path"

import { z } from "zod"

import { parseAdmissionJson } from "./json-preflight"
import { fullSelectorSchema, traceHashSchema } from "./session-contract"
import type { FrozenTrace } from "./session-contract"

const maximumSelectionTraces = 10_000
const maximumSelectionBytes = 1024 * 1024

const selectionTraceSchema = z
  .object({
    byteCount: z.number().int().positive(),
    selector: fullSelectorSchema,
    sha256: traceHashSchema,
  })
  .strict()

const selectionDocumentSchema = z
  .object({
    root: z.string().min(1).refine(isAbsolute),
    schemaVersion: z.literal(1),
    traces: z.array(selectionTraceSchema).min(1).max(maximumSelectionTraces),
  })
  .strict()
  .superRefine((value, context) => {
    const selectors = new Set<string>()
    for (const [index, trace] of value.traces.entries()) {
      if (selectors.has(trace.selector)) {
        context.addIssue({ code: "custom", path: ["traces", index, "selector"], message: "duplicate selector" })
      }
      selectors.add(trace.selector)
    }
  })

export type SelectionDocument = Readonly<{
  readonly root: string
  readonly schemaVersion: 1
  readonly traces: readonly Readonly<{
    byteCount: number
    selector: FrozenTrace["selector"]
    sha256: FrozenTrace["hash"]
  }>[]
}>

export class SelectionContractError extends Error {
  public readonly name = "SelectionContractError"
  public constructor(public readonly code: "invalid_selection") { super(code) }
}

const invalid = (): never => {
  throw new SelectionContractError("invalid_selection")
}

export const selectionDocumentFromTraces = (root: string, traces: readonly FrozenTrace[]): SelectionDocument =>
  Object.freeze({
    root,
    schemaVersion: 1,
    traces: Object.freeze(
      [...traces]
        .sort((left, right) => (left.selector < right.selector ? -1 : left.selector > right.selector ? 1 : 0))
        .map((trace) => Object.freeze({ byteCount: trace.byteCount, selector: trace.selector, sha256: trace.hash })),
    ),
  })

export const encodeSelectionDocument = (input: unknown): Buffer => {
  const parsed = selectionDocumentSchema.safeParse(input)
  if (!parsed.success) return invalid()
  return Buffer.from(`${JSON.stringify(parsed.data, null, 2)}\n`, "utf8")
}

export const parseSelectionDocument = (bytes: Buffer): SelectionDocument => {
  if (bytes.byteLength <= 0 || bytes.byteLength > maximumSelectionBytes) return invalid()
  const input = parseAdmissionJson(bytes)
  if (input === undefined) return invalid()
  const parsed = selectionDocumentSchema.safeParse(input)
  if (!parsed.success) return invalid()
  if (!encodeSelectionDocument(parsed.data).equals(bytes)) return invalid()
  return parsed.data
}
