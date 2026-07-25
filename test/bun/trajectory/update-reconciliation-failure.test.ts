import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectServicePaths } from "../../../src/trajectory/collect-service";
import {
	deriveInstallPaths,
	type InstallState,
	writeInstallState,
} from "../../../src/trajectory/install-state";
import {
	createPlatformUpdateServiceHandover,
	type UpdateServiceRuntime,
} from "../../../src/trajectory/update-service-handover";
import { runUpdateTransaction } from "../../../src/trajectory/update-transaction";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("same-version reconciliation retryability", () => {
	test("restores stale launchd bytes when bootstrap fails", async () => {
		// Given: a stale launchd service and a bootstrap failure after successful bootout.
		const root = join(tmpdir(), `atm-reconcile-retry-${crypto.randomUUID()}`);
		const home = join(root, "home");
		const staleService = "stale-launchd-service\n";
		const paths = collectServicePaths(home);
		const installPaths = deriveInstallPaths(root, "1.0.2");
		const state: InstallState = {
			schemaVersion: 1,
			installRoot: root,
			outputDir: join(root, "collected"),
			service: { runtimes: [], intervalSeconds: 30, settleSeconds: 60 },
		};
		mkdirSync(installPaths.releaseDir, { recursive: true });
		mkdirSync(join(paths.plistPath, ".."), { recursive: true });
		writeInstallState(installPaths, state);
		writeFileSync(paths.plistPath, staleService);
		symlinkSync(installPaths.releaseDir, installPaths.currentPointer);
		roots.push(root);
		const commands: string[][] = [];
		const responses = [true, false, true, true, true, true];
		const runtime: UpdateServiceRuntime = {
			home,
			platform: "darwin",
			uid: 501,
			run: async (command) => {
				commands.push([...command]);
				return responses.shift() ?? true;
			},
			sleep: async () => undefined,
		};

		// When: same-version reconciliation cannot bootstrap the rendered replacement.
		const result = await runUpdateTransaction({
			stateRoot: root,
			source: { resolve: async () => ({ kind: "up_to_date", version: "1.0.2" }) },
			builder: { stage: async () => undefined },
			service: createPlatformUpdateServiceHandover(runtime),
		});

		// Then: a fresh rollback restarts the stale service and reports the recovered failure.
		expect(result).toEqual({
			status: "update_failed",
			currentVersion: "1.0.2",
			rolledBack: true,
		});
		expect(readFileSync(paths.plistPath, "utf8")).toBe(staleService);
		expect(commands).toEqual([
			["launchctl", "bootout", "gui/501/com.agent-trajectory-marketplace-clean.collect-watch"],
			["launchctl", "bootstrap", "gui/501", paths.plistPath],
			["launchctl", "bootout", "gui/501/com.agent-trajectory-marketplace-clean.collect-watch"],
			["launchctl", "bootstrap", "gui/501", paths.plistPath],
			["launchctl", "print", "gui/501/com.agent-trajectory-marketplace-clean.collect-watch"],
			["launchctl", "print", "gui/501/com.agent-trajectory-marketplace-clean.collect-watch"],
		]);
	});
});
