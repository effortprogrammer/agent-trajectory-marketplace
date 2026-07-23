import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  installUpdateServiceSchedule,
  renderUpdateSystemdService,
  updateServiceLabel,
  updateServiceSchedulePaths,
  type UpdateServiceScheduleEnvironment,
} from "../../../src/trajectory/update-service-schedule";

const roots: string[] = [];

const fixtureRoot = (): Readonly<{ home: string; stateRoot: string }> => {
  const root = join(tmpdir(), `atm-update-schedule-${crypto.randomUUID()}`);
  const home = join(root, "home");
  const stateRoot = join(root, "atm");
  mkdirSync(home, { recursive: true });
  roots.push(root);
  return { home, stateRoot };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

const linuxEnvironment = (
  home: string,
  responses: boolean[] = [],
): Readonly<{ environment: UpdateServiceScheduleEnvironment; calls: string[][] }> => {
  const calls: string[][] = [];
  return {
    calls,
    environment: {
      executablePath: "/opt/bun/bin/bun",
      home,
      platform: "linux",
      runLaunchctl: () => ({ success: false }),
      runSystemctl: (argumentsList) => {
        calls.push([...argumentsList]);
        return { success: responses.shift() ?? true };
      },
      uid: 1000,
    },
  };
};

const darwinEnvironment = (
  home: string,
  responses: boolean[] = [],
): Readonly<{ environment: UpdateServiceScheduleEnvironment; calls: string[][] }> => {
  const calls: string[][] = [];
  return {
    calls,
    environment: {
      executablePath: "/opt/homebrew/bin/bun",
      home,
      platform: "darwin",
      runLaunchctl: (argumentsList) => {
        calls.push([...argumentsList]);
        return { success: responses.shift() ?? true };
      },
      runSystemctl: () => ({ success: false }),
      uid: 501,
    },
  };
};

describe("stable automatic update schedule", () => {
	test("escapes systemd specifiers and control characters in updater WorkingDirectory", () => {
		// Given: an absolute state root containing systemd-sensitive path characters.
		const stateRoot = "/home/test/atm%instance\troot";

		// When: the updater unit is rendered.
		const unit = renderUpdateSystemdService({
			executablePath: "/opt/bun/bin/bun",
			stateRoot,
		});

		// Then: WorkingDirectory uses the same unquoted escaping contract as the collector unit.
		expect(unit).toContain("WorkingDirectory=/home/test/atm%%instance\\troot/current");
		expect(unit).not.toContain('WorkingDirectory="');
	});
  test("renders a launchd updater against current every six hours", () => {
    // Given: an installation state root that can change release targets atomically.
    const { home, stateRoot } = fixtureRoot();
    const fake = darwinEnvironment(home);

    // When: the updater agent is previewed.
    const result = installUpdateServiceSchedule({
      dryRun: true,
      environment: fake.environment,
      stateRoot,
    });

    // Then: launchd invokes only the stable current entry point on an exact six-hour interval.
    expect(result).toMatchObject({ detail: "dry_run", installed: false, manager: "launchd" });
    if (result.manager !== "launchd") throw new Error("expected_launchd_schedule");
    expect(result.plist).toContain(`<string>${stateRoot}/current/dist/collector.js</string>`);
    expect(result.plist).toContain("<string>trajectory</string>");
    expect(result.plist).toContain("<string>update</string>");
    expect(result.plist).toContain("<integer>21600</integer>");
    expect(result.plist).toContain(`<string>${stateRoot}</string>`);
    expect(result.plist).not.toContain(`${stateRoot}/releases/`);
    expect(fake.calls).toEqual([]);
  });

  test("renders and enables a systemd user updater timer every six hours", () => {
    // Given: a working Linux user manager.
    const { home, stateRoot } = fixtureRoot();
    const fake = linuxEnvironment(home);

    // When: the schedule is installed.
    const result = installUpdateServiceSchedule({ environment: fake.environment, stateRoot });

    // Then: the service targets current and the timer is enabled only after daemon reload.
    expect(result).toMatchObject({ detail: "installed", installed: true, manager: "systemd" });
    if (result.manager !== "systemd" || result.detail === "user_manager_unavailable") {
      throw new Error("expected_systemd_schedule");
    }
    expect(result.serviceUnit).toContain(`ExecStart="/opt/bun/bin/bun" "${stateRoot}/current/dist/collector.js" "trajectory" "update"`);
    expect(result.serviceUnit).toContain(`Environment="ATM_INSTALL_STATE_ROOT=${stateRoot}"`);
    expect(result.serviceUnit).not.toContain(`${stateRoot}/releases/`);
    expect(result.timerUnit).toContain("OnUnitActiveSec=21600s");
    expect(fake.calls).toEqual([
      ["--user", "show-environment"],
      ["--user", "daemon-reload"],
      ["--user", "enable", "--now", `${updateServiceLabel}.timer`],
    ]);
  });

  test("returns unsupported without filesystem or process mutation when the Linux user manager is unavailable", () => {
    // Given: WSL or Linux where systemctl --user cannot connect to a manager.
    const { home, stateRoot } = fixtureRoot();
    const fake = linuxEnvironment(home, [false]);
    const paths = updateServiceSchedulePaths(home);

    // When: schedule installation is attempted.
    const result = installUpdateServiceSchedule({ environment: fake.environment, stateRoot });

    // Then: one read-only preflight is the only command and no unit directory is created.
    expect(result).toMatchObject({
      detail: "user_manager_unavailable",
      installed: false,
      manager: "systemd",
    });
    expect(fake.calls).toEqual([["--user", "show-environment"]]);
    expect(existsSync(paths.systemdServicePath)).toBe(false);
    expect(existsSync(paths.systemdTimerPath)).toBe(false);
  });

  test("restores prior systemd updater units when activation fails", () => {
    // Given: prior updater units and a manager that fails while enabling the timer.
    const { home, stateRoot } = fixtureRoot();
    const paths = updateServiceSchedulePaths(home);
    mkdirSync(join(paths.systemdServicePath, ".."), { recursive: true });
    writeFileSync(paths.systemdServicePath, "old-service\n", "utf8");
    writeFileSync(paths.systemdTimerPath, "old-timer\n", "utf8");
    const fake = linuxEnvironment(home, [
		true,
		false, true,
		true, true,
		true, false,
		true, true,
		true, true, true, true, true, true,
	]);

    // When: schedule activation fails after files were replaced.
    const install = (): unknown => installUpdateServiceSchedule({ environment: fake.environment, stateRoot });

    // Then: both prior files are restored and systemd is reloaded to observe them.
    expect(install).toThrow("update_schedule_activation_failed");
    expect(readFileSync(paths.systemdServicePath, "utf8")).toBe("old-service\n");
    expect(readFileSync(paths.systemdTimerPath, "utf8")).toBe("old-timer\n");
    expect(fake.calls).toEqual([
      ["--user", "show-environment"],
		["--user", "is-enabled", "--quiet", `${updateServiceLabel}.service`],
		["--user", "is-active", "--quiet", `${updateServiceLabel}.service`],
		["--user", "is-enabled", "--quiet", `${updateServiceLabel}.timer`],
		["--user", "is-active", "--quiet", `${updateServiceLabel}.timer`],
      ["--user", "daemon-reload"],
      ["--user", "enable", "--now", `${updateServiceLabel}.timer`],
		["--user", "disable", "--now", `${updateServiceLabel}.timer`],
		["--user", "stop", `${updateServiceLabel}.service`],
      ["--user", "daemon-reload"],
		["--user", "disable", `${updateServiceLabel}.service`],
		["--user", "start", `${updateServiceLabel}.service`],
		["--user", "enable", `${updateServiceLabel}.timer`],
		["--user", "start", `${updateServiceLabel}.timer`],
    ]);
  });

	test("reports systemd rollback failure after restoring exact prior unit bytes", () => {
		// Given: replacement activation fails and restoring the old active timer also fails.
		const { home, stateRoot } = fixtureRoot();
		const paths = updateServiceSchedulePaths(home);
		mkdirSync(join(paths.systemdServicePath, ".."), { recursive: true });
		writeFileSync(paths.systemdServicePath, "old-service\n", "utf8");
		writeFileSync(paths.systemdTimerPath, "old-timer\n", "utf8");
		const fake = linuxEnvironment(home, [
			true,
			false, false,
			true, true,
			true, false,
			true, true,
			true, true, true, false,
		]);

		// When: schedule installation reaches rollback.
		const install = (): unknown => installUpdateServiceSchedule({ environment: fake.environment, stateRoot });

		// Then: bytes are restored but the caller receives truthful rollback failure.
		expect(install).toThrow("update_schedule_rollback_failed");
		expect(readFileSync(paths.systemdServicePath, "utf8")).toBe("old-service\n");
		expect(readFileSync(paths.systemdTimerPath, "utf8")).toBe("old-timer\n");
	});

  test("restores and reloads the prior launchd updater when activation fails", () => {
    // Given: a prior updater plist and launchd rejecting its replacement.
    const { home, stateRoot } = fixtureRoot();
    const paths = updateServiceSchedulePaths(home);
    mkdirSync(join(paths.launchdPlistPath, ".."), { recursive: true });
    writeFileSync(paths.launchdPlistPath, "old-plist\n", "utf8");
    const fake = darwinEnvironment(home, [true, true, false, true]);

    // When: bootstrapping the replacement fails.
    const install = (): unknown => installUpdateServiceSchedule({ environment: fake.environment, stateRoot });

    // Then: the prior bytes are restored and bootstrapped again.
    expect(install).toThrow("update_schedule_activation_failed");
    expect(readFileSync(paths.launchdPlistPath, "utf8")).toBe("old-plist\n");
    expect(fake.calls).toEqual([
		["print", `gui/501/${updateServiceLabel}`],
      ["bootout", `gui/501/${updateServiceLabel}`],
      ["bootstrap", "gui/501", paths.launchdPlistPath],
      ["bootstrap", "gui/501", paths.launchdPlistPath],
    ]);
  });

	test("reports launchd rollback failure when the prior plist cannot be bootstrapped", () => {
		// Given: an active prior updater whose replacement and restoration both fail bootstrap.
		const { home, stateRoot } = fixtureRoot();
		const paths = updateServiceSchedulePaths(home);
		mkdirSync(join(paths.launchdPlistPath, ".."), { recursive: true });
		writeFileSync(paths.launchdPlistPath, "old-plist\n", "utf8");
		const fake = darwinEnvironment(home, [true, true, false, false]);

		// When: installation tries to restore the prior launch agent.
		const install = (): unknown => installUpdateServiceSchedule({ environment: fake.environment, stateRoot });

		// Then: exact bytes are restored and rollback failure is surfaced.
		expect(install).toThrow("update_schedule_rollback_failed");
		expect(readFileSync(paths.launchdPlistPath, "utf8")).toBe("old-plist\n");
	});

  test("is idempotent when generated updater files already match", () => {
    // Given: one successful updater installation.
    const { home, stateRoot } = fixtureRoot();
    const first = linuxEnvironment(home);
    installUpdateServiceSchedule({ environment: first.environment, stateRoot });
    const serviceBefore = readFileSync(updateServiceSchedulePaths(home).systemdServicePath, "utf8");
    const timerBefore = readFileSync(updateServiceSchedulePaths(home).systemdTimerPath, "utf8");
    const second = linuxEnvironment(home);

    // When: installation runs again with the same stable state root.
    const result = installUpdateServiceSchedule({ environment: second.environment, stateRoot });

    // Then: activation succeeds and the canonical unit bytes remain unchanged.
    expect(result).toMatchObject({ detail: "installed", installed: true });
    expect(readFileSync(updateServiceSchedulePaths(home).systemdServicePath, "utf8")).toBe(serviceBefore);
    expect(readFileSync(updateServiceSchedulePaths(home).systemdTimerPath, "utf8")).toBe(timerBefore);
  });
});
