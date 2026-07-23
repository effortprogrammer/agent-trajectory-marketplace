import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { z } from "zod";

import { TrajectoryAdapterError } from "./adapters/contract";
import { getHarnessAdapter, listHarnessAdapters } from "./adapters/registry";

export const collectWatchStateFileName = "collect-watch-state.json";

const outputNameVersion = 1;
const watchEntrySchema = z.object({
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
  outDir: z.string().min(1),
  runtimes: z.array(z.string().min(1)),
  settleSeconds: z.number().int().nonnegative(),
  sourceDir: z.string().min(1).optional(),
}).strict().refine(
  ({ runtimes, sourceDir }) => sourceDir === undefined || runtimes.length === 1,
  { message: "source_requires_single_runtime", path: ["sourceDir"] },
);

export type CollectSweepConfig = Readonly<{
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

const rejectExistingSymlink = (path: string): void => {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new TrajectoryAdapterError("invalid_export_path", `invalid_export_path: ${path}`);
  }
};

export const resolveCollectWatchRuntimes = (runtimes: readonly string[] | undefined): readonly string[] => {
  const requested = runtimes === undefined || runtimes.length === 0
    ? listHarnessAdapters().map(({ runtime }) => runtime)
    : [...new Set(runtimes)];
  for (const runtime of requested) getHarnessAdapter(runtime);
  return requested;
};

export const collectWatchSessionFileName = (
  runtime: string,
  sessionPath: string,
  sessionId: string,
): string => {
  const readable = encodeURIComponent(sessionId).replaceAll("%", "_").slice(0, 80) || "session";
  const digest = createHash("sha256")
    .update(runtime)
    .update("\0")
    .update(sessionPath)
    .update("\0")
    .update(sessionId)
    .digest("hex")
    .slice(0, 16);
  return `${readable}--${digest}`;
};

export const runCollectSweep = (
  config: CollectSweepConfig,
  now: Date = new Date(),
  sourceDirs: Readonly<Record<string, string>> = {},
): CollectSweepSummary => {
  const runtimes = resolveCollectWatchRuntimes(config.runtimes);
  const parsed = collectSweepConfigSchema.parse({ ...config, runtimes });
  const outDir = resolve(parsed.outDir);
  mkdirSync(outDir, { recursive: true });
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
        previous?.modifiedAt === ref.modifiedAt
        && previous.sizeBytes === ref.sizeBytes
        && previous.outputNameVersion === outputNameVersion
      ) {
        unchanged += 1;
        continue;
      }
      if ((now.getTime() - new Date(ref.modifiedAt).getTime()) / 1_000 < parsed.settleSeconds) {
        pendingSettle += 1;
        continue;
      }
      try {
        const trace = adapter.convertSession({ sessionId: ref.sessionId, sessionPath: ref.sessionPath });
        const runtimeDir = join(outDir, runtime);
        const exportPath = join(
          runtimeDir,
          `${collectWatchSessionFileName(runtime, ref.sessionPath, ref.sessionId)}.atf.json`,
        );
        rejectExistingSymlink(runtimeDir);
        rejectExistingSymlink(exportPath);
        mkdirSync(runtimeDir, { recursive: true });
        writeFileSync(exportPath, `${JSON.stringify(trace, null, 2)}\n`, "utf8");
        sessions[stateKey] = {
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
        const code = error instanceof TrajectoryAdapterError ? error.code : "conversion_failed";
        sessions[stateKey] = {
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
