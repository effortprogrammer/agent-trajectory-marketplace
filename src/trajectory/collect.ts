import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import { z } from "zod"

import {
  type HarnessSessionRef,
  type HarnessTraceDocument,
  TrajectoryAdapterError,
} from "./adapters/contract"
import { getHarnessAdapter, listHarnessAdapters } from "./adapters/registry"
import { resolveWritableProjectPath } from "./path-safety"

const listSessionsInputSchema = z.object({
  runtime: z.string().min(1),
  sourceDir: z.string().min(1).optional(),
  limit: z.number().int().positive().max(500).optional(),
})

const exportInputSchema = z.object({
  runtime: z.string().min(1),
  session: z.string().min(1),
  sourceDir: z.string().min(1).optional(),
  exportPath: z.string().min(1),
})

export type CollectRuntimeSummary = Readonly<{
  runtime: string
  displayName: string
  logHint: string
  defaultSourceDir?: string
}>

export type CollectSessionsResult = Readonly<{
  runtime: string
  sourceDir: string
  sessionCount: number
  sessions: readonly HarnessSessionRef[]
}>

export type CollectExportResult = Readonly<{
  runtime: string
  status: HarnessTraceDocument["status"]
  sessionPath: string
  exportPath: string
  eventCount: number
  eventKinds: readonly string[]
}>

const throwExportPathError = (code: "invalid_export_path", path: string): never => {
  throw new TrajectoryAdapterError(code, `${code}: ${path}`)
}

export const listCollectRuntimes = (): readonly CollectRuntimeSummary[] =>
  listHarnessAdapters().map((adapter) => {
    const defaultSourceDir = adapter.defaultSourceDir()
    return {
      runtime: adapter.runtime,
      displayName: adapter.displayName,
      logHint: adapter.logHint,
      ...(defaultSourceDir === undefined ? {} : { defaultSourceDir }),
    }
  })

const resolveSourceDir = (runtime: string, sourceDir: string | undefined): string => {
  if (sourceDir !== undefined) {
    return sourceDir
  }
  const adapter = getHarnessAdapter(runtime)
  const defaultSourceDir = adapter.defaultSourceDir()
  if (defaultSourceDir === undefined) {
    throw new TrajectoryAdapterError(
      "missing_source_dir",
      `missing_source_dir: pass --source for runtime ${runtime}`,
    )
  }
  return defaultSourceDir
}

export const listCollectSessions = (input: {
  readonly runtime: string
  readonly sourceDir?: string
  readonly limit?: number
}): CollectSessionsResult => {
  const parsed = listSessionsInputSchema.parse(input)
  const adapter = getHarnessAdapter(parsed.runtime)
  const sourceDir = resolveSourceDir(parsed.runtime, parsed.sourceDir)
  const sessions = adapter.listSessions(sourceDir)
  return {
    runtime: adapter.runtime,
    sourceDir,
    sessionCount: sessions.length,
    sessions: sessions.slice(0, parsed.limit ?? 20),
  }
}

const resolveSessionInput = (input: {
  readonly runtime: string
  readonly session: string
  readonly sourceDir?: string
}): { readonly sessionPath: string; readonly sessionId?: string } => {
  if (existsSync(input.session) && statSync(input.session).isFile()) {
    return { sessionPath: input.session }
  }
  const adapter = getHarnessAdapter(input.runtime)
  const sourceDir = resolveSourceDir(input.runtime, input.sourceDir)
  const match = adapter
    .listSessions(sourceDir)
    .find((candidate) => candidate.sessionId === input.session)
  if (match === undefined) {
    throw new TrajectoryAdapterError(
      "missing_session",
      `missing_session: ${input.session} is neither a session file nor a session id under ${sourceDir}`,
    )
  }
  return { sessionPath: match.sessionPath, sessionId: match.sessionId }
}

export const exportCollectedSession = (input: {
  readonly runtime: string
  readonly session: string
  readonly sourceDir?: string
  readonly exportPath: string
}): CollectExportResult => {
  const parsed = exportInputSchema.parse(input)
  const adapter = getHarnessAdapter(parsed.runtime)
  const sessionInput = resolveSessionInput({
    runtime: parsed.runtime,
    session: parsed.session,
    ...(parsed.sourceDir === undefined ? {} : { sourceDir: parsed.sourceDir }),
  })
  const trace = adapter.convertSession(sessionInput)
  const exportPath = resolveWritableProjectPath({
    inputPath: parsed.exportPath,
    code: "invalid_export_path",
    throwPathError: throwExportPathError,
  })
  mkdirSync(dirname(exportPath), { recursive: true })
  writeFileSync(exportPath, `${JSON.stringify(trace, null, 2)}\n`, "utf8")
  return {
    runtime: trace.runtime,
    status: trace.status,
    sessionPath: sessionInput.sessionPath,
    exportPath,
    eventCount: trace.eventCount,
    eventKinds: [...new Set(trace.events.map((event) => event.kind))].sort(),
  }
}
