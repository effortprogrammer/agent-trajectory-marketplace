import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  UpdateServiceScheduleError,
  type UpdateServiceScheduleEnvironment,
  type UpdateServiceScheduleInstallResult,
  type UpdateServiceSchedulePaths,
} from "./update-service-schedule-contract";
import { renderSystemdWorkingDirectory } from "./collect-service-systemd";

const UPDATE_INTERVAL_SECONDS = 21_600;

const systemdQuote = (value: string): string =>
  `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t")}"`;

export const renderUpdateSystemdService = (input: Readonly<{
  executablePath: string;
  stateRoot: string;
}>): string => {
  const stateRoot = resolve(input.stateRoot);
  const currentRoot = join(stateRoot, "current");
  const command = [
    resolve(input.executablePath),
    join(currentRoot, "dist", "collector.js"),
    "trajectory",
    "update",
  ];
  return [
    "[Unit]",
    "Description=ATM automatic updater",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=oneshot",
    `WorkingDirectory=${renderSystemdWorkingDirectory(currentRoot)}`,
    `Environment=${systemdQuote(`ATM_INSTALL_STATE_ROOT=${stateRoot}`)}`,
    `ExecStart=${command.map(systemdQuote).join(" ")}`,
    "",
  ].join("\n");
};

export const renderUpdateSystemdTimer = (serviceName: string): string => [
  "[Unit]",
  "Description=Run the ATM automatic updater every six hours",
  "",
  "[Timer]",
  "OnStartupSec=60s",
  `OnUnitActiveSec=${UPDATE_INTERVAL_SECONDS}s`,
  "Persistent=true",
  `Unit=${serviceName}`,
  "",
  "[Install]",
  "WantedBy=timers.target",
  "",
].join("\n");

type PriorFile = Readonly<{ content?: string; path: string }>;

type PriorUnit = Readonly<{
	active: boolean;
	enabled: boolean;
	file: PriorFile;
	name: string;
}>;

const captureFile = (path: string): PriorFile =>
  existsSync(path) ? { content: readFileSync(path, "utf8"), path } : { path };

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

const restoreFile = (prior: PriorFile): void => {
  if (prior.content === undefined) {
    rmSync(prior.path, { force: true });
    return;
  }
  replaceFile(prior.path, prior.content);
};

const captureUnit = (
	environment: UpdateServiceScheduleEnvironment,
	name: string,
	file: PriorFile,
): PriorUnit => {
	const enabled = environment.runSystemctl(["--user", "is-enabled", "--quiet", name]).success;
	const active = environment.runSystemctl(["--user", "is-active", "--quiet", name]).success;
	return { active, enabled, file, name };
};

const restoreUnitState = (
	environment: UpdateServiceScheduleEnvironment,
	unit: PriorUnit,
): boolean => {
	if (unit.file.content === undefined) return true;
	const enabled = environment.runSystemctl([
		"--user",
		unit.enabled ? "enable" : "disable",
		unit.name,
	]).success;
	const active = environment.runSystemctl([
		"--user",
		unit.active ? "start" : "stop",
		unit.name,
	]).success;
	return enabled && active;
};

export const installSystemdUpdateSchedule = (input: Readonly<{
  dryRun?: boolean;
  environment: UpdateServiceScheduleEnvironment;
  label: string;
  paths: UpdateServiceSchedulePaths;
  stateRoot: string;
}>): UpdateServiceScheduleInstallResult => {
  const serviceName = `${input.label}.service`;
  const timerName = `${input.label}.timer`;
  const serviceUnit = renderUpdateSystemdService({
    executablePath: input.environment.executablePath,
    stateRoot: input.stateRoot,
  });
  const timerUnit = renderUpdateSystemdTimer(serviceName);
  const result = {
    detail: input.dryRun === true ? "dry_run" as const : "installed" as const,
    installed: input.dryRun !== true,
    manager: "systemd" as const,
    servicePath: input.paths.systemdServicePath,
    serviceUnit,
    timerPath: input.paths.systemdTimerPath,
    timerUnit,
  };
  if (input.dryRun === true) return result;
  if (!input.environment.runSystemctl(["--user", "show-environment"]).success) {
    return {
      detail: "user_manager_unavailable",
      installed: false,
      manager: "systemd",
      servicePath: input.paths.systemdServicePath,
      timerPath: input.paths.systemdTimerPath,
    };
  }

  const priorServiceFile = captureFile(input.paths.systemdServicePath);
  const priorTimerFile = captureFile(input.paths.systemdTimerPath);
  const hasPriorUnits = priorServiceFile.content !== undefined || priorTimerFile.content !== undefined;
  const priorService = hasPriorUnits
		? captureUnit(input.environment, serviceName, priorServiceFile)
		: { active: false, enabled: false, file: priorServiceFile, name: serviceName };
  const priorTimer = hasPriorUnits
		? captureUnit(input.environment, timerName, priorTimerFile)
		: { active: false, enabled: false, file: priorTimerFile, name: timerName };
  replaceFile(input.paths.systemdServicePath, serviceUnit);
  replaceFile(input.paths.systemdTimerPath, timerUnit);
  const reloaded = input.environment.runSystemctl(["--user", "daemon-reload"]).success;
  const enabled = reloaded && input.environment.runSystemctl([
    "--user",
    "enable",
    "--now",
    timerName,
  ]).success;
  if (enabled) return result;

  const timerStopped = input.environment.runSystemctl([
		"--user", "disable", "--now", timerName,
	]).success;
  const serviceStopped = input.environment.runSystemctl([
		"--user", "stop", serviceName,
	]).success;
  restoreFile(priorService.file);
  restoreFile(priorTimer.file);
  const rollbackReloaded = input.environment.runSystemctl(["--user", "daemon-reload"]).success;
  const serviceRestored = restoreUnitState(input.environment, priorService);
  const timerRestored = restoreUnitState(input.environment, priorTimer);
  if (!(timerStopped && serviceStopped && rollbackReloaded && serviceRestored && timerRestored)) {
		throw new UpdateServiceScheduleError("update_schedule_rollback_failed");
	}
  throw new UpdateServiceScheduleError("update_schedule_activation_failed");
};
