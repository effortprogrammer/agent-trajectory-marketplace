import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	deriveInstallPaths,
	writeInstallState,
} from "../../../src/trajectory/install-state";
import {
	defaultUpdateStateRoot,
	runUpdateCli,
} from "../../../src/trajectory/update-cli";
import { writeLastUpdateResult } from "../../../src/trajectory/update-last-result";

const roots: string[] = [];

const installFixture = (): string => {
	const root = join(tmpdir(), `atm-update-cli-${crypto.randomUUID()}`);
	const release = join(root, "releases", "1.0.0");
	roots.push(root);
	mkdirSync(release, { recursive: true });
	symlinkSync(release, join(root, "current"));
	writeInstallState(deriveInstallPaths(root, "1.0.0"), {
		schemaVersion: 1,
		installRoot: root,
		outputDir: join(root, "collected"),
		service: { runtimes: ["codex"], intervalSeconds: 30, settleSeconds: 60 },
	});
	return root;
};

afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { force: true, recursive: true });
});

describe("async update dispatcher", () => {
	test("discovers the stable state root when the executable runs through current", () => {
		// Given
		const stateRoot = installFixture();
		const executable = join(stateRoot, "current", "dist", "collector.js");

		// When
		const resolved = defaultUpdateStateRoot({
			executable,
			environment: {},
			workingDirectory: join(stateRoot, "current"),
		});

		// Then
		expect(resolved).toBe(stateRoot);
	});

	test("checks the latest release before reporting update availability", async () => {
		// Given
		const stateRoot = installFixture();
		let checked = false;

		// When
		const result = await runUpdateCli(["trajectory", "update", "status"], {
			stateRoot,
			source: {
				resolve: async () => {
					checked = true;
					return {
						kind: "available",
						version: "1.1.0",
						archive: new Uint8Array([1]),
					};
				},
			},
			builder: { stage: async () => undefined },
			service: {
				activate: async () => undefined,
				rollback: async () => undefined,
			},
		});

		// Then
		expect(checked).toBe(true);
		expect(result).toEqual({
			status: "update_available",
			checked: true,
			currentVersion: "1.0.0",
			latestVersion: "1.1.0",
		});
	});

	test("status includes the last completed update result", async () => {
		// Given
		const stateRoot = installFixture();
		const dependencies = {
			stateRoot,
			source: {
				resolve: async () => ({ kind: "up_to_date" as const, version: "1.0.0" }),
			},
			builder: { stage: async () => undefined },
			service: {
				activate: async () => undefined,
				rollback: async () => undefined,
			},
		};
		await runUpdateCli(["trajectory", "update"], dependencies);

		// When
		const result = await runUpdateCli(
			["trajectory", "update", "status"],
			dependencies,
		);

		// Then
		expect(result).toEqual({
			status: "up_to_date",
			checked: true,
			currentVersion: "1.0.0",
			latestVersion: "1.0.0",
			lastResult: { status: "up_to_date", currentVersion: "1.0.0" },
		});
	});

	test("returns a stable failure for malformed stale local state", async () => {
		// Given
		const stateRoot = join(
			tmpdir(),
			`atm-update-cli-stale-${crypto.randomUUID()}`,
		);
		roots.push(stateRoot);
		mkdirSync(stateRoot);

		// When
		const result = await runUpdateCli(["trajectory", "update", "status"], {
			stateRoot,
			source: {
				resolve: async () => ({ kind: "up_to_date", version: "1.0.0" }),
			},
			builder: { stage: async () => undefined },
			service: {
				activate: async () => undefined,
				rollback: async () => undefined,
			},
		});

		// Then
		expect(result).toEqual({
			status: "update_failed",
			currentVersion: "unknown",
			rolledBack: false,
		});
	});

	test("preserves known local state when the latest-release check fails", async () => {
		// Given
		const stateRoot = installFixture();
		const previousRelease = join(stateRoot, "releases", "0.9.0");
		mkdirSync(previousRelease);
		symlinkSync(previousRelease, join(stateRoot, "previous"));
		writeLastUpdateResult(stateRoot, {
			status: "up_to_date",
			currentVersion: "1.0.0",
		});

		// When
		const result = await runUpdateCli(["trajectory", "update", "status"], {
			stateRoot,
			source: {
				resolve: async () => {
					throw new Error("fixture network failure");
				},
			},
			builder: { stage: async () => undefined },
			service: {
				activate: async () => undefined,
				rollback: async () => undefined,
			},
		});

		// Then
		expect(result).toEqual({
			status: "update_check_failed",
			checked: false,
			errorCode: "release_check_failed",
			currentVersion: "1.0.0",
			previousVersion: "0.9.0",
			lastResult: { status: "up_to_date", currentVersion: "1.0.0" },
		});
	});
});
