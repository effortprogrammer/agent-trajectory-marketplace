import { afterEach, expect, jest, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	deriveInstallPaths,
	writeInstallState,
} from "../../../src/trajectory/install-state";
import { runUpdateTransaction } from "../../../src/trajectory/update-transaction";

const roots: string[] = [];

afterEach(() => {
	jest.useRealTimers();
	for (const root of roots.splice(0))
		rmSync(root, { force: true, recursive: true });
});

test("times out a hung build and leaves the active release unchanged", async () => {
	// Given
	jest.useFakeTimers();
	const root = join(tmpdir(), `atm-update-timeout-${crypto.randomUUID()}`);
	const currentRelease = join(root, "releases", "1.0.0");
	roots.push(root);
	mkdirSync(currentRelease, { recursive: true });
	symlinkSync(currentRelease, join(root, "current"));
	writeInstallState(deriveInstallPaths(root, "1.0.0"), {
		schemaVersion: 1,
		installRoot: root,
		outputDir: join(root, "collected"),
		service: { runtimes: ["codex"], intervalSeconds: 30, settleSeconds: 60 },
	});
	const builderStarted = Promise.withResolvers<void>();
	const transaction = runUpdateTransaction({
		stateRoot: root,
		source: {
			resolve: async () => ({
				kind: "available",
				version: "1.1.0",
				archive: new Uint8Array([1]),
			}),
		},
		builder: {
			stage: () => {
				builderStarted.resolve();
				return new Promise(() => undefined);
			},
		},
		service: {
			activate: async () => undefined,
			rollback: async () => undefined,
		},
	});
	await builderStarted.promise;

	// When
	jest.advanceTimersByTime(180_000);

	// Then
	await expect(transaction).resolves.toEqual({
		status: "update_failed",
		currentVersion: "1.0.0",
		attemptedVersion: "1.1.0",
		rolledBack: false,
	});
});

test("does not roll back a version change until a hung activation drain times out", async () => {
	// Given
	jest.useFakeTimers();
	const root = join(tmpdir(), `atm-update-handover-timeout-${crypto.randomUUID()}`);
	const currentRelease = join(root, "releases", "1.0.0");
	roots.push(root);
	mkdirSync(currentRelease, { recursive: true });
	symlinkSync(currentRelease, join(root, "current"));
	writeInstallState(deriveInstallPaths(root, "1.0.0"), {
		schemaVersion: 1,
		installRoot: root,
		outputDir: join(root, "collected"),
		service: { runtimes: ["codex"], intervalSeconds: 30, settleSeconds: 60 },
	});
	const activationStarted = Promise.withResolvers<void>();
	let rollbackCalls = 0;
	const transaction = runUpdateTransaction({
		stateRoot: root,
		source: {
			resolve: async () => ({
				kind: "available",
				version: "1.1.0",
				archive: new Uint8Array([1]),
			}),
		},
		builder: {
			stage: async ({ stagingDir }) => {
				mkdirSync(stagingDir, { recursive: true });
			},
		},
		service: {
			activate: () => {
				activationStarted.resolve();
				return new Promise(() => undefined);
			},
			rollback: async () => {
				rollbackCalls += 1;
			},
		},
	});
	await activationStarted.promise;

	// When
	jest.advanceTimersByTime(60_000);
	await Promise.resolve();
	expect(rollbackCalls).toBe(0);
	jest.advanceTimersByTime(60_000);

	// Then
	await expect(transaction).resolves.toEqual({
		status: "update_failed",
		currentVersion: "1.0.0",
		attemptedVersion: "1.1.0",
		rolledBack: false,
	});
	expect(rollbackCalls).toBe(0);
});
