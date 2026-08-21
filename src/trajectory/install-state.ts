import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { z } from "zod";

import { isStableVersion } from "./update-release-contract";

export type { InstallRootClassification } from "./install-state-checkout";
export { classifyInstallRoot } from "./install-state-checkout";
export type { InstallLock } from "./install-state-lock";
export { acquireInstallLock, InstallLockHeldError } from "./install-state-lock";

const absolutePathSchema = z.string().min(1).refine(isAbsolute, "expected an absolute path");

const installServiceConfigSchema = z
  .object({
    // Empty means "all registered runtimes" — resolved by the watch process at
    // sweep time, so adapters added by a later release are collected without a
    // state migration.
    runtimes: z.array(z.string().min(1)),
    sourceDir: absolutePathSchema.optional(),
    intervalSeconds: z.number().int().positive(),
    settleSeconds: z.number().int().nonnegative(),
  })
  .strict();

// Installers prior to the empty-means-all convention snapshotted the full
// adapter registry of their release into install-state.json, silently pinning
// the service to that set forever. A state whose runtime list is exactly one
// of those snapshots (and no custom sourceDir) was never a deliberate
// selection, so it is read back as "all runtimes". In-memory only: the file is
// left untouched so a rolled-back binary can still parse it.
const legacyDefaultRuntimeSnapshots: readonly (readonly string[])[] = [
  ["claude-code", "codex", "hermes", "openclaw", "opencode"],
];

const normalizeServiceRuntimes = (state: InstallState): InstallState => {
  if (state.service.sourceDir !== undefined) return state;
  const sorted = [...state.service.runtimes].sort();
  const isLegacySnapshot = legacyDefaultRuntimeSnapshots.some(
    (snapshot) =>
      snapshot.length === sorted.length &&
      [...snapshot].sort().every((runtime, index) => runtime === sorted[index]),
  );
  if (!isLegacySnapshot) return state;
  return { ...state, service: { ...state.service, runtimes: [] } };
};

export const installStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    installRoot: absolutePathSchema,
    outputDir: absolutePathSchema,
    service: installServiceConfigSchema,
  })
  .strict();

export type InstallServiceConfig = Readonly<{
  runtimes: readonly string[];
  sourceDir?: string | undefined;
  intervalSeconds: number;
  settleSeconds: number;
}>;

export type InstallState = Readonly<{
  schemaVersion: 1;
  installRoot: string;
  outputDir: string;
  service: InstallServiceConfig;
}>;

export type InstallPaths = Readonly<{
  stateRoot: string;
  releasesDir: string;
  releaseDir: string;
  currentPointer: string;
  previousPointer: string;
  stateFile: string;
  lockFile: string;
  outputDir: string;
}>;

export class InstallStateParseError extends Error {
  readonly name = "InstallStateParseError";

  constructor(
    readonly stateFile: string,
    options?: ErrorOptions,
  ) {
    super(`invalid install state: ${stateFile}`, options);
  }
}

export const deriveInstallPaths = (stateRoot: string, version: string): InstallPaths => {
  if (!isStableVersion(version)) {
    throw new InstallStateParseError(join(resolve(stateRoot), "install-state.json"));
  }
  const resolvedRoot = resolve(stateRoot);
  const releasesDir = join(resolvedRoot, "releases");
  return {
    stateRoot: resolvedRoot,
    releasesDir,
    releaseDir: join(releasesDir, version),
    currentPointer: join(resolvedRoot, "current"),
    previousPointer: join(resolvedRoot, "previous"),
    stateFile: join(resolvedRoot, "install-state.json"),
    lockFile: join(resolvedRoot, "update.lock"),
    outputDir: join(resolvedRoot, "collected"),
  };
};

export const readInstallState = (paths: InstallPaths): InstallState => {
  try {
    return normalizeServiceRuntimes(
      installStateSchema.parse(JSON.parse(readFileSync(paths.stateFile, "utf8"))),
    );
  } catch (caught: unknown) {
    throw new InstallStateParseError(paths.stateFile, { cause: caught });
  }
};

export const writeInstallState = (paths: InstallPaths, input: InstallState): void => {
  const state = installStateSchema.parse(input);
  mkdirSync(paths.stateRoot, { recursive: true });
  const temporaryPath = `${paths.stateFile}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    const descriptor = openSync(temporaryPath, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporaryPath, paths.stateFile);
  } finally {
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
  }
};
