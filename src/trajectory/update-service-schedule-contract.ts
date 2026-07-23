export type UpdateScheduleCommandResult = Readonly<{ success: boolean }>;

export type UpdateServiceScheduleEnvironment = Readonly<{
  executablePath: string;
  home: string;
  platform: NodeJS.Platform;
  runLaunchctl: (argumentsList: readonly string[]) => UpdateScheduleCommandResult;
  runSystemctl: (argumentsList: readonly string[]) => UpdateScheduleCommandResult;
  uid: number;
}>;

export type UpdateServiceSchedulePaths = Readonly<{
  launchdPlistPath: string;
  stderrLogPath: string;
  stdoutLogPath: string;
  systemdServicePath: string;
  systemdTimerPath: string;
}>;

type LaunchdScheduleResult = Readonly<{
  detail: "dry_run" | "installed";
  installed: boolean;
  manager: "launchd";
  plist: string;
  plistPath: string;
}>;

type SystemdScheduleInstalledResult = Readonly<{
  detail: "dry_run" | "installed";
  installed: boolean;
  manager: "systemd";
  servicePath: string;
  serviceUnit: string;
  timerPath: string;
  timerUnit: string;
}>;

type SystemdScheduleUnsupportedResult = Readonly<{
  detail: "user_manager_unavailable";
  installed: false;
  manager: "systemd";
  servicePath: string;
  timerPath: string;
}>;

export type UpdateServiceScheduleInstallResult =
  | LaunchdScheduleResult
  | SystemdScheduleInstalledResult
  | SystemdScheduleUnsupportedResult;

export class UpdateServiceScheduleError extends Error {
  readonly name = "UpdateServiceScheduleError";

  constructor(
    readonly code:
      | "update_schedule_activation_failed"
			| "update_schedule_rollback_failed"
      | "update_schedule_unsupported_platform",
  ) {
    super(code);
  }
}
