import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  deriveInstallPaths,
  readInstallState,
} from "../trajectory/install-state";
import { readCurrentVersion } from "../trajectory/update-pointers";

export type DoctorInstallation =
  | Readonly<{ status: "development" }>
  | Readonly<{ status: "managed"; stateRoot: string }>
  | Readonly<{ status: "invalid"; stateRoot: string }>;

export type ManagedStateRootInput = Readonly<{
  environment: Readonly<Record<string, string | undefined>>;
  executable: string;
  workingDirectory: string;
}>;

const findStateFileRoot = (start: string): string | undefined => {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, "install-state.json"))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
};

export const defaultManagedStateRoot = (
  input: ManagedStateRootInput = {
    environment: process.env,
    executable: import.meta.path,
    workingDirectory: process.cwd(),
  },
): string | undefined => {
  const configured = input.environment.ATM_INSTALL_STATE_ROOT;
  if (configured !== undefined && configured.length > 0) {
    const candidate = resolve(configured);
    return existsSync(join(candidate, "install-state.json"))
      ? candidate
      : undefined;
  }
  return (
    findStateFileRoot(dirname(resolve(input.executable))) ??
    findStateFileRoot(input.workingDirectory)
  );
};

export const inspectDoctorInstallation = (
  packageVersion: string,
  stateRoot: string | undefined,
): Readonly<{
  currentVersion: string;
  installation: DoctorInstallation;
}> => {
  if (stateRoot === undefined) {
    return {
      currentVersion: packageVersion,
      installation: { status: "development" },
    };
  }
  try {
    const currentVersion = readCurrentVersion(stateRoot);
    const state = readInstallState(
      deriveInstallPaths(stateRoot, currentVersion),
    );
    if (realpathSync(state.installRoot) !== realpathSync(stateRoot)) {
      throw new Error("install state root does not match discovered root");
    }
    return {
      currentVersion,
      installation: { status: "managed", stateRoot },
    };
  } catch (caught: unknown) {
    if (!(caught instanceof Error)) throw caught;
    return {
      currentVersion: packageVersion,
      installation: { status: "invalid", stateRoot },
    };
  }
};
