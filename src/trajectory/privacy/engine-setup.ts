import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { defaultPrivacyEngineUrl, probePrivacyEngine } from "./engine-client"

// Best-effort bootstrap of the resident MLX inference engine, run as part of
// first-time CLI setup (collect service install) and standalone via
// `trajectory privacy engine setup`. Every failure is a *skip with a reason*,
// never an error: collect auto-detects the engine per trace and falls back to
// the in-process CPU runner, so a machine that cannot host the engine
// (non-macOS, no uv, no access to the private repo) still collects.

export const privacyEngineRepoEnv = "TRAJECTORY_PRIVACY_ENGINE_REPO"
export const privacyEngineDirEnv = "TRAJECTORY_PRIVACY_ENGINE_DIR"

const defaultEngineRepo = "https://github.com/effortprogrammer/privacy-filter-engine.git"
const defaultEngineDir = () =>
  join(homedir(), ".agent-trajectory-marketplace", "privacy-filter-engine")
const enginePlistPath = () =>
  join(homedir(), "Library", "LaunchAgents", "com.privacy-filter-engine.plist")

export type EngineSetupResult = Readonly<{
  status: "already_running" | "running" | "pending" | "skipped"
  detail: string
  url: string
  engineDir?: string
}>

type RunResult = Readonly<{ success: boolean; output: string }>

export type EngineSetupDeps = Readonly<{
  run: (command: string, args: readonly string[], cwd?: string) => RunResult
  probe: (url: string) => Promise<boolean>
  platform: string
  fileExists: (path: string) => boolean
  readFile: (path: string) => string
  sleep: (ms: number) => Promise<void>
}>

const realDeps: EngineSetupDeps = {
  run: (command, args, cwd) => {
    const result = spawnSync(command, [...args], {
      encoding: "utf8",
      ...(cwd === undefined ? {} : { cwd }),
    })
    return {
      success: result.status === 0,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
    }
  },
  probe: (url) => probePrivacyEngine(url),
  platform: process.platform,
  fileExists: existsSync,
  readFile: (path) => readFileSync(path, "utf8"),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

// An engine installed earlier records its repo location in the LaunchAgent's
// WorkingDirectory; reuse it instead of cloning a second copy.
const engineDirFromPlist = (deps: EngineSetupDeps): string | undefined => {
  if (!deps.fileExists(enginePlistPath())) {
    return undefined
  }
  const match = /<key>WorkingDirectory<\/key>\s*<string>([^<]+)<\/string>/.exec(
    deps.readFile(enginePlistPath()),
  )
  return match?.[1]
}

export type EngineSetupInput = Readonly<{
  engineDir?: string
  repoUrl?: string
  port?: number
  // How long to wait for /health after install (first boot may also download
  // the ~2.8GB model, which can exceed any sane wait; we report "pending").
  healthWaitMs?: number
}>

export const setupPrivacyEngine = async (
  input: EngineSetupInput = {},
  deps: EngineSetupDeps = realDeps,
): Promise<EngineSetupResult> => {
  const url = defaultPrivacyEngineUrl
  if (await deps.probe(url)) {
    return { status: "already_running", detail: `engine already healthy at ${url}`, url }
  }
  if (deps.platform !== "darwin") {
    return {
      status: "skipped",
      detail: "engine requires macOS (launchd + MLX); collect will use the CPU runner",
      url,
    }
  }
  if (!deps.run("uv", ["--version"]).success) {
    return {
      status: "skipped",
      detail:
        "uv not found; install uv (https://docs.astral.sh/uv/) and re-run `trajectory privacy engine setup`",
      url,
    }
  }

  const engineDir =
    input.engineDir ??
    process.env[privacyEngineDirEnv] ??
    engineDirFromPlist(deps) ??
    defaultEngineDir()
  if (!deps.fileExists(engineDir)) {
    const repoUrl = input.repoUrl ?? process.env[privacyEngineRepoEnv] ?? defaultEngineRepo
    const cloned = deps.run("git", ["clone", "--depth", "1", repoUrl, engineDir])
    if (!cloned.success) {
      return {
        status: "skipped",
        detail: `could not clone ${repoUrl} (private repo — needs git access); collect will use the CPU runner`,
        url,
        engineDir,
      }
    }
  }

  const synced = deps.run("uv", ["sync"], engineDir)
  if (!synced.success) {
    return {
      status: "skipped",
      detail: `uv sync failed in ${engineDir}: ${synced.output.slice(0, 200)}`,
      url,
      engineDir,
    }
  }
  const installed = deps.run(
    "uv",
    ["run", "engine-service", "install", "--port", String(input.port ?? 8787)],
    engineDir,
  )
  if (!installed.success) {
    return {
      status: "skipped",
      detail: `engine-service install failed: ${installed.output.slice(0, 200)}`,
      url,
      engineDir,
    }
  }

  const waitMs = input.healthWaitMs ?? 60_000
  const pollMs = 3_000
  for (let waited = 0; waited < waitMs; waited += pollMs) {
    if (await deps.probe(url)) {
      return { status: "running", detail: `engine healthy at ${url}`, url, engineDir }
    }
    await deps.sleep(pollMs)
  }
  return {
    status: "pending",
    detail:
      "engine installed; still starting (first boot downloads the ~2.8GB model) — check `uv run engine-service status`",
    url,
    engineDir,
  }
}
