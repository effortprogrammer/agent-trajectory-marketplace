import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  UpdateServiceScheduleError,
  type UpdateServiceScheduleEnvironment,
  type UpdateServiceScheduleInstallResult,
  type UpdateServiceSchedulePaths,
} from "./update-service-schedule-contract";
import { installSystemdUpdateSchedule } from "./update-service-schedule-systemd";

export {
  UpdateServiceScheduleError,
  type UpdateServiceScheduleEnvironment,
  type UpdateServiceScheduleInstallResult,
  type UpdateServiceSchedulePaths,
} from "./update-service-schedule-contract";
export { renderUpdateSystemdService, renderUpdateSystemdTimer } from "./update-service-schedule-systemd";

export const updateServiceLabel = "com.agent-trajectory-marketplace-clean.update";
const UPDATE_INTERVAL_SECONDS = 21_600;

const defaultEnvironment = (): UpdateServiceScheduleEnvironment => ({
  executablePath: process.execPath,
  home: homedir(),
  platform: process.platform,
  runLaunchctl: (argumentsList) => ({
    success: spawnSync("launchctl", [...argumentsList], { encoding: "utf8" }).status === 0,
  }),
  runSystemctl: (argumentsList) => ({
    success: spawnSync("systemctl", [...argumentsList], { encoding: "utf8" }).status === 0,
  }),
  uid: process.getuid?.() ?? 501,
});

const xmlEscape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

export const updateServiceSchedulePaths = (
  home: string = homedir(),
): UpdateServiceSchedulePaths => ({
  launchdPlistPath: join(home, "Library", "LaunchAgents", `${updateServiceLabel}.plist`),
  stderrLogPath: join(home, "Library", "Logs", `${updateServiceLabel}.err.log`),
  stdoutLogPath: join(home, "Library", "Logs", `${updateServiceLabel}.out.log`),
  systemdServicePath: join(home, ".config", "systemd", "user", `${updateServiceLabel}.service`),
  systemdTimerPath: join(home, ".config", "systemd", "user", `${updateServiceLabel}.timer`),
});

export const renderUpdateLaunchdPlist = (input: Readonly<{
  executablePath: string;
  paths: UpdateServiceSchedulePaths;
  stateRoot: string;
}>): string => {
  const stateRoot = resolve(input.stateRoot);
  const currentRoot = join(stateRoot, "current");
  const argumentsList = [
    resolve(input.executablePath),
    join(currentRoot, "dist", "collector.js"),
    "trajectory",
    "update",
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "  <dict>",
    "    <key>Label</key>",
    `    <string>${updateServiceLabel}</string>`,
    "    <key>ProgramArguments</key>",
    "    <array>",
    ...argumentsList.map((argument) => `      <string>${xmlEscape(argument)}</string>`),
    "    </array>",
    "    <key>WorkingDirectory</key>",
    `    <string>${xmlEscape(currentRoot)}</string>`,
    "    <key>EnvironmentVariables</key>",
    "    <dict>",
    "      <key>ATM_INSTALL_STATE_ROOT</key>",
    `      <string>${xmlEscape(stateRoot)}</string>`,
    "    </dict>",
    "    <key>RunAtLoad</key>",
    "    <true/>",
    "    <key>StartInterval</key>",
    `    <integer>${UPDATE_INTERVAL_SECONDS}</integer>`,
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

const replaceFile = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.update-${crypto.randomUUID()}`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
};

const installLaunchdSchedule = (input: Readonly<{
  dryRun?: boolean;
  environment: UpdateServiceScheduleEnvironment;
  paths: UpdateServiceSchedulePaths;
  stateRoot: string;
}>): UpdateServiceScheduleInstallResult => {
  const plist = renderUpdateLaunchdPlist({
    executablePath: input.environment.executablePath,
    paths: input.paths,
    stateRoot: input.stateRoot,
  });
  const result = {
    detail: input.dryRun === true ? "dry_run" as const : "installed" as const,
    installed: input.dryRun !== true,
    manager: "launchd" as const,
    plist,
    plistPath: input.paths.launchdPlistPath,
  };
  if (input.dryRun === true) return result;
  const prior = existsSync(input.paths.launchdPlistPath)
    ? readFileSync(input.paths.launchdPlistPath, "utf8")
    : undefined;
	const domain = `gui/${input.environment.uid}`;
	const priorLoaded = prior !== undefined && input.environment.runLaunchctl([
		"print",
		`${domain}/${updateServiceLabel}`,
	]).success;
  replaceFile(input.paths.launchdPlistPath, plist);
  mkdirSync(dirname(input.paths.stdoutLogPath), { recursive: true });
  input.environment.runLaunchctl(["bootout", `${domain}/${updateServiceLabel}`]);
  if (input.environment.runLaunchctl([
    "bootstrap",
    domain,
    input.paths.launchdPlistPath,
  ]).success) return result;
  if (prior === undefined) rmSync(input.paths.launchdPlistPath, { force: true });
  else {
    replaceFile(input.paths.launchdPlistPath, prior);
		if (priorLoaded && !input.environment.runLaunchctl([
			"bootstrap",
			domain,
			input.paths.launchdPlistPath,
		]).success) {
			throw new UpdateServiceScheduleError("update_schedule_rollback_failed");
		}
  }
  throw new UpdateServiceScheduleError("update_schedule_activation_failed");
};

export const installUpdateServiceSchedule = (input: Readonly<{
  dryRun?: boolean;
  environment?: UpdateServiceScheduleEnvironment;
  stateRoot: string;
}>): UpdateServiceScheduleInstallResult => {
  const environment = input.environment ?? defaultEnvironment();
  const paths = updateServiceSchedulePaths(environment.home);
  if (environment.platform === "linux") {
    return installSystemdUpdateSchedule({
      ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
      environment,
      label: updateServiceLabel,
      paths,
      stateRoot: input.stateRoot,
    });
  }
  if (environment.platform === "darwin") {
    return installLaunchdSchedule({
      ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
      environment,
      paths,
      stateRoot: input.stateRoot,
    });
  }
  throw new UpdateServiceScheduleError("update_schedule_unsupported_platform");
};
