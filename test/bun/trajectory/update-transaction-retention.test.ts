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
import { runUpdateTransaction } from "../../../src/trajectory/update-transaction";

const roots: string[] = [];

const fixture = (): Readonly<{ root: string; oldRelease: string }> => {
	const root = join(tmpdir(), `atm-update-retention-${crypto.randomUUID()}`);
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

const update = (root: string) => runUpdateTransaction({
	stateRoot: root,
	source: {
		resolve: async () => ({
			kind: "available" as const,
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
		activate: async () => undefined,
		rollback: async () => undefined,
	},
});

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("release retention", () => {
	test("retains only the prior active release after a successful handover", async () => {
		// Given
		const { root, oldRelease } = fixture();
		const olderRelease = join(root, "releases", "0.9.0");
		mkdirSync(olderRelease);
		symlinkSync(olderRelease, join(root, "previous"));

		// When
		const result = await update(root);

		// Then
		expect(result.status).toBe("updated");
		expect(readlinkSync(join(root, "previous"))).toBe(oldRelease);
		expect(existsSync(olderRelease)).toBe(false);
	});

	test("never deletes an external target from an untrusted previous pointer", async () => {
		// Given
		const { root } = fixture();
		const externalRelease = join(tmpdir(), `atm-external-${crypto.randomUUID()}`);
		roots.push(externalRelease);
		mkdirSync(externalRelease);
		writeFileSync(join(externalRelease, "sentinel"), "keep");
		symlinkSync(externalRelease, join(root, "previous"));

		// When
		await update(root);

		// Then
		expect(existsSync(join(externalRelease, "sentinel"))).toBe(true);
	});

	test("refuses to overwrite a pre-existing verified release directory", async () => {
		// Given
		const { root, oldRelease } = fixture();
		const existingRelease = join(root, "releases", "1.1.0");
		mkdirSync(existingRelease);
		writeFileSync(join(existingRelease, "sentinel"), "keep");

		// When
		const result = await update(root);

		// Then
		expect(result.status).toBe("update_failed");
		expect(readlinkSync(join(root, "current"))).toBe(oldRelease);
		expect(existsSync(join(existingRelease, "sentinel"))).toBe(true);
	});

	test("reports a nonfatal retention warning after a successful handover", async () => {
		// Given
		const { root, oldRelease } = fixture();
		const olderRelease = join(root, "releases", "0.9.0");
		mkdirSync(olderRelease);
		symlinkSync(olderRelease, join(root, "previous"));

		// When
		const result = await runUpdateTransaction({
			stateRoot: root,
			source: {
				resolve: async () => ({
					kind: "available" as const,
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
				activate: async () => undefined,
				rollback: async () => undefined,
			},
			retention: {
				remove: () => {
					throw new Error("fixture cleanup failure");
				},
			},
		});

		// Then
		expect(result).toEqual({
			status: "updated",
			fromVersion: "1.0.0",
			toVersion: "1.1.0",
			retention: "cleanup_failed",
		});
		expect(readlinkSync(join(root, "current"))).toBe(join(root, "releases", "1.1.0"));
		expect(readlinkSync(join(root, "previous"))).toBe(oldRelease);
	});
});
