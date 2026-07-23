import { existsSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"

import { type HarnessSessionRef, TrajectoryAdapterError } from "./contract"

const sessionRefForFile = (sessionPath: string, projectDir?: string): HarnessSessionRef => {
  const stats = statSync(sessionPath)
  return {
    sessionId: basename(sessionPath, ".jsonl"),
    sessionPath,
    modifiedAt: stats.mtime.toISOString(),
    sizeBytes: stats.size,
    ...(projectDir === undefined ? {} : { projectDir }),
  }
}

export const listClaudeCodeSessions = (sourceDir: string): readonly HarnessSessionRef[] => {
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new TrajectoryAdapterError("missing_source_dir", `missing_source_dir: ${sourceDir}`)
  }
  const refs: HarnessSessionRef[] = []
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const entryPath = join(sourceDir, entry.name)
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      refs.push(sessionRefForFile(entryPath))
      continue
    }
    if (!entry.isDirectory()) {
      continue
    }
    for (const candidate of readdirSync(entryPath, { withFileTypes: true })) {
      if (candidate.isFile() && candidate.name.endsWith(".jsonl")) {
        refs.push(sessionRefForFile(join(entryPath, candidate.name), entry.name))
      }
    }
  }
  return refs.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
}

export const claudeCodeDefaultSourceDir = (): string | undefined => {
  const home = homedir()
  return home.length === 0 ? undefined : join(home, ".claude", "projects")
}
