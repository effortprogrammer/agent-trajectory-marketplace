import { mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
	acquireInstallLock,
	deriveInstallPaths,
	type InstallLock,
	InstallLockHeldError,
	type InstallState,
	readInstallState,
} from "./install-state";
import {
	readCurrentVersion,
	readPointerTarget,
	removeReleaseIfInactive,
	replacePointerPair,
	restorePointerPair,
} from "./update-pointers";
import {
	runBoundedUpdate,
	UPDATE_TIMEOUTS,
} from "./update-transaction-runtime";
import {
	reconcileCurrentUpdateService,
	rollbackUpdateService,
} from "./update-service-recovery";
import {
	runReleaseRetention,
	type UpdateRetention,
} from "./update-retention";

export type UpdateReleaseResolution =
	| Readonly<{ kind: "up_to_date"; version: string }>
	| Readonly<{ kind: "available"; version: string; archive: Uint8Array }>;

export interface UpdateReleaseSource {
	resolve(
		request: Readonly<{
			currentVersion: string;
			timeoutMs: number;
			signal: AbortSignal;
		}>,
	): Promise<UpdateReleaseResolution>;
}

export interface UpdateBuilder {
	stage(
		request: Readonly<{
			archive: Uint8Array;
			stagingDir: string;
			timeoutMs: number;
			signal: AbortSignal;
		}>,
	): Promise<void>;
}

type HandoverRequest = Readonly<{
	fromVersion: string;
	toVersion: string;
	installState: InstallState;
	signal: AbortSignal;
}>;

export interface UpdateServiceHandover {
	activate(request: HandoverRequest): Promise<void>;
	rollback(request: HandoverRequest): Promise<void>;
}

export type UpdateResult =
	| Readonly<{
			status: "updated";
			fromVersion: string;
			toVersion: string;
			retention?: "cleanup_failed";
	  }>
	| Readonly<{ status: "up_to_date"; currentVersion: string }>
	| Readonly<{ status: "update_already_running"; currentVersion: string }>
	| Readonly<{
			status: "update_failed";
			currentVersion: string;
			attemptedVersion?: string;
			rolledBack: boolean;
	  }>;

type UpdateTransactionRequest = Readonly<{
	stateRoot: string;
	source: UpdateReleaseSource;
	builder: UpdateBuilder;
	service: UpdateServiceHandover;
	retention?: UpdateRetention;
	signal?: AbortSignal;
}>;

class UpdateTransactionError extends Error {
	readonly name = "UpdateTransactionError";
}

const safeCurrentVersion = (stateRoot: string): string => {
	try {
		return readCurrentVersion(stateRoot);
	} catch (caught: unknown) {
		if (caught instanceof Error) return "unknown";
		throw caught;
	}
};

export const runUpdateTransaction = async (
	request: UpdateTransactionRequest,
): Promise<UpdateResult> => {
	const stablePaths = deriveInstallPaths(request.stateRoot, "0.0.0");
	let lock: InstallLock;
	try {
		lock = acquireInstallLock(stablePaths);
	} catch (caught: unknown) {
		if (caught instanceof InstallLockHeldError) {
			return {
				status: "update_already_running",
				currentVersion: safeCurrentVersion(request.stateRoot),
			};
		}
		throw caught;
	}

	let currentVersion = "unknown";
	let attemptedVersion: string | undefined;
	let stagingDir: string | undefined;
	let installedRelease: string | undefined;
	try {
		currentVersion = readCurrentVersion(request.stateRoot);
		const currentPaths = deriveInstallPaths(request.stateRoot, currentVersion);
		const installState = readInstallState(currentPaths);
		const resolution = await runBoundedUpdate(
			UPDATE_TIMEOUTS.downloadMs,
			request.signal,
			(signal) =>
				request.source.resolve({
					currentVersion,
					timeoutMs: UPDATE_TIMEOUTS.downloadMs,
					signal,
				}),
		);
		if (resolution.kind === "up_to_date") {
			if (resolution.version !== currentVersion)
				throw new UpdateTransactionError();
			const rolledBack = await reconcileCurrentUpdateService({
				currentVersion,
				installState,
				service: request.service,
				...(request.signal === undefined ? {} : { signal: request.signal }),
			});
			if (rolledBack !== undefined) {
				return {
					status: "update_failed",
					currentVersion,
					rolledBack,
				};
			}
			return { status: "up_to_date", currentVersion };
		}

		attemptedVersion = resolution.version;
		const targetPaths = deriveInstallPaths(
			request.stateRoot,
			resolution.version,
		);
		mkdirSync(targetPaths.releasesDir, { recursive: true });
		const stagePath = join(
			targetPaths.releasesDir,
			`.update-stage-${crypto.randomUUID()}`,
		);
		stagingDir = stagePath;
		await runBoundedUpdate(UPDATE_TIMEOUTS.buildMs, request.signal, (signal) =>
			request.builder.stage({
				archive: resolution.archive,
				stagingDir: stagePath,
				timeoutMs: UPDATE_TIMEOUTS.buildMs,
				signal,
			}),
		);
		renameSync(stagePath, targetPaths.releaseDir);
		stagingDir = undefined;
		installedRelease = targetPaths.releaseDir;

		const oldCurrent = readPointerTarget(currentPaths.currentPointer);
		const oldPrevious = readPointerTarget(currentPaths.previousPointer);
		if (oldCurrent === undefined) throw new UpdateTransactionError();
		replacePointerPair({
			currentPointer: currentPaths.currentPointer,
			currentTarget: oldCurrent,
			nextCurrentTarget: targetPaths.releaseDir,
			previousPointer: currentPaths.previousPointer,
			previousTarget: oldPrevious,
		});
		try {
			await runBoundedUpdate(
				UPDATE_TIMEOUTS.serviceHandoverMs,
				request.signal,
				(signal) => request.service.activate({
					fromVersion: currentVersion,
					toVersion: resolution.version,
					installState,
					signal,
				}),
			);
		} catch (activationError: unknown) {
			if (!(activationError instanceof Error)) throw activationError;
			const pointerRestore = restorePointerPair({
				currentPointer: currentPaths.currentPointer,
				currentTarget: oldCurrent,
				previousPointer: currentPaths.previousPointer,
				previousTarget: oldPrevious,
			});
			const serviceRestored = readPointerTarget(currentPaths.currentPointer) === oldCurrent
				&& await rollbackUpdateService({
					fromVersion: resolution.version,
					toVersion: currentVersion,
					installState,
					service: request.service,
				});
			removeReleaseIfInactive(
				currentPaths.currentPointer,
				currentPaths.previousPointer,
				targetPaths.releaseDir,
			);
			installedRelease = undefined;
			return {
				status: "update_failed",
				currentVersion,
				attemptedVersion: resolution.version,
				rolledBack: pointerRestore.status === "restored" && serviceRestored,
			};
		}
		const retention = runReleaseRetention(
			request.retention,
			targetPaths.releasesDir,
			oldPrevious,
			[oldCurrent, targetPaths.releaseDir],
		);
		return {
			status: "updated",
			fromVersion: currentVersion,
			toVersion: resolution.version,
			...(retention === "cleanup_failed" ? { retention } : {}),
		};
	} catch (caught: unknown) {
		if (!(caught instanceof Error)) throw caught;
		if (installedRelease !== undefined)
			removeReleaseIfInactive(
				stablePaths.currentPointer,
				stablePaths.previousPointer,
				installedRelease,
			);
		return {
			status: "update_failed",
			currentVersion,
			...(attemptedVersion === undefined ? {} : { attemptedVersion }),
			rolledBack: false,
		};
	} finally {
		if (stagingDir !== undefined)
			rmSync(stagingDir, { force: true, recursive: true });
		lock.release();
	}
};
