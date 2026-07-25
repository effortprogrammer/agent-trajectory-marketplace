import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	deriveInstallPaths,
	writeInstallState,
} from "../../../src/trajectory/install-state";
import {
	runUpdateTransaction,
	type UpdateBuilder,
	type UpdateReleaseSource,
	type UpdateServiceHandover,
} from "../../../src/trajectory/update-transaction";

const roots: string[] = [];

const fixture = (): Readonly<{ root: string; oldRelease: string }> => {
	const root = join(tmpdir(), `atm-update-${crypto.randomUUID()}`);
	const oldRelease = join(root, "releases", "1.0.0");
	mkdirSync(oldRelease, { recursive: true });
	symlinkSync(oldRelease, join(root, "current"));
	writeInstallState(deriveInstallPaths(root, "1.0.0"), {
		schemaVersion: 1,
		installRoot: root,
		outputDir: join(root, "collected"),
		service: { runtimes: ["codex"], intervalSeconds: 30, settleSeconds: 60 },
	});
	roots.push(root);
	return { root, oldRelease };
};

const availableSource = (calls: number[]): UpdateReleaseSource => ({
	resolve: async (request) => {
		calls.push(request.timeoutMs);
		return {
			kind: "available",
			version: "1.1.0",
			archive: new Uint8Array([1, 2, 3]),
		};
	},
});

afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { force: true, recursive: true });
});

describe("serialized update transaction", () => {
	test("switches current and previous only after a verified build and service handover", async () => {
		// Given
		const { root, oldRelease } = fixture();
		const sourceTimeouts: number[] = [];
		const buildTimeouts: number[] = [];
		const handovers: string[] = [];
		const builder: UpdateBuilder = {
			stage: async (request) => {
				buildTimeouts.push(request.timeoutMs);
				mkdirSync(request.stagingDir, { recursive: true });
				writeFileSync(join(request.stagingDir, "built"), request.archive);
			},
		};
		const service: UpdateServiceHandover = {
			activate: async ({ toVersion }) => {
				handovers.push(toVersion);
			},
			rollback: async () => undefined,
		};

		// When
		const result = await runUpdateTransaction({
			stateRoot: root,
			source: availableSource(sourceTimeouts),
			builder,
			service,
		});

		// Then
		expect(result).toEqual({
			status: "updated",
			fromVersion: "1.0.0",
			toVersion: "1.1.0",
		});
		expect(readlinkSync(join(root, "current"))).toBe(
			join(root, "releases", "1.1.0"),
		);
		expect(readlinkSync(join(root, "previous"))).toBe(oldRelease);
		expect(sourceTimeouts).toEqual([60_000]);
		expect(buildTimeouts).toEqual([180_000]);
		expect(handovers).toEqual(["1.1.0"]);
	});

	test("returns a no-op without staging or handing over when already current", async () => {
		// Given
		const { root } = fixture();
		let staged = false;
		const source: UpdateReleaseSource = {
			resolve: async () => ({ kind: "up_to_date", version: "1.0.0" }),
		};
		const builder: UpdateBuilder = {
			stage: async () => {
				staged = true;
			},
		};

		// When
		const result = await runUpdateTransaction({
			stateRoot: root,
			source,
			builder,
			service: {
				activate: async () => undefined,
				rollback: async () => undefined,
			},
		});

		// Then
		expect(result).toEqual({ status: "up_to_date", currentVersion: "1.0.0" });
		expect(staged).toBe(false);
		expect(existsSync(join(root, "previous"))).toBe(false);
	});

	test("reconciles a normalized legacy service when already current", async () => {
		// Given: a raw v1.0.2 state from the five-runtime installer snapshot.
		const root = join(tmpdir(), `atm-update-legacy-${crypto.randomUUID()}`);
		const currentRelease = join(root, "releases", "1.0.2");
		mkdirSync(currentRelease, { recursive: true });
		symlinkSync(currentRelease, join(root, "current"));
		writeFileSync(
			deriveInstallPaths(root, "1.0.2").stateFile,
			`${JSON.stringify({
				schemaVersion: 1,
				installRoot: root,
				outputDir: join(root, "collected"),
				service: { runtimes: ["claude-code", "codex", "hermes", "openclaw", "opencode"], intervalSeconds: 30, settleSeconds: 60 },
			})}\n`,
		);
		roots.push(root);
		const requests: Array<Readonly<{ fromVersion: string; toVersion: string; runtimes: readonly string[] }>> = [];

		// When: an update check confirms that the installed release is current.
		const result = await runUpdateTransaction({
			stateRoot: root,
			source: { resolve: async () => ({ kind: "up_to_date", version: "1.0.2" }) },
			builder: { stage: async () => undefined },
			service: {
				activate: async ({ fromVersion, toVersion, installState }) => {
					requests.push({
						fromVersion,
						toVersion,
						runtimes: installState.service.runtimes,
					});
				},
				rollback: async () => undefined,
			},
		});

		// Then: the normalizer reaches a same-version reconciliation handover.
		expect(result).toEqual({ status: "up_to_date", currentVersion: "1.0.2" });
		expect(requests).toEqual([
			{ fromVersion: "1.0.2", toVersion: "1.0.2", runtimes: [] },
		]);
	});

	test("restores both pointers and invokes rollback when service activation fails", async () => {
		// Given
		const { root, oldRelease } = fixture();
		const olderRelease = join(root, "releases", "0.9.0");
		mkdirSync(olderRelease);
		symlinkSync(olderRelease, join(root, "previous"));
		const rollbacks: string[] = [];
		const builder: UpdateBuilder = {
			stage: async ({ stagingDir }) => {
				mkdirSync(stagingDir, { recursive: true });
			},
		};
		const service: UpdateServiceHandover = {
			activate: async () => {
				throw new Error("fixture activation failure");
			},
			rollback: async ({ toVersion }) => {
				rollbacks.push(toVersion);
			},
		};

		// When
		const result = await runUpdateTransaction({
			stateRoot: root,
			source: availableSource([]),
			builder,
			service,
		});

		// Then
		expect(result).toEqual({
			status: "update_failed",
			currentVersion: "1.0.0",
			attemptedVersion: "1.1.0",
			rolledBack: true,
		});
		expect(readlinkSync(join(root, "current"))).toBe(oldRelease);
		expect(readlinkSync(join(root, "previous"))).toBe(olderRelease);
		expect(rollbacks).toEqual(["1.0.0"]);
	});

	test("reports concurrent ownership and never calls the source", async () => {
		// Given
		const { root } = fixture();
		const paths = deriveInstallPaths(root, "1.0.0");
		writeFileSync(
			paths.lockFile,
			`${JSON.stringify({ schemaVersion: 1, pid: process.pid, createdAtMs: Date.now(), token: crypto.randomUUID() })}\n`,
		);
		let resolved = false;

		// When
		const result = await runUpdateTransaction({
			stateRoot: root,
			source: {
				resolve: async () => {
					resolved = true;
					return { kind: "up_to_date", version: "1.0.0" };
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
			status: "update_already_running",
			currentVersion: "1.0.0",
		});
		expect(resolved).toBe(false);
	});

	test("cleans staging and releases the lock when interrupted during build", async () => {
		// Given
		const { root } = fixture();
		const controller = new AbortController();
		const builder: UpdateBuilder = {
			stage: async ({ stagingDir, signal }) => {
				mkdirSync(stagingDir, { recursive: true });
				controller.abort();
				await new Promise<void>((resolve, reject) => {
					signal.addEventListener("abort", () => reject(signal.reason), {
						once: true,
					});
					if (signal.aborted) reject(signal.reason);
					else resolve();
				});
			},
		};

		// When
		const result = await runUpdateTransaction({
			stateRoot: root,
			source: availableSource([]),
			builder,
			service: {
				activate: async () => undefined,
				rollback: async () => undefined,
			},
			signal: controller.signal,
		});

		// Then
		expect(result).toMatchObject({
			status: "update_failed",
			currentVersion: "1.0.0",
		});
		expect(existsSync(join(root, "update.lock"))).toBe(false);
		expect(
			Array.from(
				new Bun.Glob(".update-stage-*").scanSync(join(root, "releases")),
			),
		).toEqual([]);
	});
});
