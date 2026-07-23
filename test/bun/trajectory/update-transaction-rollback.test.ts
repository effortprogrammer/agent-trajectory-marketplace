import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
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
import { runUpdateTransaction } from "../../../src/trajectory/update-transaction";

const roots: string[] = [];

const installFixture = (): Readonly<{ root: string; oldRelease: string }> => {
	const root = join(tmpdir(), `atm-update-rollback-${crypto.randomUUID()}`);
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

afterEach(() => {
	mock.restore();
	for (const root of roots.splice(0))
		rmSync(root, { force: true, recursive: true });
});

describe("failed activation rollback", () => {
	test("retries a colliding rollback pointer replacement before removing the failed release", async () => {
		// Given
		const { root, oldRelease } = installFixture();
		const collisionId = "00000000-0000-4000-8000-000000000000";
		const collision = join(root, `.pointer-${collisionId}`);
		let rollbackCalls = 0;

		// When
		const result = await runUpdateTransaction({
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
				activate: async () => {
					writeFileSync(collision, "occupied");
					spyOn(crypto, "randomUUID").mockReturnValueOnce(collisionId);
					throw new Error("fixture activation failure");
				},
				rollback: async () => {
					rollbackCalls += 1;
				},
			},
		});

		// Then
		expect(result).toMatchObject({ status: "update_failed", rolledBack: true });
		expect(readlinkSync(join(root, "current"))).toBe(oldRelease);
		expect(existsSync(join(root, "releases", "1.1.0"))).toBe(false);
		expect(rollbackCalls).toBe(1);
	});

	test("retains the target of current when pointer restoration cannot complete", async () => {
		// Given
		const { root } = installFixture();
		const collisionId = "00000000-0000-4000-8000-000000000000";
		const collision = join(root, `.pointer-${collisionId}`);
		let rollbackCalls = 0;

		// When
		const result = await runUpdateTransaction({
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
				activate: async () => {
					writeFileSync(collision, "occupied");
					spyOn(crypto, "randomUUID").mockReturnValue(collisionId);
					throw new Error("fixture activation failure");
				},
				rollback: async () => {
					rollbackCalls += 1;
				},
			},
		});

		// Then
		expect(result).toMatchObject({ status: "update_failed", rolledBack: false });
		const currentTarget = readlinkSync(join(root, "current"));
		expect(currentTarget).toBe(join(root, "releases", "1.1.0"));
		expect(existsSync(currentTarget)).toBe(true);
		expect(rollbackCalls).toBe(0);
	});
});
