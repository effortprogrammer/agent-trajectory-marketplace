import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative } from "node:path";

import { type HarnessAdapter, type HarnessSessionRef, TrajectoryAdapterError } from "./contract";
import { convertPiFamilySession } from "./pi-family/convert";
import { type PiFamilyVariant, piFamilyVariants } from "./pi-family/variants";

export { detectPiFamilyVariant, type PiFamilyDetection } from "./pi-family/detect";
export { parsePiSessionFile } from "./pi-family/parse";
export { type PiFamilyRuntime, type PiFamilyVariant, piFamilyVariants } from "./pi-family/variants";

export const piFamilySessionsDir = (
  variant: PiFamilyVariant,
  home = homedir(),
): string | undefined =>
  home.length === 0 ? undefined : join(home, variant.configDirName, "agent", "sessions");

// Sessions live one dir-encoding level below the root (`<dir-encoded>/<file>`
// for oh-my-pi/senpi, `v2-<digest>/<file>` for gajae-code); the scan is
// recursive so sellers can also point --source at a single scope dir.
const collectSessionFiles = (
  rootDir: string,
  currentDir: string,
  refs: HarnessSessionRef[],
): void => {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const entryPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      collectSessionFiles(rootDir, entryPath, refs);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const stats = statSync(entryPath);
    const projectDir = relative(rootDir, join(entryPath, ".."));
    refs.push({
      sessionId: basename(entryPath, ".jsonl"),
      sessionPath: entryPath,
      modifiedAt: stats.mtime.toISOString(),
      sizeBytes: stats.size,
      ...(projectDir === "" || projectDir === "." ? {} : { projectDir }),
    });
  }
};

const listPiFamilySessions = (sourceDir: string): readonly HarnessSessionRef[] => {
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new TrajectoryAdapterError("missing_source_dir", `missing_source_dir: ${sourceDir}`);
  }
  const refs: HarnessSessionRef[] = [];
  collectSessionFiles(sourceDir, sourceDir, refs);
  return refs.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
};

const createPiFamilyAdapter = (variant: PiFamilyVariant): HarnessAdapter => ({
  runtime: variant.runtime,
  displayName: variant.displayName,
  logHint: variant.logHint,
  defaultSourceDir: () => piFamilySessionsDir(variant),
  listSessions: listPiFamilySessions,
  convertSession: (session) => convertPiFamilySession(variant, session),
});

const adapterFor = (runtime: PiFamilyVariant["runtime"]): HarnessAdapter => {
  const variant = piFamilyVariants.find((candidate) => candidate.runtime === runtime);
  if (variant === undefined) throw new Error(`unknown pi-family runtime: ${runtime}`);
  return createPiFamilyAdapter(variant);
};

export const ohMyPiAdapter = adapterFor("oh-my-pi");
export const senpiAdapter = adapterFor("senpi");
export const gajaeCodeAdapter = adapterFor("gajae-code");
export const piAdapter = adapterFor("pi");
