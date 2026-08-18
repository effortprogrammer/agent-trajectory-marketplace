import { existsSync, realpathSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";

import { parseUpdateCommand } from "../cli/update-command";
import {
	deriveInstallPaths,
	readInstallState,
} from "./install-state";
import { writeLastUpdateResult } from "./update-last-result";
import {
	createBunUpdateBuilder,
	createGitHubUpdateSource,
} from "./update-runtime";
import { createPlatformUpdateServiceHandover } from "./update-service-handover";
import {
	runUpdateTransaction,
	type UpdateBuilder,
	type UpdateReleaseSource,
	type UpdateResult,
	type UpdateServiceHandover,
} from "./update-transaction";

export type UpdateCliDependencies = Readonly<{
	stateRoot: string;
	source: UpdateReleaseSource;
	builder: UpdateBuilder;
	service: UpdateServiceHandover;
}>;

type UpdateStateRootEnvironment = Readonly<{
	executable: string | undefined;
	environment: Readonly<Record<string, string | undefined>>;
	workingDirectory: string;
}>;

const findStateRoot = (start: string): string | undefined => {
	let candidate = resolve(start);
	const filesystemRoot = parse(candidate).root;
	while (true) {
		if (existsSync(resolve(candidate, "install-state.json"))) {
			const paths = deriveInstallPaths(candidate, "0.0.0");
			const state = readInstallState(paths);
			if (realpathSync(state.installRoot) === realpathSync(candidate)) {
				return state.installRoot;
			}
		}
		if (candidate === filesystemRoot) return undefined;
		candidate = dirname(candidate);
	}
};

export const defaultUpdateStateRoot = (
	input: UpdateStateRootEnvironment = {
		executable: import.meta.path,
		environment: process.env,
		workingDirectory: process.cwd(),
	},
): string => {
	const configured = input.environment.ATM_INSTALL_STATE_ROOT;
	if (configured !== undefined && configured.length > 0)
		return resolve(configured);
	const executableRoot =
		input.executable === undefined
			? undefined
			: findStateRoot(dirname(resolve(input.executable)));
	return executableRoot ?? findStateRoot(input.workingDirectory) ?? resolve(input.workingDirectory);
};

export const defaultUpdateCliDependencies = (): UpdateCliDependencies => ({
	stateRoot: defaultUpdateStateRoot(),
	source: createGitHubUpdateSource(),
	builder: createBunUpdateBuilder(),
	service: createPlatformUpdateServiceHandover(),
});

export const runUpdateCli = async (
	argumentsList: readonly string[],
	dependencies: UpdateCliDependencies = defaultUpdateCliDependencies(),
): Promise<UpdateResult> => {
	parseUpdateCommand(argumentsList);
	const result = await runUpdateTransaction(dependencies);
	if (result.status !== "update_already_running") {
		writeLastUpdateResult(dependencies.stateRoot, result);
	}
	return result;
};
