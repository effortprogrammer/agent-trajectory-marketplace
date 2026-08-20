import packageJson from "../../package.json";
import {
  compareStableVersions,
  parseStableVersion,
} from "../trajectory/update-release-contract";
import {
  createGitHubLatestVersionReader,
  type LatestVersionReader,
} from "../trajectory/latest-version";
import { CollectorRequestError } from "./collector-error";
import {
  defaultManagedStateRoot,
  type DoctorInstallation,
  inspectDoctorInstallation,
} from "./doctor-installation";

export {
  defaultManagedStateRoot,
  type ManagedStateRootInput,
} from "./doctor-installation";

const MINIMUM_BUN_VERSION = "1.3.0";

export type DoctorCommand = Readonly<{ command: "doctor" }>;

type DoctorRuntime = Readonly<{
  status: "supported" | "unsupported";
  minimumVersion: "1.3.0";
}>;

type DoctorUpdate =
  | Readonly<{
      status: "up_to_date";
      currentVersion: string;
      latestVersion: string;
    }>
  | Readonly<{
      status: "update_available";
      currentVersion: string;
      latestVersion: string;
      command: "trajectory update";
    }>
  | Readonly<{ status: "check_failed"; currentVersion: string }>
  | Readonly<{ status: "not_checked"; currentVersion: string }>;

export type DoctorResult = Readonly<{
  status: "healthy" | "attention_required";
  version: string;
  bunVersion: string;
  runtime: DoctorRuntime;
  installation: DoctorInstallation;
  update: DoctorUpdate;
}>;

export type DoctorDependencies = Readonly<{
  bunVersion: string;
  latestVersion: LatestVersionReader;
  packageVersion: string;
  signal?: AbortSignal;
  stateRoot: string | undefined;
}>;

const defaultDoctorDependencies = (): DoctorDependencies => ({
  bunVersion: Bun.version,
  latestVersion: createGitHubLatestVersionReader(),
  packageVersion: packageJson.version,
  stateRoot: defaultManagedStateRoot(),
});

export const parseDoctorCommand = (
  argumentsList: readonly string[],
): DoctorCommand => {
  if (
    (argumentsList.length === 1 && argumentsList[0] === "doctor") ||
    (
      argumentsList.length === 2 &&
      argumentsList[0] === "trajectory" &&
      argumentsList[1] === "doctor"
    )
  ) {
    return { command: "doctor" };
  }
  throw new CollectorRequestError();
};

const inspectRuntime = (bunVersion: string): DoctorRuntime => {
  try {
    const supported =
      compareStableVersions(
        parseStableVersion(bunVersion),
        parseStableVersion(MINIMUM_BUN_VERSION),
      ) >= 0;
    return {
      status: supported ? "supported" : "unsupported",
      minimumVersion: MINIMUM_BUN_VERSION,
    };
  } catch (caught: unknown) {
    if (!(caught instanceof Error)) throw caught;
    return {
      status: "unsupported",
      minimumVersion: MINIMUM_BUN_VERSION,
    };
  }
};

export const runDoctorCli = async (
  argumentsList: readonly string[],
  dependencies: DoctorDependencies = defaultDoctorDependencies(),
): Promise<DoctorResult> => {
  parseDoctorCommand(argumentsList);
  const inspected = inspectDoctorInstallation(
    dependencies.packageVersion,
    dependencies.stateRoot,
  );
  const runtime = inspectRuntime(dependencies.bunVersion);
  if (inspected.installation.status === "invalid") {
    return {
      status: "attention_required",
      version: inspected.currentVersion,
      bunVersion: dependencies.bunVersion,
      runtime,
      installation: inspected.installation,
      update: {
        status: "not_checked",
        currentVersion: inspected.currentVersion,
      },
    };
  }
  try {
    const timeout = AbortSignal.timeout(5_000);
    const signal =
      dependencies.signal === undefined
        ? timeout
        : AbortSignal.any([dependencies.signal, timeout]);
    const latestVersion = await dependencies.latestVersion(signal);
    const current = parseStableVersion(inspected.currentVersion);
    const latest = parseStableVersion(latestVersion);
    if (compareStableVersions(latest, current) > 0) {
      return {
        status: "attention_required",
        version: inspected.currentVersion,
        bunVersion: dependencies.bunVersion,
        runtime,
        installation: inspected.installation,
        update: {
          status: "update_available",
          currentVersion: inspected.currentVersion,
          latestVersion,
          command: "trajectory update",
        },
      };
    }
    return {
      status:
        runtime.status === "supported" ? "healthy" : "attention_required",
      version: inspected.currentVersion,
      bunVersion: dependencies.bunVersion,
      runtime,
      installation: inspected.installation,
      update: {
        status: "up_to_date",
        currentVersion: inspected.currentVersion,
        latestVersion,
      },
    };
  } catch (caught: unknown) {
    if (!(caught instanceof Error)) throw caught;
    return {
      status: "attention_required",
      version: inspected.currentVersion,
      bunVersion: dependencies.bunVersion,
      runtime,
      installation: inspected.installation,
      update: {
        status: "check_failed",
        currentVersion: inspected.currentVersion,
      },
    };
  }
};

export const runDefaultDoctorCli = (
  argumentsList: readonly string[],
  signal: AbortSignal,
): Promise<DoctorResult> =>
  runDoctorCli(argumentsList, {
    ...defaultDoctorDependencies(),
    signal,
  });
