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

export type { InstallRootClassification } from "./install-state-checkout";
export { classifyInstallRoot } from "./install-state-checkout";
export type { InstallLock } from "./install-state-lock";
export { acquireInstallLock, InstallLockHeldError } from "./install-state-lock";

const STABLE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

const absolutePathSchema = z.string().min(1).refine(isAbsolute, "expected an absolute path");

const installServiceConfigSchema = z
  .object({
    runtimes: z.array(z.string().min(1)).min(1),
    sourceDir: absolutePathSchema.optional(),
    intervalSeconds: z.number().int().positive(),
    settleSeconds: z.number().int().nonnegative(),
  })
  .strict();

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
  if (!STABLE_VERSION_PATTERN.test(version)) {
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
    return installStateSchema.parse(JSON.parse(readFileSync(paths.stateFile, "utf8")));
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
