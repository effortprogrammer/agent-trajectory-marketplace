import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
	collectServiceLabel,
	collectServicePaths,
	renderCollectWatchPlist,
} from "./collect-service";
import {
	collectSystemdServicePaths,
	renderCollectWatchSystemdUnit,
} from "./collect-service-systemd";
import type { InstallState } from "./install-state";
import { telemetryEnvironmentFromService } from "./update-service-telemetry";
import type { UpdateServiceHandover } from "./update-transaction";

const COMMAND_TIMEOUT_MS = 15_000;

export type UpdateServiceRuntime = Readonly<{
	home: string;
	platform: NodeJS.Platform;
	uid: number;
	run: (
		command: readonly string[],
		options: Readonly<{ signal: AbortSignal; timeoutMs: number }>,
	) => Promise<boolean>;
	sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}>;

export class UpdateServiceHandoverError extends Error {
	readonly name = "UpdateServiceHandoverError";
}

type ServiceFile = Readonly<{
	content: string;
	path: string;
}>;

const defaultRun = async (
	command: readonly string[],
	options: Readonly<{ signal: AbortSignal; timeoutMs: number }>,
): Promise<boolean> => {
	const child = Bun.spawn([...command], { stdout: "ignore", stderr: "ignore" });
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		child.kill();
	}, options.timeoutMs);
	const abort = (): void => child.kill();
	options.signal.addEventListener("abort", abort, { once: true });
	try {
		const exitCode = await child.exited;
		return exitCode === 0 && !timedOut && !options.signal.aborted;
	} finally {
		clearTimeout(timeout);
		options.signal.removeEventListener("abort", abort);
	}
};

const defaultSleep = async (
	milliseconds: number,
	signal: AbortSignal,
): Promise<void> => {
	await new Promise<void>((resolveSleep, rejectSleep) => {
		const finish = (): void => {
			signal.removeEventListener("abort", abort);
			resolveSleep();
		};
		const timeout = setTimeout(finish, milliseconds);
		const abort = (): void => {
			clearTimeout(timeout);
			signal.removeEventListener("abort", abort);
			rejectSleep(new UpdateServiceHandoverError("collector_service_handover_aborted"));
		};
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) abort();
	});
};

const defaultRuntime = (): UpdateServiceRuntime => ({
	home: homedir(),
	platform: process.platform,
	run: defaultRun,
	sleep: defaultSleep,
	uid: process.getuid?.() ?? 501,
});

const serviceConfig = (state: InstallState) => ({
	intervalSeconds: state.service.intervalSeconds,
	outDir: state.outputDir,
	runtimes: state.service.runtimes,
	settleSeconds: state.service.settleSeconds,
	...(state.service.sourceDir === undefined
		? {}
		: { sourceDir: state.service.sourceDir }),
});

const renderServiceFile = (
	state: InstallState,
	runtime: UpdateServiceRuntime,
	telemetryEnvironmentVariables: Readonly<Record<string, string>> = {},
): ServiceFile => {
	const workingDirectory = join(state.installRoot, "current");
	const entryScriptPath = join(workingDirectory, "dist", "collector.js");
	if (runtime.platform === "linux") {
		const paths = collectSystemdServicePaths(runtime.home, collectServiceLabel);
		return {
			path: paths.unitPath,
			content: renderCollectWatchSystemdUnit({
				config: serviceConfig(state),
				entryScriptPath,
				executablePath: process.execPath,
				telemetryEnvironmentVariables,
				workingDirectory,
			}),
		};
	}
	if (runtime.platform === "darwin") {
		const paths = collectServicePaths(runtime.home);
		return {
			path: paths.plistPath,
			content: renderCollectWatchPlist({
				config: serviceConfig(state),
				entryScriptPath,
				executablePath: process.execPath,
				paths,
				telemetryEnvironmentVariables,
				workingDirectory,
			}),
		};
	}
	throw new UpdateServiceHandoverError("collector_service_unsupported_platform");
};

const replaceServiceFile = (file: ServiceFile): void => {
	mkdirSync(dirname(file.path), { recursive: true });
	const temporary = `${file.path}.update-${crypto.randomUUID()}`;
	try {
		writeFileSync(temporary, file.content, { encoding: "utf8", mode: 0o600 });
		renameSync(temporary, file.path);
	} finally {
		rmSync(temporary, { force: true });
	}
};

const runRequired = async (
	runtime: UpdateServiceRuntime,
	command: readonly string[],
	signal: AbortSignal,
): Promise<void> => {
	if (!(await runtime.run(command, { signal, timeoutMs: COMMAND_TIMEOUT_MS }))) {
		throw new UpdateServiceHandoverError("collector_service_command_failed");
	}
};

const restartAndCheck = async (
	runtime: UpdateServiceRuntime,
	servicePath: string,
	signal: AbortSignal,
): Promise<void> => {
	let healthCommand: readonly string[];
	if (runtime.platform === "linux") {
		const serviceName = `${collectServiceLabel}.service`;
		await runRequired(runtime, ["systemctl", "--user", "daemon-reload"], signal);
		await runRequired(runtime, ["systemctl", "--user", "restart", serviceName], signal);
		healthCommand = ["systemctl", "--user", "is-active", "--quiet", serviceName];
	} else if (runtime.platform === "darwin") {
		const domain = `gui/${runtime.uid}`;
		await runtime.run(
			["launchctl", "bootout", `${domain}/${collectServiceLabel}`],
			{ signal, timeoutMs: COMMAND_TIMEOUT_MS },
		);
		await runRequired(runtime, ["launchctl", "bootstrap", domain, servicePath], signal);
		healthCommand = ["launchctl", "print", `${domain}/${collectServiceLabel}`];
	} else {
		throw new UpdateServiceHandoverError("collector_service_unsupported_platform");
	}
	for (const delay of [2_000, 8_000]) {
		await runtime.sleep(delay, signal);
		if (!(await runtime.run(healthCommand, { signal, timeoutMs: COMMAND_TIMEOUT_MS }))) {
			throw new UpdateServiceHandoverError("collector_service_unhealthy");
		}
	}
};

export const createPlatformUpdateServiceHandover = (
	runtime: UpdateServiceRuntime = defaultRuntime(),
): UpdateServiceHandover => {
	let priorService: ServiceFile | undefined;
	return {
		activate: async ({ fromVersion, installState, signal, toVersion }) => {
			const service = renderServiceFile(installState, runtime);
			priorService = existsSync(service.path)
				? { path: service.path, content: readFileSync(service.path, "utf8") }
				: undefined;
			if (fromVersion === toVersion && priorService === undefined) return;
			const nextService = renderServiceFile(
				installState,
				runtime,
				priorService === undefined
					? {}
					: telemetryEnvironmentFromService(priorService.content, runtime.platform),
			);
			if (fromVersion === toVersion && priorService?.content === nextService.content)
				return;
			replaceServiceFile(nextService);
			try {
				await restartAndCheck(runtime, nextService.path, signal);
			} catch (caught: unknown) {
				if (fromVersion === toVersion && priorService !== undefined)
					replaceServiceFile(priorService);
				throw caught;
			}
		},
		rollback: async ({ installState, signal }) => {
			const currentService = renderServiceFile(installState, runtime);
			if (priorService === undefined) {
				rmSync(currentService.path, { force: true });
				throw new UpdateServiceHandoverError("collector_service_prior_configuration_missing");
			}
			replaceServiceFile(priorService);
			await restartAndCheck(runtime, priorService.path, signal);
		},
	};
};
