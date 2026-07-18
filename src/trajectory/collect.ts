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
import {
  applyCollectPrivacy,
  type CollectPrivacyOptions,
  type CollectPrivacySummary,
  resolveCollectPrivacy,
} from "./privacy/pipeline"

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
  privacy: CollectPrivacySummary
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

export const exportCollectedSession = async (
  input: {
    readonly runtime: string
    readonly session: string
    readonly sourceDir?: string
    readonly exportPath: string
  },
  privacyOptions?: CollectPrivacyOptions,
): Promise<CollectExportResult> => {
  const parsed = exportInputSchema.parse(input)
  const adapter = getHarnessAdapter(parsed.runtime)
  const sessionInput = resolveSessionInput({
    runtime: parsed.runtime,
    session: parsed.session,
    ...(parsed.sourceDir === undefined ? {} : { sourceDir: parsed.sourceDir }),
  })
  const converted = adapter.convertSession(sessionInput)
  const exportPath = resolveWritableProjectPath({
    inputPath: parsed.exportPath,
    code: "invalid_export_path",
    throwPathError: throwExportPathError,
  })
  // mkdir BEFORE resolveCollectPrivacy: when the cache is enabled, the export
  // resolves the cache path to dirname(exportPath)/privacy-cache.db (Oracle
  // O5), and openPrivacyCache refuses to open a path whose parent dir does
  // not exist. Creating the export dir first guarantees the cache parent
  // exists for the open call below.
  mkdirSync(dirname(exportPath), { recursive: true })
  const privacy = await resolveCollectPrivacy(privacyOptions)
  // Capture the cache handle before the try so the finally block can close
  // it without re-narrowing the ResolvedCollectPrivacy union (TypeScript
  // cannot carry the enabled-branch narrow into the finally).
  const cache = privacy.enabled ? privacy.cache : undefined
  // Per Oracle O2: close the cache handle exactly once per export in a finally
  // around applyCollectPrivacy + writeFileSync so a privacy-pass throw or a
  // mid-write failure does not leak the SQLite handle.
  try {
    const { trace, summary: privacySummary } = await applyCollectPrivacy(converted, privacy)
    writeFileSync(exportPath, `${JSON.stringify(trace, null, 2)}\n`, "utf8")
    return {
      runtime: trace.runtime,
      status: trace.status,
      sessionPath: sessionInput.sessionPath,
      exportPath,
      eventCount: trace.eventCount,
      eventKinds: [...new Set(trace.events.map((event) => event.kind))].sort(),
      privacy: privacySummary,
    }
  } finally {
    await cache?.close()
  }
}
