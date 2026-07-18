import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { z } from "zod"

import { TrajectoryAdapterError } from "./adapters/contract"
import { getHarnessAdapter, listHarnessAdapters } from "./adapters/registry"
import { resolveWritableProjectPath } from "./path-safety"
import { PrivacyFilterUnavailableError } from "./privacy/contract"
import {
  applyCollectPrivacy,
  type CollectPrivacyOptions,
  resolveCollectPrivacy,
} from "./privacy/pipeline"

export const collectWatchStateFileName = "collect-watch-state.json"

export const collectWatchSessionFileName = (sessionId: string): string =>
  encodeURIComponent(sessionId)

const watchSessionEntrySchema = z
  .object({
    modifiedAt: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    outcome: z.enum(["exported", "failed"]),
    exportPath: z.string().optional(),
    eventCount: z.number().int().nonnegative().optional(),
    errorCode: z.string().optional(),
    updatedAt: z.string().min(1),
    // Digest of the privacy-filter config the export ran under. A model,
    // threshold, or category change makes existing entries stale so the
    // session re-exports with the new policy.
    privacyConfigHash: z.string().optional(),
  })
  .strict()

const watchStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    sessions: z.record(watchSessionEntrySchema),
  })
  .strict()

type CollectWatchState = z.infer<typeof watchStateSchema>

const collectSweepConfigSchema = z.object({
  outDir: z.string().min(1),
  runtimes: z.array(z.string().min(1)).min(1),
  sourceDir: z.string().min(1).optional(),
  settleSeconds: z.number().int().nonnegative(),
})

export type CollectSweepConfig = z.infer<typeof collectSweepConfigSchema>

export type CollectSweepExportedSession = Readonly<{
  runtime: string
  sessionId: string
  sessionPath: string
  exportPath: string
  eventCount: number
}>

export type CollectSweepFailedSession = Readonly<{
  runtime: string
  sessionId: string
  sessionPath: string
  errorCode: string
}>

export type CollectSweepSummary = Readonly<{
  sweepAt: string
  exported: number
  failed: number
  pendingSettle: number
  unchanged: number
  missingSources: readonly string[]
  exportedSessions: readonly CollectSweepExportedSession[]
  failedSessions: readonly CollectSweepFailedSession[]
  // True when the sweep stopped early because the privacy filter could not
  // load or run; unprocessed sessions retry on the next sweep.
  privacyFilterUnavailable?: boolean
}>

const throwInvalidOutDir = (code: "invalid_export_path", path: string): never => {
  throw new TrajectoryAdapterError(code, `${code}: ${path}`)
}

const emptyWatchState = (): CollectWatchState => ({ schemaVersion: 1, sessions: {} })

const readWatchState = (statePath: string): CollectWatchState => {
  if (!existsSync(statePath)) {
    return emptyWatchState()
  }
  try {
    return watchStateSchema.parse(JSON.parse(readFileSync(statePath, "utf8")))
  } catch {
    // A torn or incompatible state file must not kill the collector; sessions
    // simply reconvert on the next sweep, which is idempotent.
    return emptyWatchState()
  }
}

// Atomic temp+rename so a crash mid-write never leaves a torn state file.
const writeWatchState = (statePath: string, state: CollectWatchState): void => {
  const temporaryPath = `${statePath}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8")
  renameSync(temporaryPath, statePath)
}

const adapterErrorCode = (caught: unknown): string =>
  caught instanceof TrajectoryAdapterError ? caught.code : "conversion_failed"

export const resolveCollectWatchRuntimes = (runtimes: readonly string[] | undefined) => {
  if (runtimes === undefined || runtimes.length === 0) {
    return listHarnessAdapters().map((adapter) => adapter.runtime)
  }
  // Fail fast on unknown runtimes at startup instead of on every sweep.
  for (const runtime of runtimes) {
    getHarnessAdapter(runtime)
  }
  return [...runtimes]
}

// One collector pass: enumerate every runtime's sessions, convert what is new
// or changed and has settled, run the privacy pass, and persist the dedup
// state. Never throws for per-runtime or per-session failures — a resident
// collector must survive missing log directories and torn live sessions.
export const runCollectSweep = async (
  config: CollectSweepConfig,
  privacyOptions?: CollectPrivacyOptions,
  now: Date = new Date(),
): Promise<CollectSweepSummary> => {
  const parsed = collectSweepConfigSchema.parse(config)
  const privacy = resolveCollectPrivacy(privacyOptions)
  const expectedPrivacyHash = privacy.enabled ? privacy.configHash : undefined
  const outDir = resolveWritableProjectPath({
    inputPath: parsed.outDir,
    code: "invalid_export_path",
    throwPathError: throwInvalidOutDir,
  })
  mkdirSync(outDir, { recursive: true })
  const statePath = join(outDir, collectWatchStateFileName)
  const state = readWatchState(statePath)
  const sessions: Record<string, z.infer<typeof watchSessionEntrySchema>> = {
    ...state.sessions,
  }

  let exported = 0
  let failed = 0
  let pendingSettle = 0
  let unchanged = 0
  let privacyFilterUnavailable = false
  const missingSources: string[] = []
  const exportedSessions: CollectSweepExportedSession[] = []
  const failedSessions: CollectSweepFailedSession[] = []

  for (const runtime of parsed.runtimes) {
    if (privacyFilterUnavailable) {
      break
    }
    const adapter = getHarnessAdapter(runtime)
    const sourceDir = parsed.sourceDir ?? adapter.defaultSourceDir()
    if (sourceDir === undefined) {
      missingSources.push(runtime)
      continue
    }
    let refs: ReturnType<typeof adapter.listSessions>
    try {
      refs = adapter.listSessions(sourceDir)
    } catch {
      missingSources.push(runtime)
      continue
    }

    for (const ref of refs) {
      // sessionId is part of the key because store-backed harnesses (e.g.
      // hermes state.db) expose many sessions behind one sessionPath.
      const stateKey = `${runtime}:${ref.sessionPath}:${ref.sessionId}`
      const previous = sessions[stateKey]
      // A privacy-policy change only invalidates entries while the filter is
      // enabled. With --no-privacy-filter, a hash mismatch alone must NOT
      // force a re-export: that would overwrite stamped, masked exports with
      // unfiltered ones.
      if (
        previous !== undefined &&
        previous.modifiedAt === ref.modifiedAt &&
        previous.sizeBytes === ref.sizeBytes &&
        (!privacy.enabled || previous.privacyConfigHash === expectedPrivacyHash)
      ) {
        unchanged += 1
        continue
      }
      const ageSeconds = (now.getTime() - new Date(ref.modifiedAt).getTime()) / 1_000
      if (ageSeconds < parsed.settleSeconds) {
        pendingSettle += 1
        continue
      }

      try {
        const converted = adapter.convertSession({
          sessionPath: ref.sessionPath,
          sessionId: ref.sessionId,
        })
        const { trace } = await applyCollectPrivacy(converted, privacy, now)
        const runtimeDir = join(outDir, runtime)
        mkdirSync(runtimeDir, { recursive: true })
        const exportPath = join(
          runtimeDir,
          `${collectWatchSessionFileName(ref.sessionId)}.atf.json`,
        )
        writeFileSync(exportPath, `${JSON.stringify(trace, null, 2)}\n`, "utf8")
        sessions[stateKey] = {
          modifiedAt: ref.modifiedAt,
          sizeBytes: ref.sizeBytes,
          outcome: "exported",
          exportPath,
          eventCount: trace.eventCount,
          updatedAt: now.toISOString(),
          ...(expectedPrivacyHash === undefined ? {} : { privacyConfigHash: expectedPrivacyHash }),
        }
        exported += 1
        exportedSessions.push({
          runtime,
          sessionId: ref.sessionId,
          sessionPath: ref.sessionPath,
          exportPath,
          eventCount: trace.eventCount,
        })
      } catch (caught: unknown) {
        // Model load/inference infrastructure failure is transient: report it
        // but leave the session's state entry untouched so the next sweep
        // retries instead of permanently skipping unexported (fail-closed)
        // sessions.
        if (caught instanceof PrivacyFilterUnavailableError) {
          failed += 1
          failedSessions.push({
            runtime,
            sessionId: ref.sessionId,
            sessionPath: ref.sessionPath,
            errorCode: "privacy_filter_unavailable",
          })
          // The model will not recover mid-sweep; converting the remaining
          // sessions would only fail the same way. Stop the sweep here — the
          // untouched sessions retry on the next one.
          privacyFilterUnavailable = true
          break
        }
        const errorCode = adapterErrorCode(caught)
        sessions[stateKey] = {
          modifiedAt: ref.modifiedAt,
          sizeBytes: ref.sizeBytes,
          outcome: "failed",
          errorCode,
          updatedAt: now.toISOString(),
          // Recorded on failures too, so a failed session stays skipped under
          // the same policy instead of re-failing every sweep.
          ...(expectedPrivacyHash === undefined ? {} : { privacyConfigHash: expectedPrivacyHash }),
        }
        failed += 1
        failedSessions.push({
          runtime,
          sessionId: ref.sessionId,
          sessionPath: ref.sessionPath,
          errorCode,
        })
      }
    }
  }

  writeWatchState(statePath, { schemaVersion: 1, sessions })
  return {
    sweepAt: now.toISOString(),
    exported,
    failed,
    pendingSettle,
    unchanged,
    missingSources,
    exportedSessions,
    failedSessions,
    ...(privacyFilterUnavailable ? { privacyFilterUnavailable: true } : {}),
  }
}

export type CollectWatchOptions = Readonly<{
  config: CollectSweepConfig
  privacy?: CollectPrivacyOptions
  intervalSeconds: number
  onSweep: (summary: CollectSweepSummary) => void
  onSweepError: (error: Error) => void
  shouldContinue?: () => boolean
}>

const stopCheckIntervalMs = 500

// Sleep in short chunks so a stop signal is honored promptly instead of after
// a full sweep interval — launchd escalates SIGTERM to SIGKILL when an agent
// takes too long to exit.
const interruptibleSleep = async (totalMs: number, shouldContinue: () => boolean) => {
  let remainingMs = totalMs
  while (remainingMs > 0 && shouldContinue()) {
    const chunkMs = Math.min(stopCheckIntervalMs, remainingMs)
    await Bun.sleep(chunkMs)
    remainingMs -= chunkMs
  }
}

// Resident collector loop: sweep, report, sleep, repeat. A sweep failure is
// reported and the loop keeps running; only process signals stop it.
export const runCollectWatchLoop = async (options: CollectWatchOptions): Promise<void> => {
  const shouldContinue = options.shouldContinue ?? (() => true)
  while (shouldContinue()) {
    try {
      options.onSweep(await runCollectSweep(options.config, options.privacy))
    } catch (caught: unknown) {
      options.onSweepError(caught instanceof Error ? caught : new Error(String(caught)))
    }
    if (!shouldContinue()) {
      return
    }
    await interruptibleSleep(options.intervalSeconds * 1_000, shouldContinue)
  }
}
