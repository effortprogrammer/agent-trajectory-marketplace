import { existsSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"

import { type HarnessAdapter, type HarnessSessionRef, TrajectoryAdapterError } from "../contract"
import { convertPiFamilySession } from "./convert"
import { type PiFamilyRuntime, type PiFamilyVariant, piFamilyVariantByRuntime } from "./variants"

export { detectPiFamilyVariant, type PiFamilyDetection } from "./detect"
export { parsePiSessionFile } from "./session-file"
export { type PiFamilyRuntime, type PiFamilyVariant, piFamilyVariants } from "./variants"

export const resolvePiFamilySessionsDir = (
  variant: PiFamilyVariant,
  home = homedir(),
): string | undefined =>
  home.length === 0 ? undefined : join(home, variant.configDirName, "agent", "sessions")

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

// Sessions live one dir-encoding level below the root (`<dir-encoded>/<file>`
// for oh-my-pi/senpi, `v2-<digest>/<file>` for gajae-code); files at the root
// itself are accepted too for sellers who point --source at a scope dir.
const listPiFamilySessions = (sourceDir: string): readonly HarnessSessionRef[] => {
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

const createPiFamilyAdapter = (variant: PiFamilyVariant): HarnessAdapter => ({
  runtime: variant.runtime,
  displayName: variant.displayName,
  logHint: variant.logHint,
  defaultSourceDir: () => resolvePiFamilySessionsDir(variant),
  listSessions: listPiFamilySessions,
  convertSession: (session) => convertPiFamilySession(variant, session),
})

const variantForRuntime = (runtime: PiFamilyRuntime): PiFamilyVariant => {
  const variant = piFamilyVariantByRuntime.get(runtime)
  if (variant === undefined) {
    throw new Error(`unknown pi-family runtime: ${runtime}`)
  }
  return variant
}

export const ohMyPiAdapter = createPiFamilyAdapter(variantForRuntime("oh-my-pi"))
export const senpiAdapter = createPiFamilyAdapter(variantForRuntime("senpi"))
export const gajaeCodeAdapter = createPiFamilyAdapter(variantForRuntime("gajae-code"))
