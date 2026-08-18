import packageJson from "../../package.json";
import { realpathSync } from "node:fs";
import {
  deriveInstallPaths,
  readInstallState,
} from "../trajectory/install-state";
import {
  createGitHubLatestVersionReader,
  type LatestVersionReader,
} from "../trajectory/latest-version";
import {
  checkUpdateNotice,
  formatUpdateNotice,
} from "../trajectory/update-notice";
import { defaultUpdateStateRoot } from "../trajectory/update-cli";
import { readCurrentVersion } from "../trajectory/update-pointers";

export type CliUpdateNoticeDependencies = Readonly<{
  currentVersion: string;
  isTTY: boolean;
  latestVersion: LatestVersionReader;
  now: Date;
  stateRoot: string | undefined;
  write: (line: string) => void;
}>;

const isNamedInvocation = (
  argumentsList: readonly string[],
  command: "doctor" | "update",
): boolean =>
  argumentsList[0] === command ||
  (argumentsList[0] === "trajectory" && argumentsList[1] === command);

export type NoticeStateRootInput = Readonly<{
  environment: Readonly<Record<string, string | undefined>>;
  executable: string;
  workingDirectory: string;
}>;

export const defaultNoticeStateRoot = (
  input: NoticeStateRootInput = {
    environment: process.env,
    executable: import.meta.path,
    workingDirectory: process.cwd(),
  },
): string | undefined => {
  try {
    const candidate = defaultUpdateStateRoot(input);
    const currentVersion = readCurrentVersion(candidate);
    const state = readInstallState(
      deriveInstallPaths(candidate, currentVersion),
    );
    return realpathSync(state.installRoot) === realpathSync(candidate)
      ? candidate
      : undefined;
  } catch (caught: unknown) {
    if (caught instanceof Error) return undefined;
    throw caught;
  }
};

const defaultDependencies = (): CliUpdateNoticeDependencies => ({
  currentVersion: packageJson.version,
  isTTY: process.stderr.isTTY === true,
  latestVersion: createGitHubLatestVersionReader(),
  now: new Date(),
  stateRoot: defaultNoticeStateRoot(),
  write: (line) => {
    process.stderr.write(line);
  },
});

export const maybePrintCliUpdateNotice = async (
  argumentsList: readonly string[],
  commandSignal: AbortSignal,
  exitCode: string | number | null | undefined,
  dependencies: CliUpdateNoticeDependencies = defaultDependencies(),
): Promise<void> => {
  if (
    commandSignal.aborted ||
    dependencies.isTTY !== true ||
    (
      exitCode !== undefined &&
      exitCode !== null &&
      exitCode !== 0 &&
      exitCode !== "0"
    ) ||
    argumentsList.includes("--help") ||
    argumentsList.includes("-h") ||
    isNamedInvocation(argumentsList, "doctor") ||
    isNamedInvocation(argumentsList, "update")
  ) {
    return;
  }
  const notice = await checkUpdateNotice({
    currentVersion: dependencies.currentVersion,
    latestVersion: dependencies.latestVersion,
    now: dependencies.now,
    signal: commandSignal,
    stateRoot: dependencies.stateRoot,
  });
  if (notice !== undefined && !commandSignal.aborted) {
    dependencies.write(formatUpdateNotice(notice));
  }
};
