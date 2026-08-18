import { renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import type { UpdateResult } from "./update-transaction";

const resultSchema = z.discriminatedUnion("status", [
	z.object({
		status: z.literal("updated"),
		fromVersion: z.string(),
		toVersion: z.string(),
	}).strict(),
	z.object({
		status: z.literal("up_to_date"),
		currentVersion: z.string(),
	}).strict(),
	z.object({
		status: z.literal("update_already_running"),
		currentVersion: z.string(),
	}).strict(),
	z.object({
		status: z.literal("update_failed"),
		currentVersion: z.string(),
		attemptedVersion: z.string().optional(),
		rolledBack: z.boolean(),
	}).strict(),
]);

const resultPath = (stateRoot: string): string =>
	join(stateRoot, "last-update-result.json");

export const writeLastUpdateResult = (
	stateRoot: string,
	result: UpdateResult,
): void => {
	const parsed = resultSchema.parse(result);
	const path = resultPath(stateRoot);
	const temporary = `${path}.tmp-${crypto.randomUUID()}`;
	try {
		writeFileSync(temporary, `${JSON.stringify(parsed, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
};
