import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	collectServiceLabel,
	collectServicePaths,
} from "../../../src/trajectory/collect-service";
import { collectSystemdServicePaths } from "../../../src/trajectory/collect-service-systemd";
import type { InstallState } from "../../../src/trajectory/install-state";
import {
	createPlatformUpdateServiceHandover,
	type UpdateServiceRuntime,
} from "../../../src/trajectory/update-service-handover";

const roots: string[] = [];

const fixture = (): Readonly<{ home: string; state: InstallState; unitPath: string }> => {
	const root = join(tmpdir(), `atm-update-service-${crypto.randomUUID()}`);
	const home = join(root, "home");
	const unitPath = collectSystemdServicePaths(home, collectServiceLabel).unitPath;
	mkdirSync(join(root, "current", "dist"), { recursive: true });
	mkdirSync(join(unitPath, ".."), { recursive: true });
	writeFileSync(unitPath, "old-unit\n");
	roots.push(root);
	return {
		home,
		unitPath,
		state: {
			schemaVersion: 1,
			installRoot: root,
			outputDir: join(root, "collected"),
			service: {
				runtimes: ["codex"],
				intervalSeconds: 30,
				settleSeconds: 60,
			},
		},
	};
};

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("platform update service handover", () => {
	test("rewrites and restarts systemd then checks health at two and ten seconds", async () => {
		// Given
		const { home, state, unitPath } = fixture();
		const commands: string[][] = [];
		const delays: number[] = [];
		const runtime: UpdateServiceRuntime = {
			home,
			platform: "linux",
			uid: 1000,
			run: async (command) => {
				commands.push([...command]);
				return true;
			},
			sleep: async (milliseconds) => {
				delays.push(milliseconds);
			},
		};
		const handover = createPlatformUpdateServiceHandover(runtime);

		// When
		await handover.activate({
			fromVersion: "1.0.0",
			toVersion: "1.1.0",
			installState: state,
			signal: new AbortController().signal,
		});

		// Then
		expect(commands).toEqual([
			["systemctl", "--user", "daemon-reload"],
			["systemctl", "--user", "restart", `${collectServiceLabel}.service`],
			["systemctl", "--user", "is-active", "--quiet", `${collectServiceLabel}.service`],
			["systemctl", "--user", "is-active", "--quiet", `${collectServiceLabel}.service`],
		]);
		expect(delays).toEqual([2_000, 8_000]);
		expect(readFileSync(unitPath, "utf8")).toContain(`${state.installRoot}/current/dist/collector.js`);
	});

	test("rewrites an all-runtimes service without pinning runtime flags", async () => {
		// Given: install state whose empty runtime list means "follow the registry".
		const { home, state, unitPath } = fixture();
		const allRuntimesState: InstallState = {
			...state,
			service: { ...state.service, runtimes: [] },
		};
		const handover = createPlatformUpdateServiceHandover({
			home,
			platform: "linux",
			uid: 1000,
			run: async () => true,
			sleep: async () => undefined,
		});

		// When: an update activates the new release.
		await handover.activate({
			fromVersion: "1.0.0",
			toVersion: "1.1.0",
			installState: allRuntimesState,
			signal: new AbortController().signal,
		});

		// Then: the rewritten unit carries no --runtime flags, so adapters shipped
		// by this or any later release are collected after the restart.
		const unit = readFileSync(unitPath, "utf8");
		expect(unit).toContain("watch");
		expect(unit).not.toContain("--runtime");
	});

	test("preserves every PostHog telemetry environment value in a rewritten systemd unit", async () => {
		// Given: the installed collector has telemetry values that are unavailable to the updater process.
		const { home, state, unitPath } = fixture();
		writeFileSync(unitPath, [
			"[Service]",
			'Environment="ATM_POSTHOG_API_KEY=phc_existing"',
			'Environment="ATM_POSTHOG_HOST=https://eu.i.posthog.com"',
			'Environment="ATM_POSTHOG_FUTURE=value%%with\\tcontrol"',
			'Environment="ATM_POSTHOG_LITERAL=slash\\\\ttext"',
			'Environment="UNRELATED=value"',
			"",
		].join("\n"));
		const handover = createPlatformUpdateServiceHandover({
			home,
			platform: "linux",
			uid: 1000,
			run: async () => true,
			sleep: async () => undefined,
		});

		// When: the update switches the collector service to the stable current pointer.
		await handover.activate({
			fromVersion: "1.0.0",
			toVersion: "1.1.0",
			installState: state,
			signal: new AbortController().signal,
		});

		// Then: every PostHog setting survives and unrelated environment is not copied.
		const rewritten = readFileSync(unitPath, "utf8");
		expect(rewritten).toContain('Environment="ATM_POSTHOG_API_KEY=phc_existing"');
		expect(rewritten).toContain('Environment="ATM_POSTHOG_HOST=https://eu.i.posthog.com"');
		expect(rewritten).toContain('Environment="ATM_POSTHOG_FUTURE=value%%with\\tcontrol"');
		expect(rewritten).toContain('Environment="ATM_POSTHOG_LITERAL=slash\\\\ttext"');
		expect(rewritten).not.toContain("UNRELATED");
	});

	test("restores the prior unit and restarts the old collector during rollback", async () => {
		// Given
		const { home, state, unitPath } = fixture();
		const runtime: UpdateServiceRuntime = {
			home,
			platform: "linux",
			uid: 1000,
			run: async () => true,
			sleep: async () => undefined,
		};
		const handover = createPlatformUpdateServiceHandover(runtime);
		await handover.activate({
			fromVersion: "1.0.0",
			toVersion: "1.1.0",
			installState: state,
			signal: new AbortController().signal,
		});

		// When
		await handover.rollback({
			fromVersion: "1.1.0",
			toVersion: "1.0.0",
			installState: state,
			signal: new AbortController().signal,
		});

		// Then
		expect(readFileSync(unitPath, "utf8")).toBe("old-unit\n");
	});

	test("restores the prior unit after the new collector restart fails", async () => {
		// Given: activation can reload systemd but cannot restart the new collector.
		const { home, state, unitPath } = fixture();
		const commands: string[][] = [];
		const responses = [true, false, true, true, true, true];
		const handover = createPlatformUpdateServiceHandover({
			home,
			platform: "linux",
			uid: 1000,
			run: async (command) => {
				commands.push([...command]);
				return responses.shift() ?? true;
			},
			sleep: async () => undefined,
		});
		const request = {
			fromVersion: "1.0.0",
			toVersion: "1.1.0",
			installState: state,
			signal: new AbortController().signal,
		};

		// When: the transaction-facing handover restores the prior service after failure.
		await expect(handover.activate(request)).rejects.toThrow(
			"collector_service_command_failed",
		);
		await handover.rollback({
			...request,
			fromVersion: request.toVersion,
			toVersion: request.fromVersion,
		});

		// Then: rollback reloads before restart and the original unit is active again.
		expect(readFileSync(unitPath, "utf8")).toBe("old-unit\n");
		expect(commands).toEqual([
			["systemctl", "--user", "daemon-reload"],
			["systemctl", "--user", "restart", `${collectServiceLabel}.service`],
			["systemctl", "--user", "daemon-reload"],
			["systemctl", "--user", "restart", `${collectServiceLabel}.service`],
			["systemctl", "--user", "is-active", "--quiet", `${collectServiceLabel}.service`],
			["systemctl", "--user", "is-active", "--quiet", `${collectServiceLabel}.service`],
		]);
	});

	test("rejects activation when either bounded health check is not running", async () => {
		// Given
		const { home, state } = fixture();
		let healthChecks = 0;
		const handover = createPlatformUpdateServiceHandover({
			home,
			platform: "linux",
			uid: 1000,
			run: async (command) => {
				if (command.includes("is-active")) {
					healthChecks += 1;
					return healthChecks < 2;
				}
				return true;
			},
			sleep: async () => undefined,
		});

		// When / Then
		await expect(handover.activate({
			fromVersion: "1.0.0",
			toVersion: "1.1.0",
			installState: state,
			signal: new AbortController().signal,
		})).rejects.toThrow("collector_service_unhealthy");
		expect(healthChecks).toBe(2);
	});

	test("reboots launchd and checks the collector at two and ten seconds", async () => {
		// Given
		const root = join(tmpdir(), `atm-update-launchd-${crypto.randomUUID()}`);
		const home = join(root, "home");
		const paths = collectServicePaths(home);
		mkdirSync(join(paths.plistPath, ".."), { recursive: true });
		writeFileSync(paths.plistPath, "old-plist\n");
		roots.push(root);
		const state: InstallState = {
			schemaVersion: 1,
			installRoot: root,
			outputDir: join(root, "collected"),
			service: {
				runtimes: ["claude-code", "codex"],
				intervalSeconds: 30,
				settleSeconds: 60,
			},
		};
		const commands: string[][] = [];
		const delays: number[] = [];
		const handover = createPlatformUpdateServiceHandover({
			home,
			platform: "darwin",
			uid: 501,
			run: async (command) => {
				commands.push([...command]);
				return true;
			},
			sleep: async (milliseconds) => {
				delays.push(milliseconds);
			},
		});

		// When
		await handover.activate({
			fromVersion: "1.0.0",
			toVersion: "1.1.0",
			installState: state,
			signal: new AbortController().signal,
		});

		// Then
		expect(commands).toEqual([
			["launchctl", "bootout", `gui/501/${collectServiceLabel}`],
			["launchctl", "bootstrap", "gui/501", paths.plistPath],
			["launchctl", "print", `gui/501/${collectServiceLabel}`],
			["launchctl", "print", `gui/501/${collectServiceLabel}`],
		]);
		expect(delays).toEqual([2_000, 8_000]);
		expect(readFileSync(paths.plistPath, "utf8")).toContain(
			`<string>${root}/current/dist/collector.js</string>`,
		);
	});

	test("preserves every PostHog telemetry environment value in a rewritten launchd plist", async () => {
		// Given: an existing launch agent with telemetry values containing XML-sensitive data.
		const root = join(tmpdir(), `atm-update-launchd-env-${crypto.randomUUID()}`);
		const home = join(root, "home");
		const paths = collectServicePaths(home);
		mkdirSync(join(paths.plistPath, ".."), { recursive: true });
		writeFileSync(paths.plistPath, [
			"<plist><dict><key>EnvironmentVariables</key><dict>",
			"<key>ATM_POSTHOG_API_KEY</key><string>phc_existing</string>",
			"<key>ATM_POSTHOG_FUTURE</key><string>a&amp;b&lt;c</string>",
			"<key>UNRELATED</key><string>value</string>",
			"</dict></dict></plist>",
		].join(""));
		roots.push(root);
		const state: InstallState = {
			schemaVersion: 1,
			installRoot: root,
			outputDir: join(root, "collected"),
			service: { runtimes: ["codex"], intervalSeconds: 30, settleSeconds: 60 },
		};
		const handover = createPlatformUpdateServiceHandover({
			home,
			platform: "darwin",
			uid: 501,
			run: async () => true,
			sleep: async () => undefined,
		});

		// When: the collector launch agent is rewritten.
		await handover.activate({
			fromVersion: "1.0.0",
			toVersion: "1.1.0",
			installState: state,
			signal: new AbortController().signal,
		});

		// Then: PostHog values survive with correct XML escaping.
		const rewritten = readFileSync(paths.plistPath, "utf8");
		expect(rewritten).toContain("<key>ATM_POSTHOG_API_KEY</key>");
		expect(rewritten).toContain("<string>phc_existing</string>");
		expect(rewritten).toContain("<key>ATM_POSTHOG_FUTURE</key>");
		expect(rewritten).toContain("<string>a&amp;b&lt;c</string>");
		expect(rewritten).not.toContain("UNRELATED");
	});

	test("surfaces launchd rollback failure when the prior collector cannot be bootstrapped", async () => {
		// Given: activation succeeds, but launchd rejects the restored prior collector plist.
		const root = join(tmpdir(), `atm-update-launchd-rollback-${crypto.randomUUID()}`);
		const home = join(root, "home");
		const paths = collectServicePaths(home);
		mkdirSync(join(paths.plistPath, ".."), { recursive: true });
		writeFileSync(paths.plistPath, "old-plist\n");
		roots.push(root);
		const responses = [true, true, true, true, true, false];
		const state: InstallState = {
			schemaVersion: 1,
			installRoot: root,
			outputDir: join(root, "collected"),
			service: { runtimes: ["codex"], intervalSeconds: 30, settleSeconds: 60 },
		};
		const handover = createPlatformUpdateServiceHandover({
			home,
			platform: "darwin",
			uid: 501,
			run: async () => responses.shift() ?? true,
			sleep: async () => undefined,
		});
		const request = {
			fromVersion: "1.0.0",
			toVersion: "1.1.0",
			installState: state,
			signal: new AbortController().signal,
		};
		await handover.activate(request);

		// When: rollback restores the previous plist but cannot bootstrap it.
		const rollback = handover.rollback({
			...request,
			fromVersion: request.toVersion,
			toVersion: request.fromVersion,
		});

		// Then: exact prior bytes remain and the bootstrap failure is visible to the transaction.
		await expect(rollback).rejects.toThrow("collector_service_command_failed");
		expect(readFileSync(paths.plistPath, "utf8")).toBe("old-plist\n");
	});
});
