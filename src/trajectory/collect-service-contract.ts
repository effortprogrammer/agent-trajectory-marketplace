export type ServiceCommandResult = Readonly<{ success: boolean }>;

export type CollectServiceConfig = Readonly<{
  intervalSeconds: number;
  outDir: string;
  runtimes: readonly string[];
  settleSeconds: number;
  sourceDir?: string;
}>;

export type CollectServicePaths = Readonly<{
  label: string;
  plistPath: string;
  stderrLogPath: string;
  stdoutLogPath: string;
}>;

export type CollectServiceEnvironment = Readonly<{
  entryScriptPath: string;
  executablePath: string;
  home: string;
  platform: NodeJS.Platform;
  runLaunchctl: (argumentsList: readonly string[]) => ServiceCommandResult;
  runSystemctl: (argumentsList: readonly string[]) => ServiceCommandResult;
  sleep: (milliseconds: number) => void;
  telemetryEnvironmentVariables?: Readonly<Record<string, string>>;
  uid: number;
  workingDirectory: string;
}>;

type LaunchdInstallResult = Readonly<{
  bootstrapped: boolean;
  detail: "dry_run" | "installed";
  label: string;
  manager: "launchd";
  plist: string;
  plistPath: string;
  servicePath: string;
  stderrLogPath: string;
  stdoutLogPath: string;
}>;

type SystemdInstallResult = Readonly<{
  bootstrapped: boolean;
  detail: "dry_run" | "installed";
  label: string;
  manager: "systemd";
  servicePath: string;
  unit: string;
  unitPath: string;
}>;

export type CollectServiceInstallResult = LaunchdInstallResult | SystemdInstallResult;

type ServiceStatus = Readonly<{
  detail: "not_installed" | "installed_not_loaded" | "loaded";
  installed: boolean;
  label: string;
  loaded: boolean;
  state: "absent" | "stopped" | "running";
}>;

export type CollectServiceStatusResult =
  | (ServiceStatus & Readonly<{ manager: "launchd"; plistPath: string; servicePath: string }>)
  | (ServiceStatus & Readonly<{ manager: "systemd"; servicePath: string; unitPath: string }>);

type ServiceUninstall = Readonly<{
  detail: "already_absent" | "removed";
  label: string;
  removed: boolean;
}>;

export type CollectServiceUninstallResult =
  | (ServiceUninstall & Readonly<{ manager: "launchd"; plistPath: string; servicePath: string }>)
  | (ServiceUninstall & Readonly<{ manager: "systemd"; servicePath: string; unitPath: string }>);

export class CollectorServiceError extends Error {
  readonly code: "service_bootstrap_failed" | "service_configuration_conflict" | "service_unsupported_platform";

  constructor(code: CollectorServiceError["code"]) {
    super(code);
    this.name = "CollectorServiceError";
    this.code = code;
  }
}
