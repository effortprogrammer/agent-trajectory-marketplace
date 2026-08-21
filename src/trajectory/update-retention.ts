import { rmSync } from "node:fs";
import { basename, dirname } from "node:path";

import { isStableVersion } from "./update-release-contract";

export interface UpdateRetention {
	remove(target: string): void;
}

export const removeSupersededRelease = (
	releasesDir: string,
	target: string | undefined,
	retained: readonly string[],
): void => {
	if (
		target === undefined ||
		dirname(target) !== releasesDir ||
		!isStableVersion(basename(target)) ||
		retained.includes(target)
	) return;
	rmSync(target, { force: true, recursive: true });
};

export const runReleaseRetention = (
	retention: UpdateRetention | undefined,
	releasesDir: string,
	target: string | undefined,
	retained: readonly string[],
): "complete" | "cleanup_failed" => {
	try {
		if (target !== undefined && retention !== undefined) retention.remove(target);
		else removeSupersededRelease(releasesDir, target, retained);
		return "complete";
	} catch (caught: unknown) {
		if (!(caught instanceof Error)) throw caught;
		return "cleanup_failed";
	}
};
