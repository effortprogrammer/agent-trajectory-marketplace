import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { join } from "node:path";

import { readCurrentVersion } from "../../../src/trajectory/update-pointers";
import {
	createProcessFixture,
	runBuiltUpdate,
} from "./update-process-fixture";

const roots: string[] = [];
const decoder = new TextDecoder();

beforeAll(() => {
	const build = Bun.spawnSync([process.execPath, "run", "build:collector"], {
		cwd: process.cwd(),
		stderr: "pipe",
		stdout: "pipe",
	});
	if (build.exitCode !== 0) throw new Error(decoder.decode(build.stderr));
}, 30_000);

afterAll(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const parseOutput = (result: ReturnType<typeof runBuiltUpdate>): unknown => {
	expect(result.exitCode).toBe(0);
	expect(decoder.decode(result.stderr)).toBe("");
	return JSON.parse(decoder.decode(result.stdout));
};

describe("built collector update", () => {
	test("verifies, builds, activates, and health-checks a valid release", () => {
		// Given
		const fixture = createProcessFixture();
		roots.push(fixture.root);

		// When
		const output = parseOutput(runBuiltUpdate(fixture));

		// Then
		expect(output).toEqual({ status: "updated", fromVersion: "1.0.0", toVersion: "1.1.0" });
		expect(readCurrentVersion(fixture.root)).toBe("1.1.0");
		expect(readlinkSync(join(fixture.root, "previous"))).toBe(fixture.oldRelease);
		expect(readFileSync(fixture.outputSentinel, "utf8")).toBe("preserve");
		const commands = readFileSync(fixture.serviceLog, "utf8");
		const activation = process.platform === "linux" ? /^--user restart /gm : /^bootstrap /gm;
		const health = process.platform === "linux" ? /^--user is-active /gm : /^print /gm;
		expect(commands.match(activation)?.length).toBe(1);
		expect(commands.match(health)?.length).toBe(2);
	}, 30_000);

	test("rejects a corrupt verified-release archive before build or handover", () => {
		// Given
		const fixture = createProcessFixture();
		roots.push(fixture.root);

		// When
		const output = parseOutput(runBuiltUpdate(fixture, { corrupt: true }));

		// Then
		expect(output).toMatchObject({ status: "update_failed", currentVersion: "1.0.0" });
		expect(readCurrentVersion(fixture.root)).toBe("1.0.0");
		expect(existsSync(fixture.serviceLog)).toBe(false);
		expect(readFileSync(fixture.outputSentinel, "utf8")).toBe("preserve");
	}, 30_000);

	test("keeps the active release when the verified package build fails", () => {
		// Given
		const fixture = createProcessFixture(false);
		roots.push(fixture.root);

		// When
		const output = parseOutput(runBuiltUpdate(fixture));

		// Then
		expect(output).toEqual({
			status: "update_failed",
			currentVersion: "1.0.0",
			attemptedVersion: "1.1.0",
			rolledBack: false,
		});
		expect(readCurrentVersion(fixture.root)).toBe("1.0.0");
		expect(existsSync(fixture.serviceLog)).toBe(false);
	}, 30_000);

	test("restores pointers and the prior service after health failure", () => {
		// Given
		const fixture = createProcessFixture();
		roots.push(fixture.root);

		// When
		const output = parseOutput(runBuiltUpdate(fixture, { healthFails: true }));

		// Then
		expect(output).toEqual({
			status: "update_failed",
			currentVersion: "1.0.0",
			attemptedVersion: "1.1.0",
			rolledBack: true,
		});
		expect(readCurrentVersion(fixture.root)).toBe("1.0.0");
		expect(readFileSync(fixture.priorService, "utf8")).toBe("prior-service");
		expect(readFileSync(fixture.outputSentinel, "utf8")).toBe("preserve");
		expect(existsSync(join(fixture.root, "releases", "1.1.0"))).toBe(false);
	}, 30_000);
});
