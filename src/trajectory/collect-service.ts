import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

import { z } from "zod"

import { TrajectoryAdapterError } from "./adapters/contract"
import { privacyThresholdSchema } from "./privacy/contract"

export const collectServiceLabel = "com.agent-trajectory-marketplace.collect-watch"

const collectServiceConfigSchema = z.object({
  outDir: z.string().min(1),
  runtimes: z.array(z.string().min(1)).min(1),
  sourceDir: z.string().min(1).optional(),
  intervalSeconds: z.number().int().positive(),
  settleSeconds: z.number().int().nonnegative(),
  // Default true: the resident collector runs the ML privacy pass. false
  // renders --no-privacy-filter into the launchd argv.
  privacyFilter: z.boolean().default(true),
  privacyThreshold: privacyThresholdSchema.optional(),
})

// z.input keeps privacyFilter optional for callers; the schema default (true)
// applies when the plist is rendered.
export type CollectServiceConfig = z.input<typeof collectServiceConfigSchema>

export type CollectServicePaths = Readonly<{
  label: string
  plistPath: string
  stdoutLogPath: string
  stderrLogPath: string
}>

const xmlEscape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")

const assertDarwin = () => {
  if (process.platform !== "darwin") {
    throw new TrajectoryAdapterError(
      "service_unsupported_platform",
      "service_unsupported_platform: collect service management requires macOS launchd",
    )
  }
}

export const collectServicePaths = (home: string = homedir()): CollectServicePaths => ({
  label: collectServiceLabel,
  plistPath: join(home, "Library", "LaunchAgents", `${collectServiceLabel}.plist`),
  stdoutLogPath: join(home, "Library", "Logs", `${collectServiceLabel}.out.log`),
  stderrLogPath: join(home, "Library", "Logs", `${collectServiceLabel}.err.log`),
})

// LaunchAgent plist: RunAtLoad starts the collector at login and KeepAlive
// restarts it whenever the process dies, matching the "keeps collecting
// unless explicitly uninstalled" requirement.
export const renderCollectWatchPlist = (input: {
  readonly config: CollectServiceConfig
  readonly executablePath: string
  readonly entryScriptPath: string
  readonly workingDirectory: string
  readonly paths: CollectServicePaths
}): string => {
  const config = collectServiceConfigSchema.parse(input.config)
  const workingDirectory = resolve(input.workingDirectory)
  const collectArguments = [
    input.executablePath,
    input.entryScriptPath,
    "trajectory",
    "collect",
    "watch",
    "--out",
    resolve(workingDirectory, config.outDir),
    "--runtime",
    ...config.runtimes,
    ...(config.sourceDir === undefined ? [] : ["--source", resolve(config.sourceDir)]),
    "--interval-seconds",
    String(config.intervalSeconds),
    "--settle-seconds",
    String(config.settleSeconds),
    ...(config.privacyFilter ? [] : ["--no-privacy-filter"]),
    ...(config.privacyThreshold === undefined
      ? []
      : ["--privacy-threshold", String(config.privacyThreshold)]),
  ]
  const argumentLines = collectArguments
    .map((argument) => `      <string>${xmlEscape(argument)}</string>`)
    .join("\n")
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "  <dict>",
    "    <key>Label</key>",
    `    <string>${xmlEscape(input.paths.label)}</string>`,
    "    <key>ProgramArguments</key>",
    "    <array>",
    argumentLines,
    "    </array>",
    "    <key>WorkingDirectory</key>",
    `    <string>${xmlEscape(workingDirectory)}</string>`,
    "    <key>RunAtLoad</key>",
    "    <true/>",
    "    <key>KeepAlive</key>",
    "    <true/>",
    "    <key>ProcessType</key>",
    "    <string>Background</string>",
    "    <key>StandardOutPath</key>",
    `    <string>${xmlEscape(input.paths.stdoutLogPath)}</string>`,
    "    <key>StandardErrorPath</key>",
    `    <string>${xmlEscape(input.paths.stderrLogPath)}</string>`,
    "  </dict>",
    "</plist>",
    "",
  ].join("\n")
}

const launchctl = (args: readonly string[]) => {
  const result = spawnSync("launchctl", [...args], { encoding: "utf8" })
  return {
    success: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

const launchdDomain = () => `gui/${process.getuid?.() ?? 501}`

export type CollectServiceInstallResult = Readonly<{
  label: string
  plistPath: string
  stdoutLogPath: string
  stderrLogPath: string
  bootstrapped: boolean
  detail: string
}>

export const installCollectWatchService = (input: {
  readonly config: CollectServiceConfig
  readonly dryRun?: boolean
}): CollectServiceInstallResult & { readonly plist: string } => {
  const paths = collectServicePaths()
  const plist = renderCollectWatchPlist({
    config: input.config,
    executablePath: process.execPath,
    entryScriptPath: resolve(process.argv[1] ?? "src/cli/index.ts"),
    workingDirectory: process.cwd(),
    paths,
  })
  if (input.dryRun === true) {
    return {
      ...paths,
      bootstrapped: false,
      detail: "dry_run: plist rendered without touching launchd",
      plist,
    }
  }
  assertDarwin()
  mkdirSync(join(paths.plistPath, ".."), { recursive: true })
  mkdirSync(join(paths.stdoutLogPath, ".."), { recursive: true })
  writeFileSync(paths.plistPath, plist, "utf8")
  // Re-installing over a loaded agent requires booting the old one out first;
  // a failed bootout just means nothing was loaded yet. launchd tears
  // KeepAlive agents down asynchronously, so wait until the label is gone
  // before bootstrapping, and retry the bootstrap through the transient
  // EIO window.
  launchctl(["bootout", `${launchdDomain()}/${paths.label}`])
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!launchctl(["print", `${launchdDomain()}/${paths.label}`]).success) {
      break
    }
    Bun.sleepSync(250)
  }
  let bootstrap = launchctl(["bootstrap", launchdDomain(), paths.plistPath])
  for (let attempt = 0; attempt < 3 && !bootstrap.success; attempt += 1) {
    Bun.sleepSync(500)
    bootstrap = launchctl(["bootstrap", launchdDomain(), paths.plistPath])
  }
  if (!bootstrap.success) {
    throw new TrajectoryAdapterError(
      "service_bootstrap_failed",
      `service_bootstrap_failed: ${bootstrap.stderr.trim() || bootstrap.stdout.trim()}`,
    )
  }
  return {
    ...paths,
    bootstrapped: true,
    detail: `launchctl bootstrap ${launchdDomain()} succeeded`,
    plist,
  }
}

export const uninstallCollectWatchService = (): Readonly<{
  label: string
  plistPath: string
  removed: boolean
  detail: string
}> => {
  assertDarwin()
  const paths = collectServicePaths()
  const bootout = launchctl(["bootout", `${launchdDomain()}/${paths.label}`])
  const existed = existsSync(paths.plistPath)
  rmSync(paths.plistPath, { force: true })
  return {
    label: paths.label,
    plistPath: paths.plistPath,
    removed: existed,
    detail: bootout.success
      ? "launchctl bootout succeeded"
      : "launch agent was not loaded; plist removed if present",
  }
}

export const collectWatchServiceStatus = (): Readonly<{
  label: string
  plistPath: string
  installed: boolean
  loaded: boolean
  pid?: number
  detail: string
}> => {
  assertDarwin()
  const paths = collectServicePaths()
  const installed = existsSync(paths.plistPath)
  const print = launchctl(["print", `${launchdDomain()}/${paths.label}`])
  if (!print.success) {
    return {
      label: paths.label,
      plistPath: paths.plistPath,
      installed,
      loaded: false,
      detail: installed
        ? "plist installed but agent is not loaded"
        : "collect watch service is not installed",
    }
  }
  const pidMatch = /pid = (\d+)/.exec(print.stdout)
  return {
    label: paths.label,
    plistPath: paths.plistPath,
    installed,
    loaded: true,
    ...(pidMatch?.[1] === undefined ? {} : { pid: Number(pidMatch[1]) }),
    detail: pidMatch?.[1] === undefined ? "agent loaded" : `agent running with pid ${pidMatch[1]}`,
  }
}
