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

import {
	collectServiceLabel,
	collectServicePaths,
	renderCollectWatchPlist,
} from "../../../src/trajectory/collect-service";
import { collectSystemdServicePaths } from "../../../src/trajectory/collect-service-systemd";
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

const stateFor = (root: string, runtimes: readonly string[]): InstallState => ({
	schemaVersion: 1,
	installRoot: root,
	outputDir: join(root, "collected"),
	service: { runtimes, intervalSeconds: 30, settleSeconds: 60 },
});

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("same-version service reconciliation", () => {
	test("skips a byte-identical explicit launchd service without restart commands", async () => {
		// Given: an explicit codex launchd plist whose bytes already match the current state.
		const root = join(tmpdir(), `atm-reconcile-launchd-current-${crypto.randomUUID()}`);
		const home = join(root, "home");
		const state = stateFor(root, ["codex"]);
		const paths = collectServicePaths(home);
		mkdirSync(join(paths.plistPath, ".."), { recursive: true });
		writeFileSync(
			paths.plistPath,
			renderCollectWatchPlist({
				config: {
					runtimes: state.service.runtimes,
					outDir: state.outputDir,
					intervalSeconds: state.service.intervalSeconds,
					settleSeconds: state.service.settleSeconds,
				},
				entryScriptPath: join(root, "current", "dist", "collector.js"),
				executablePath: process.execPath,
				paths,
				workingDirectory: join(root, "current"),
			}),
		);
		roots.push(root);
		const commands: string[][] = [];
		const runtime: UpdateServiceRuntime = {
			home,
			platform: "darwin",
			uid: 501,
			run: async (command) => {
				commands.push([...command]);
				return true;
			},
			sleep: async () => undefined,
		};

		// When: the current release reconciles its unchanged service definition.
		await createPlatformUpdateServiceHandover(runtime).activate({
			fromVersion: "1.0.2",
			toVersion: "1.0.2",
			installState: state,
			signal: new AbortController().signal,
		});

		// Then: launchd is left running because no byte replacement was necessary.
		expect(commands).toEqual([]);
	});

	test("replaces and restarts a stale all-runtimes launchd service during same-version reconciliation", async () => {
		// Given: a stale launchd plist for a service that should follow all runtimes.
		const root = join(tmpdir(), `atm-reconcile-launchd-stale-${crypto.randomUUID()}`);
		const home = join(root, "home");
		const state = stateFor(root, []);
		const paths = collectServicePaths(home);
		mkdirSync(join(paths.plistPath, ".."), { recursive: true });
		writeFileSync(paths.plistPath, "stale-launchd-service\n");
		const installPaths = deriveInstallPaths(root, "1.0.2");
		mkdirSync(installPaths.releaseDir, { recursive: true });
		writeInstallState(installPaths, state);
		symlinkSync(installPaths.releaseDir, installPaths.currentPointer);
		roots.push(root);
		const commands: string[][] = [];
		const runtime: UpdateServiceRuntime = {
			home,
			platform: "darwin",
			uid: 501,
			run: async (command) => {
				commands.push([...command]);
				return true;
			},
			sleep: async () => undefined,
		};

		// When: an update check confirms that the current release needs no download.
		await runUpdateTransaction({
			stateRoot: root,
			source: { resolve: async () => ({ kind: "up_to_date", version: "1.0.2" }) },
			builder: { stage: async () => undefined },
			service: createPlatformUpdateServiceHandover(runtime),
		});

		// Then: launchd receives a restart and the replacement leaves runtime selection dynamic.
		expect(readFileSync(paths.plistPath, "utf8")).not.toBe("stale-launchd-service\n");
		expect(readFileSync(paths.plistPath, "utf8")).not.toContain("--runtime");
		expect(commands).toEqual([
			["launchctl", "bootout", `gui/501/${collectServiceLabel}`],
			["launchctl", "bootstrap", "gui/501", paths.plistPath],
			["launchctl", "print", `gui/501/${collectServiceLabel}`],
			["launchctl", "print", `gui/501/${collectServiceLabel}`],
		]);
	});

	test("replaces and restarts a stale all-runtimes systemd service during same-version reconciliation", async () => {
		// Given: a stale systemd unit for a service that should follow all runtimes.
		const root = join(tmpdir(), `atm-reconcile-systemd-stale-${crypto.randomUUID()}`);
		const home = join(root, "home");
		const state = stateFor(root, []);
		const paths = collectSystemdServicePaths(home, collectServiceLabel);
		mkdirSync(join(paths.unitPath, ".."), { recursive: true });
		writeFileSync(paths.unitPath, "stale-systemd-service\n");
		const installPaths = deriveInstallPaths(root, "1.0.2");
		mkdirSync(installPaths.releaseDir, { recursive: true });
		writeInstallState(installPaths, state);
		symlinkSync(installPaths.releaseDir, installPaths.currentPointer);
		roots.push(root);
		const commands: string[][] = [];
		const runtime: UpdateServiceRuntime = {
			home,
			platform: "linux",
			uid: 1000,
			run: async (command) => {
				commands.push([...command]);
				return true;
			},
			sleep: async () => undefined,
		};

		// When: an update check confirms that the current release needs no download.
		await runUpdateTransaction({
			stateRoot: root,
			source: { resolve: async () => ({ kind: "up_to_date", version: "1.0.2" }) },
			builder: { stage: async () => undefined },
			service: createPlatformUpdateServiceHandover(runtime),
		});

		// Then: systemd reloads and restarts the dynamic all-runtimes replacement.
		expect(readFileSync(paths.unitPath, "utf8")).not.toBe("stale-systemd-service\n");
		expect(readFileSync(paths.unitPath, "utf8")).not.toContain("--runtime");
		expect(commands).toEqual([
			["systemctl", "--user", "daemon-reload"],
			["systemctl", "--user", "restart", `${collectServiceLabel}.service`],
			["systemctl", "--user", "is-active", "--quiet", `${collectServiceLabel}.service`],
			["systemctl", "--user", "is-active", "--quiet", `${collectServiceLabel}.service`],
		]);
	});
});
