import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { z } from "zod";

import {
  CollectorServiceError,
  type CollectServiceConfig,
  type CollectServiceEnvironment,
  type CollectServiceInstallResult,
  type CollectServicePaths,
  type CollectServiceStatusResult,
  type CollectServiceUninstallResult,
} from "./collect-service-contract";
import {
  installSystemdCollectWatchService,
  systemdCollectWatchServiceStatus,
  uninstallSystemdCollectWatchService,
} from "./collect-service-systemd";
import { resolveCollectorTelemetryConfig } from "./telemetry";

export {
  CollectorServiceError,
  type CollectServiceConfig,
  type CollectServiceEnvironment,
  type CollectServiceInstallResult,
  type CollectServicePaths,
  type CollectServiceStatusResult,
  type CollectServiceUninstallResult,
} from "./collect-service-contract";

export const collectServiceLabel = "com.agent-trajectory-marketplace-clean.collect-watch";

const serviceConfigSchema = z.object({
  intervalSeconds: z.number().int().positive(),
  outDir: z.string().min(1),
  runtimes: z.array(z.string().min(1)).min(1),
  settleSeconds: z.number().int().nonnegative(),
  sourceDir: z.string().min(1).optional(),
}).strict().refine(
  ({ runtimes, sourceDir }) => sourceDir === undefined || runtimes.length === 1,
  { message: "source_requires_single_runtime", path: ["sourceDir"] },
);

const defaultEnvironment = (): CollectServiceEnvironment => {
  const telemetryConfiguration = resolveCollectorTelemetryConfig();
  return {
    entryScriptPath: resolve(process.cwd(), "dist", "collector.js"),
    executablePath: process.execPath,
    home: homedir(),
    platform: process.platform,
    runLaunchctl: (argumentsList) => {
      const result = spawnSync("launchctl", [...argumentsList], { encoding: "utf8" });
      return { success: result.status === 0 };
    },
    runSystemctl: (argumentsList) => {
      const result = spawnSync("systemctl", [...argumentsList], { encoding: "utf8" });
      return { success: result.status === 0 };
    },
    sleep: Bun.sleepSync,
    ...(telemetryConfiguration === undefined ? {} : {
      telemetryEnvironmentVariables: {
        ATM_POSTHOG_API_KEY: telemetryConfiguration.apiKey,
        ATM_POSTHOG_HOST: telemetryConfiguration.host,
      },
    }),
    uid: process.getuid?.() ?? 501,
    workingDirectory: process.cwd(),
  };
};

const xmlEscape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const assertDarwin = (environment: CollectServiceEnvironment): void => {
  if (environment.platform !== "darwin") {
    throw new CollectorServiceError("service_unsupported_platform");
  }
};

const launchdDomain = (environment: CollectServiceEnvironment): string => `gui/${environment.uid}`;

export const collectServicePaths = (home: string = homedir()): CollectServicePaths => ({
  label: collectServiceLabel,
  plistPath: join(home, "Library", "LaunchAgents", `${collectServiceLabel}.plist`),
  stderrLogPath: join(home, "Library", "Logs", `${collectServiceLabel}.err.log`),
  stdoutLogPath: join(home, "Library", "Logs", `${collectServiceLabel}.out.log`),
});

export const renderCollectWatchPlist = (input: Readonly<{
  config: CollectServiceConfig;
  entryScriptPath: string;
  executablePath: string;
  paths: CollectServicePaths;
  telemetryEnvironmentVariables?: Readonly<Record<"ATM_POSTHOG_API_KEY" | "ATM_POSTHOG_HOST", string>>;
  workingDirectory: string;
}>): string => {
  const config = serviceConfigSchema.parse(input.config);
  const workingDirectory = resolve(input.workingDirectory);
  const argumentsList = [
    resolve(input.executablePath),
    resolve(input.entryScriptPath),
    "trajectory",
    "collect",
    "watch",
    "--out",
    resolve(workingDirectory, config.outDir),
    ...config.runtimes.flatMap((runtime) => ["--runtime", runtime]),
    ...(config.sourceDir === undefined ? [] : ["--source", resolve(config.sourceDir)]),
    "--interval-seconds",
    String(config.intervalSeconds),
    "--settle-seconds",
    String(config.settleSeconds),
  ];
  const argumentsXml = argumentsList
    .map((argument) => `      <string>${xmlEscape(argument)}</string>`)
    .join("\n");
  const environmentXml = Object.entries(input.telemetryEnvironmentVariables ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, value]) => [
      `      <key>${xmlEscape(key)}</key>`,
      `      <string>${xmlEscape(value)}</string>`,
    ]);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "  <dict>",
    "    <key>Label</key>",
    `    <string>${xmlEscape(input.paths.label)}</string>`,
    "    <key>ProgramArguments</key>",
    "    <array>",
    argumentsXml,
    "    </array>",
    "    <key>WorkingDirectory</key>",
    `    <string>${xmlEscape(workingDirectory)}</string>`,
    ...(environmentXml.length === 0 ? [] : [
      "    <key>EnvironmentVariables</key>",
      "    <dict>",
      ...environmentXml,
      "    </dict>",
    ]),
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
  ].join("\n");
};

export const installCollectWatchService = (input: Readonly<{
  config: CollectServiceConfig;
  dryRun?: boolean;
  environment?: CollectServiceEnvironment;
}>): CollectServiceInstallResult => {
  const environment = input.environment ?? defaultEnvironment();
  const config = serviceConfigSchema.parse(input.config);
  if (environment.platform === "linux") {
    return installSystemdCollectWatchService({
      config,
      ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
      environment,
      label: collectServiceLabel,
    });
  }
  assertDarwin(environment);
  const paths = collectServicePaths(environment.home);
  const plist = renderCollectWatchPlist({
    config,
    entryScriptPath: environment.entryScriptPath,
    executablePath: environment.executablePath,
    paths,
    ...(environment.telemetryEnvironmentVariables === undefined ? {} : { telemetryEnvironmentVariables: environment.telemetryEnvironmentVariables }),
    workingDirectory: environment.workingDirectory,
  });
  const servicePath = paths.plistPath;
  if (input.dryRun === true) return { ...paths, bootstrapped: false, detail: "dry_run", manager: "launchd", plist, servicePath };

  const existed = existsSync(paths.plistPath);
  if (existed && readFileSync(paths.plistPath, "utf8") !== plist) {
    throw new CollectorServiceError("service_configuration_conflict");
  }
  mkdirSync(dirname(paths.plistPath), { recursive: true });
  mkdirSync(dirname(paths.stdoutLogPath), { recursive: true });
  if (!existed) writeFileSync(paths.plistPath, plist, "utf8");

  const domain = launchdDomain(environment);
  environment.runLaunchctl(["bootout", `${domain}/${paths.label}`]);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!environment.runLaunchctl(["print", `${domain}/${paths.label}`]).success) break;
    environment.sleep(250);
  }
  let bootstrapped = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (environment.runLaunchctl(["bootstrap", domain, paths.plistPath]).success) {
      bootstrapped = true;
      break;
    }
    if (attempt < 3) environment.sleep(500);
  }
  if (!bootstrapped) {
    if (!existed) rmSync(paths.plistPath, { force: true });
    throw new CollectorServiceError("service_bootstrap_failed");
  }
  return { ...paths, bootstrapped: true, detail: "installed", manager: "launchd", plist, servicePath };
};

export const collectWatchServiceStatus = (input: Readonly<{
  environment?: CollectServiceEnvironment;
}> = {}): CollectServiceStatusResult => {
  const environment = input.environment ?? defaultEnvironment();
  if (environment.platform === "linux") {
    return systemdCollectWatchServiceStatus({ environment, label: collectServiceLabel });
  }
  assertDarwin(environment);
  const paths = collectServicePaths(environment.home);
  const servicePath = paths.plistPath;
  const installed = existsSync(paths.plistPath);
  const loaded = environment.runLaunchctl([
    "print",
    `${launchdDomain(environment)}/${paths.label}`,
  ]).success;
  if (loaded) return { ...paths, detail: "loaded", installed, loaded, manager: "launchd", servicePath, state: "running" };
  if (installed) return { ...paths, detail: "installed_not_loaded", installed, loaded, manager: "launchd", servicePath, state: "stopped" };
  return { ...paths, detail: "not_installed", installed, loaded, manager: "launchd", servicePath, state: "absent" };
};

export const uninstallCollectWatchService = (input: Readonly<{
  environment?: CollectServiceEnvironment;
}> = {}): CollectServiceUninstallResult => {
  const environment = input.environment ?? defaultEnvironment();
  if (environment.platform === "linux") {
    return uninstallSystemdCollectWatchService({ environment, label: collectServiceLabel });
  }
  assertDarwin(environment);
  const paths = collectServicePaths(environment.home);
  const common = { label: paths.label, manager: "launchd" as const, plistPath: paths.plistPath, servicePath: paths.plistPath };
  if (!existsSync(paths.plistPath)) {
    return { ...common, removed: false, detail: "already_absent" };
  }
  environment.runLaunchctl([
    "bootout",
    `${launchdDomain(environment)}/${paths.label}`,
  ]);
  rmSync(paths.plistPath, { force: true });
  return { ...common, removed: true, detail: "removed" };
};
