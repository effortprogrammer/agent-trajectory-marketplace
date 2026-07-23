import {
	existsSync,
	lstatSync,
	readlinkSync,
	renameSync,
	rmSync,
	symlinkSync,
	unlinkSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { deriveInstallPaths } from "./install-state";

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const POINTER_CREATE_ATTEMPTS = 8;

export class UpdatePointerError extends Error {
	readonly name = "UpdatePointerError";

	constructor(
		readonly pointer: string,
		options?: ErrorOptions,
	) {
		super(`invalid update pointer: ${pointer}`, options);
	}
}

const pathExists = (path: string): boolean => {
	try {
		lstatSync(path);
		return true;
	} catch (caught: unknown) {
		if (caught instanceof Error && "code" in caught && caught.code === "ENOENT")
			return false;
		throw caught;
	}
};

export const readPointerTarget = (pointer: string): string | undefined => {
	if (!pathExists(pointer)) return undefined;
	try {
		const link = readlinkSync(pointer);
		return resolve(dirname(pointer), link);
	} catch (caught: unknown) {
		throw new UpdatePointerError(pointer, { cause: caught });
	}
};

export const readCurrentVersion = (stateRoot: string): string => {
	const paths = deriveInstallPaths(stateRoot, "0.0.0");
	const target = readPointerTarget(paths.currentPointer);
	if (
		target === undefined ||
		dirname(target) !== paths.releasesDir ||
		!VERSION_PATTERN.test(basename(target)) ||
		!existsSync(target)
	) {
		throw new UpdatePointerError(paths.currentPointer);
	}
	return basename(target);
};

export const replacePointer = (pointer: string, target: string): void => {
	if (!isAbsolute(target)) throw new UpdatePointerError(pointer);
	for (let attempt = 0; attempt < POINTER_CREATE_ATTEMPTS; attempt += 1) {
		const temporary = join(dirname(pointer), `.pointer-${crypto.randomUUID()}`);
		try {
			symlinkSync(target, temporary);
		} catch (caught: unknown) {
			if (caught instanceof Error && "code" in caught && caught.code === "EEXIST")
				continue;
			throw caught;
		}
		try {
			renameSync(temporary, pointer);
			return;
		} finally {
			if (pathExists(temporary)) unlinkSync(temporary);
		}
	}
	throw new UpdatePointerError(pointer);
};

export const restorePointer = (
	pointer: string,
	target: string | undefined,
): void => {
	if (target === undefined) {
		if (pathExists(pointer)) unlinkSync(pointer);
		return;
	}
	replacePointer(pointer, target);
};

export type PointerPairRestoreResult =
	| Readonly<{ status: "restored" }>
	| Readonly<{ status: "failed"; error: Error }>;

export type PointerPairRestoreRequest = Readonly<{
	currentPointer: string;
	currentTarget: string;
	previousPointer: string;
	previousTarget: string | undefined;
}>;

export type PointerPairReplaceRequest = PointerPairRestoreRequest & Readonly<{
	nextCurrentTarget: string;
}>;

export const restorePointerPair = (
	request: PointerPairRestoreRequest,
): PointerPairRestoreResult => {
	try {
		restorePointer(request.currentPointer, request.currentTarget);
		restorePointer(request.previousPointer, request.previousTarget);
		return { status: "restored" };
	} catch (caught: unknown) {
		if (caught instanceof Error) return { status: "failed", error: caught };
		throw caught;
	}
};

export const replacePointerPair = (request: PointerPairReplaceRequest): void => {
	try {
		replacePointer(request.previousPointer, request.currentTarget);
		replacePointer(request.currentPointer, request.nextCurrentTarget);
	} catch (caught: unknown) {
		const restored = restorePointerPair(request);
		if (restored.status === "failed") throw restored.error;
		throw caught;
	}
};

const pointsToRelease = (pointer: string, release: string): boolean => {
	try {
		return readPointerTarget(pointer) === release;
	} catch (caught: unknown) {
		if (caught instanceof Error) return true;
		throw caught;
	}
};

export const removeReleaseIfInactive = (
	currentPointer: string,
	previousPointer: string,
	release: string,
): void => {
	if (
		pointsToRelease(currentPointer, release) ||
		pointsToRelease(previousPointer, release)
	) return;
	rmSync(release, { force: true, recursive: true });
};
