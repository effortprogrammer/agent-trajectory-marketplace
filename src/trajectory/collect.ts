import { existsSync, lstatSync, mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { z } from "zod";

import {
  type HarnessSessionInput,
  type HarnessSessionRef,
  type HarnessTraceDocument,
  TrajectoryAdapterError,
} from "./adapters/contract";
import { getHarnessAdapter, listHarnessAdapters } from "./adapters/registry";

const listSessionsInputSchema = z.object({
  runtime: z.string().min(1),
  sourceDir: z.string().min(1).optional(),
  limit: z.number().int().positive().max(500).optional(),
});

const exportInputSchema = z.object({
  runtime: z.string().min(1),
  session: z.string().min(1),
  sourceDir: z.string().min(1).optional(),
  outputRoot: z.string().min(1).optional(),
  exportPath: z.string().min(1),
});

export type CollectRuntimeSummary = Readonly<{
  runtime: string;
  displayName: string;
  logHint: string;
  defaultSourceDir?: string;
}>;

export type CollectSessionsResult = Readonly<{
  runtime: string;
  sourceDir: string;
  sessionCount: number;
  sessions: readonly HarnessSessionRef[];
}>;

export type CollectExportResult = Readonly<{
  runtime: string;
  status: HarnessTraceDocument["status"];
  sessionPath: string;
  exportPath: string;
  eventCount: number;
  eventKinds: readonly string[];
}>;

const invalidExportPath = (path: string): never => {
  throw new TrajectoryAdapterError("invalid_export_path", `invalid_export_path: ${path}`);
};

const isInside = (root: string, candidate: string): boolean => {
  const pathRelativeToRoot = relative(root, candidate);
  return pathRelativeToRoot.length === 0 || (!pathRelativeToRoot.startsWith("..") && !isAbsolute(pathRelativeToRoot));
};

const nearestExistingAncestor = (path: string): string => {
  let ancestor = dirname(path);
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) return invalidExportPath(path);
    ancestor = parent;
  }
  return ancestor;
};

const resolveExportPath = (exportPath: string, outputRoot: string | undefined): string => {
  if (exportPath.includes("\0")) return invalidExportPath(exportPath);
  if (outputRoot === undefined) {
    if (!isAbsolute(exportPath)) return invalidExportPath(exportPath);
    return resolve(exportPath);
  }
  const canonicalRoot = realpathSync(outputRoot);
  const candidate = resolve(canonicalRoot, exportPath);
  if (!isInside(canonicalRoot, candidate)) return invalidExportPath(exportPath);
  const canonicalAncestor = realpathSync(nearestExistingAncestor(candidate));
  if (!isInside(canonicalRoot, canonicalAncestor)) return invalidExportPath(exportPath);
  return candidate;
};

const rejectExistingSymlink = (path: string): void => {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) invalidExportPath(path);
};

const resolveSourceDir = (runtime: string, sourceDir: string | undefined): Readonly<{
  sourceDir: string;
  usesDefault: boolean;
}> => {
  if (sourceDir !== undefined) return { sourceDir, usesDefault: false };
  const defaultSourceDir = getHarnessAdapter(runtime).defaultSourceDir();
  if (defaultSourceDir === undefined) {
    throw new TrajectoryAdapterError("missing_source_dir", `missing_source_dir: pass --source for runtime ${runtime}`);
  }
  return { sourceDir: defaultSourceDir, usesDefault: true };
};

const discoverSessions = (
  runtime: string,
  sourceDir: string | undefined,
): Readonly<{ sessions: readonly HarnessSessionRef[]; sourceDir: string }> => {
  const adapter = getHarnessAdapter(runtime);
  const resolvedSource = resolveSourceDir(runtime, sourceDir);
  if (resolvedSource.usesDefault && !existsSync(resolvedSource.sourceDir)) {
    return { sessions: [], sourceDir: resolvedSource.sourceDir };
  }
  const sessions = [...adapter.listSessions(resolvedSource.sourceDir)].sort(
    (left, right) =>
      right.modifiedAt.localeCompare(left.modifiedAt) || left.sessionPath.localeCompare(right.sessionPath),
  );
  return { sessions, sourceDir: resolvedSource.sourceDir };
};

const resolveSessionInput = (input: Readonly<{
  runtime: string;
  session: string;
  sourceDir?: string;
}>): HarnessSessionInput => {
  if (existsSync(input.session) && statSync(input.session).isFile()) {
    return { sessionPath: resolve(input.session) };
  }
  const discovery = discoverSessions(input.runtime, input.sourceDir);
  const selected = discovery.sessions.find((candidate) => candidate.sessionId === input.session);
  if (selected === undefined) {
    throw new TrajectoryAdapterError(
      "missing_session",
      `missing_session: ${input.session} is neither a session file nor a session id under ${discovery.sourceDir}`,
    );
  }
  return { sessionId: selected.sessionId, sessionPath: selected.sessionPath };
};

export const listCollectRuntimes = (): readonly CollectRuntimeSummary[] =>
  listHarnessAdapters().map((adapter) => {
    const defaultSourceDir = adapter.defaultSourceDir();
    return {
      displayName: adapter.displayName,
      logHint: adapter.logHint,
      runtime: adapter.runtime,
      ...(defaultSourceDir === undefined ? {} : { defaultSourceDir }),
    };
  });

export const listCollectSessions = (input: Readonly<{
  runtime: string;
  sourceDir?: string;
  limit?: number;
}>): CollectSessionsResult => {
  const parsed = listSessionsInputSchema.parse(input);
  const discovery = discoverSessions(parsed.runtime, parsed.sourceDir);
  return {
    runtime: parsed.runtime,
    sourceDir: discovery.sourceDir,
    sessionCount: discovery.sessions.length,
    sessions: discovery.sessions.slice(0, parsed.limit ?? 20),
  };
};

export const exportCollectedSession = (input: Readonly<{
  runtime: string;
  session: string;
  sourceDir?: string;
  outputRoot?: string;
  exportPath: string;
}>): CollectExportResult => {
  const parsed = exportInputSchema.parse(input);
  const adapter = getHarnessAdapter(parsed.runtime);
  const session = resolveSessionInput({
    runtime: parsed.runtime,
    session: parsed.session,
    ...(parsed.sourceDir === undefined ? {} : { sourceDir: parsed.sourceDir }),
  });
  const trace = adapter.convertSession(session);
  const exportPath = resolveExportPath(parsed.exportPath, parsed.outputRoot);
  rejectExistingSymlink(exportPath);
  mkdirSync(dirname(exportPath), { recursive: true });
  writeFileSync(exportPath, `${JSON.stringify(trace, null, 2)}\n`, "utf8");
  return {
    eventCount: trace.eventCount,
    eventKinds: [...new Set(trace.events.map((event) => event.kind))].sort(),
    exportPath,
    runtime: trace.runtime,
    sessionPath: session.sessionPath,
    status: trace.status,
  };
};
