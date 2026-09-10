import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { z } from "zod";

import { TrajectoryAdapterError } from "./adapters/contract";
import { getHarnessAdapter, listHarnessAdapters } from "./adapters/registry";
import {
  assertSafeOutputPath,
  collectWatchSessionFileName,
  rejectExistingSymlinkPathBelow,
  removeManagedOutputAfterConversionFailure,
} from "./collect-output-safety";

export { collectWatchSessionFileName } from "./collect-output-safety";

export const collectWatchStateFileName = "collect-watch-state.json";

const outputNameVersion = 1;
const codexConversionVersion = 2;
const watchEntrySchema = z.object({
  conversionVersion: z.number().int().positive().optional(),
  errorCode: z.string().optional(),
  eventCount: z.number().int().nonnegative().optional(),
  exportPath: z.string().optional(),
  modifiedAt: z.string().min(1),
  outcome: z.enum(["exported", "failed"]),
  outputNameVersion: z.literal(outputNameVersion),
  sizeBytes: z.number().int().nonnegative(),
  updatedAt: z.string().min(1),
}).strict();

const watchStateSchema = z.object({
  schemaVersion: z.literal(1),
  sessions: z.record(z.string(), watchEntrySchema),
}).strict();

type WatchEntry = z.infer<typeof watchEntrySchema>;
type WatchState = z.infer<typeof watchStateSchema>;

const collectSweepConfigSchema = z.object({
  declareRuntime: z.literal("pi").optional(),
  outDir: z.string().min(1),
  runtimes: z.array(z.string().min(1)),
  settleSeconds: z.number().int().nonnegative(),
  sourceDir: z.string().min(1).optional(),
}).strict().refine(
  ({ runtimes, sourceDir }) => sourceDir === undefined || runtimes.length === 1,
  { message: "source_requires_single_runtime", path: ["sourceDir"] },
);

export type CollectSweepConfig = Readonly<{
  declareRuntime?: "pi";
  outDir: string;
  runtimes?: readonly string[];
  settleSeconds: number;
  sourceDir?: string;
}>;

export type CollectSweepExportedSession = Readonly<{
  eventCount: number;
  exportPath: string;
  runtime: string;
  sessionId: string;
  sessionPath: string;
}>;

export type CollectSweepFailedSession = Readonly<{
  errorCode: string;
  runtime: string;
  sessionId: string;
  sessionPath: string;
}>;

export type CollectSweepSummary = Readonly<{
  exported: number;
  exportedSessions: readonly CollectSweepExportedSession[];
  failed: number;
  failedSessions: readonly CollectSweepFailedSession[];
  missingSources: readonly string[];
  pendingSettle: number;
  runtimes: readonly string[];
  sweepAt: string;
  unchanged: number;
}>;

export class CollectWatchError extends Error {
  readonly code = "collect_watch_failed";

  constructor() {
    super("collect_watch_failed");
    this.name = "CollectWatchError";
  }
}

const emptyState = (): WatchState => ({ schemaVersion: 1, sessions: {} });

const readState = (statePath: string): WatchState => {
  if (!existsSync(statePath)) return emptyState();
  try {
    return watchStateSchema.parse(JSON.parse(readFileSync(statePath, "utf8")));
  } catch {
    return emptyState();
  }
};

const writeState = (statePath: string, state: WatchState): void => {
  const temporaryPath = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(temporaryPath, statePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
};

export const resolveCollectWatchRuntimes = (runtimes: readonly string[] | undefined): readonly string[] => {
  const requested = runtimes === undefined || runtimes.length === 0
    ? listHarnessAdapters().map(({ runtime }) => runtime)
    : [...new Set(runtimes)];
  for (const runtime of requested) getHarnessAdapter(runtime);
  return requested;
};

export const runCollectSweep = (
  config: CollectSweepConfig,
  now: Date = new Date(),
  sourceDirs: Readonly<Record<string, string>> = {},
): CollectSweepSummary => {
  const runtimes = resolveCollectWatchRuntimes(config.runtimes);
  const parsed = collectSweepConfigSchema.parse({ ...config, runtimes });
  const configuredOutDir = resolve(parsed.outDir);
  mkdirSync(configuredOutDir, { recursive: true });
  const outDir = realpathSync(configuredOutDir);
  const statePath = join(outDir, collectWatchStateFileName);
  const sessions: Record<string, WatchEntry> = { ...readState(statePath).sessions };
  const exportedSessions: CollectSweepExportedSession[] = [];
  const failedSessions: CollectSweepFailedSession[] = [];
  const missingSources: string[] = [];
  let pendingSettle = 0;
  let unchanged = 0;

  for (const runtime of parsed.runtimes) {
    const adapter = getHarnessAdapter(runtime);
    const sourceDir = sourceDirs[runtime] ?? parsed.sourceDir ?? adapter.defaultSourceDir();
    if (sourceDir === undefined) {
      missingSources.push(runtime);
      continue;
    }
    let refs: ReturnType<typeof adapter.listSessions>;
    try {
      refs = adapter.listSessions(sourceDir);
    } catch {
      missingSources.push(runtime);
      continue;
    }
    for (const ref of refs) {
      const stateKey = `${runtime}:${ref.sessionPath}:${ref.sessionId}`;
      const previous = sessions[stateKey];
      if (
        previous?.outcome === "exported" && previous.modifiedAt === ref.modifiedAt
        && previous.sizeBytes === ref.sizeBytes
        && previous.outputNameVersion === outputNameVersion
        && (runtime !== "codex" || previous.conversionVersion === codexConversionVersion)
      ) {
        unchanged += 1;
        continue;
      }
      if ((now.getTime() - new Date(ref.modifiedAt).getTime()) / 1_000 < parsed.settleSeconds) {
        pendingSettle += 1;
        continue;
      }
      const runtimeDir = join(outDir, runtime);
      const exportPath = join(
        runtimeDir,
        `${collectWatchSessionFileName(runtime, ref.sessionPath, ref.sessionId)}.atf.json`,
      );
      let converted = false;
      try {
        const trace = adapter.convertSession({
          sessionId: ref.sessionId,
          sessionPath: ref.sessionPath,
          ...(runtime === "pi" && parsed.declareRuntime === "pi"
            ? { runtimeAttribution: "operator_declared" as const }
            : {}),
        });
        converted = true;
        rejectExistingSymlinkPathBelow(outDir, exportPath);
        assertSafeOutputPath(ref.sessionPath, exportPath);
        mkdirSync(runtimeDir, { recursive: true });
        writeFileSync(exportPath, `${JSON.stringify(trace, null, 2)}\n`, "utf8");
        sessions[stateKey] = {
          ...(runtime === "codex" ? { conversionVersion: codexConversionVersion } : {}),
          eventCount: trace.eventCount,
          exportPath,
          modifiedAt: ref.modifiedAt,
          outcome: "exported",
          outputNameVersion,
          sizeBytes: ref.sizeBytes,
          updatedAt: now.toISOString(),
        };
        exportedSessions.push({
          eventCount: trace.eventCount,
          exportPath,
          runtime,
          sessionId: ref.sessionId,
          sessionPath: ref.sessionPath,
        });
      } catch (error: unknown) {
        if (!converted) removeManagedOutputAfterConversionFailure(ref.sessionPath, outDir, exportPath);
        const code = error instanceof TrajectoryAdapterError ? error.code : "conversion_failed";
        sessions[stateKey] = {
          ...(runtime === "codex" ? { conversionVersion: codexConversionVersion } : {}),
          errorCode: code,
          modifiedAt: ref.modifiedAt,
          outcome: "failed",
          outputNameVersion,
          sizeBytes: ref.sizeBytes,
          updatedAt: now.toISOString(),
        };
        failedSessions.push({ errorCode: code, runtime, sessionId: ref.sessionId, sessionPath: ref.sessionPath });
      }
    }
  }

  writeState(statePath, { schemaVersion: 1, sessions });
  return {
    exported: exportedSessions.length,
    exportedSessions,
    failed: failedSessions.length,
    failedSessions,
    missingSources,
    pendingSettle,
    runtimes: parsed.runtimes,
    sweepAt: now.toISOString(),
    unchanged,
  };
};

export type CollectWatchLoopOptions = Readonly<{
  config: CollectSweepConfig;
  intervalSeconds: number;
  onSweep: (summary: CollectSweepSummary) => void;
  onSweepError?: (error: Error) => void;
  shouldContinue?: () => boolean;
  sleep?: (milliseconds: number) => Promise<void>;
}>;

export const runCollectWatchLoop = async (options: CollectWatchLoopOptions): Promise<void> => {
  const shouldContinue = options.shouldContinue ?? (() => true);
  const sleep = options.sleep ?? Bun.sleep;
  while (shouldContinue()) {
    try {
      options.onSweep(runCollectSweep(options.config));
    } catch {
      const watchError = new CollectWatchError();
      options.onSweepError?.(watchError);
      throw watchError;
    }
    let remainingMilliseconds = options.intervalSeconds * 1_000;
    while (remainingMilliseconds > 0 && shouldContinue()) {
      const chunkMilliseconds = Math.min(500, remainingMilliseconds);
      await sleep(chunkMilliseconds);
      remainingMilliseconds -= chunkMilliseconds;
    }
  }
};
