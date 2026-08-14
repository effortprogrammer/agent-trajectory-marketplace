import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  CollectorServiceError,
  type CollectServiceConfig,
  type CollectServiceEnvironment,
  type CollectServiceInstallResult,
  type CollectServiceStatusResult,
  type CollectServiceUninstallResult,
} from "./collect-service-contract";

type SystemdServicePaths = Readonly<{
  label: string;
  serviceName: string;
  unitPath: string;
}>;

const systemdQuote = (value: string): string =>
  `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t")}"`;

export const renderSystemdWorkingDirectory = (value: string): string =>
  value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "%%")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");

export const collectSystemdServicePaths = (home: string, label: string): SystemdServicePaths => ({
  label,
  serviceName: `${label}.service`,
  unitPath: join(home, ".config", "systemd", "user", `${label}.service`),
});

export const renderCollectWatchSystemdUnit = (input: Readonly<{
  config: CollectServiceConfig;
  entryScriptPath: string;
  executablePath: string;
  telemetryEnvironmentVariables?: Readonly<Record<string, string>>;
  workingDirectory: string;
}>): string => {
  const workingDirectory = resolve(input.workingDirectory);
  const argumentsList = [
    resolve(input.executablePath),
    resolve(input.entryScriptPath),
    "trajectory",
    "collect",
    "watch",
    "--out",
    resolve(workingDirectory, input.config.outDir),
    ...input.config.runtimes.flatMap((runtime) => ["--runtime", runtime]),
    ...(input.config.declareRuntime === undefined
      ? []
      : ["--declare-runtime", input.config.declareRuntime]),
    ...(input.config.sourceDir === undefined ? [] : ["--source", resolve(input.config.sourceDir)]),
    "--interval-seconds",
    String(input.config.intervalSeconds),
    "--settle-seconds",
    String(input.config.settleSeconds),
  ];
  return [
    "[Unit]",
    "Description=ATM trajectory collector",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${renderSystemdWorkingDirectory(workingDirectory)}`,
    ...Object.entries(input.telemetryEnvironmentVariables ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `Environment=${systemdQuote(`${key}=${value}`)}`),
    `ExecStart=${argumentsList.map(systemdQuote).join(" ")}`,
    "Restart=always",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
};

export const installSystemdCollectWatchService = (input: Readonly<{
  config: CollectServiceConfig;
  dryRun?: boolean;
  environment: CollectServiceEnvironment;
  label: string;
}>): CollectServiceInstallResult => {
  const paths = collectSystemdServicePaths(input.environment.home, input.label);
  const unit = renderCollectWatchSystemdUnit({
    config: input.config,
    entryScriptPath: input.environment.entryScriptPath,
    executablePath: input.environment.executablePath,
    ...(input.environment.telemetryEnvironmentVariables === undefined ? {} : { telemetryEnvironmentVariables: input.environment.telemetryEnvironmentVariables }),
    workingDirectory: input.environment.workingDirectory,
  });
  const result = {
    bootstrapped: input.dryRun !== true,
    detail: input.dryRun === true ? "dry_run" as const : "installed" as const,
    label: paths.label,
    manager: "systemd" as const,
    servicePath: paths.unitPath,
    unit,
    unitPath: paths.unitPath,
  };
  if (input.dryRun === true) return result;

  const existed = existsSync(paths.unitPath);
  if (existed && readFileSync(paths.unitPath, "utf8") !== unit) {
    throw new CollectorServiceError("service_configuration_conflict");
  }
  mkdirSync(dirname(paths.unitPath), { recursive: true });
  if (!existed) writeFileSync(paths.unitPath, unit, "utf8");
  const reloaded = input.environment.runSystemctl(["--user", "daemon-reload"]).success;
  const enabled = reloaded && input.environment.runSystemctl([
    "--user",
    "enable",
    "--now",
    paths.serviceName,
  ]).success;
  if (!enabled) {
    if (!existed) rmSync(paths.unitPath, { force: true });
    throw new CollectorServiceError("service_bootstrap_failed");
  }
  return result;
};

export const systemdCollectWatchServiceStatus = (input: Readonly<{
  environment: CollectServiceEnvironment;
  label: string;
}>): CollectServiceStatusResult => {
  const paths = collectSystemdServicePaths(input.environment.home, input.label);
  const installed = existsSync(paths.unitPath);
  const loaded = input.environment.runSystemctl([
    "--user",
    "is-active",
    "--quiet",
    paths.serviceName,
  ]).success;
  const common = { installed, label: paths.label, loaded, manager: "systemd" as const, servicePath: paths.unitPath, unitPath: paths.unitPath };
  if (loaded) return { ...common, detail: "loaded", state: "running" };
  if (installed) return { ...common, detail: "installed_not_loaded", state: "stopped" };
  return { ...common, detail: "not_installed", state: "absent" };
};

export const uninstallSystemdCollectWatchService = (input: Readonly<{
  environment: CollectServiceEnvironment;
  label: string;
}>): CollectServiceUninstallResult => {
  const paths = collectSystemdServicePaths(input.environment.home, input.label);
  const common = { label: paths.label, manager: "systemd" as const, servicePath: paths.unitPath, unitPath: paths.unitPath };
  if (!existsSync(paths.unitPath)) return { ...common, removed: false, detail: "already_absent" };
  input.environment.runSystemctl(["--user", "disable", "--now", paths.serviceName]);
  rmSync(paths.unitPath, { force: true });
  input.environment.runSystemctl(["--user", "daemon-reload"]);
  return { ...common, removed: true, detail: "removed" };
};
