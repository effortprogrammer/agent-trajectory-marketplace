import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, parse, resolve } from "node:path";

import { parseUpdateCommand, type UpdateCommand } from "../cli/update-command";
import {
	deriveInstallPaths,
	readInstallState,
} from "./install-state";
import {
	readLastUpdateResult,
	writeLastUpdateResult,
} from "./update-last-result";
import { readCurrentVersion, readPointerTarget } from "./update-pointers";
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

export type UpdateStatusResult = Readonly<{
	status: "up_to_date" | "update_available" | "update_check_failed";
	checked: boolean;
	currentVersion: string;
	latestVersion?: string;
	errorCode?: "release_check_failed";
	lastResult?: UpdateResult;
	previousVersion?: string;
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

const readUpdateStatus = async (
	stateRoot: string,
	source: UpdateReleaseSource,
): Promise<UpdateStatusResult> => {
	const currentVersion = readCurrentVersion(stateRoot);
	const paths = deriveInstallPaths(stateRoot, currentVersion);
	const previousTarget = readPointerTarget(paths.previousPointer);
	const lastResult = readLastUpdateResult(stateRoot);
	const localState = {
		currentVersion,
		...(lastResult === undefined ? {} : { lastResult }),
		...(previousTarget === undefined
			? {}
			: { previousVersion: basename(previousTarget) }),
	};
	try {
		const resolution = await source.resolve({
			currentVersion,
			timeoutMs: 60_000,
			signal: AbortSignal.timeout(60_000),
		});
		return {
			...localState,
			status: resolution.kind === "available" ? "update_available" : "up_to_date",
			checked: true,
			latestVersion: resolution.version,
		};
	} catch (caught: unknown) {
		if (!(caught instanceof Error)) throw caught;
		return {
			...localState,
			status: "update_check_failed",
			checked: false,
			errorCode: "release_check_failed",
		};
	}
};

export const runUpdateCli = async (
	argumentsList: readonly string[],
	dependencies: UpdateCliDependencies = defaultUpdateCliDependencies(),
): Promise<UpdateResult | UpdateStatusResult> => {
	const command: UpdateCommand = parseUpdateCommand(argumentsList);
	switch (command.verb) {
		case "apply": {
			const result = await runUpdateTransaction(dependencies);
			if (result.status !== "update_already_running") {
				writeLastUpdateResult(dependencies.stateRoot, result);
			}
			return result;
		}
		case "status":
			try {
				return await readUpdateStatus(dependencies.stateRoot, dependencies.source);
			} catch (caught: unknown) {
				if (!(caught instanceof Error)) throw caught;
				return {
					status: "update_failed",
					currentVersion: "unknown",
					rolledBack: false,
				};
			}
	}
};
