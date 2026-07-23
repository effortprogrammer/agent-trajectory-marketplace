import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

import { type HarnessSessionRef, TrajectoryAdapterError } from "../contract";

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
    if (!entry.isFile() || !entry.name.endsWith(".jsonl") || entry.name.endsWith(".trajectory.jsonl")) {
      continue;
    }
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

export const listOpenclawSessions = (sourceDir: string): readonly HarnessSessionRef[] => {
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new TrajectoryAdapterError("missing_source_dir", `missing_source_dir: ${sourceDir}`);
  }
  const refs: HarnessSessionRef[] = [];
  collectSessionFiles(sourceDir, sourceDir, refs);
  return refs.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
};
