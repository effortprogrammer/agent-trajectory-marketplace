import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CollectorServiceError,
  collectServiceLabel,
  collectServicePaths,
  collectWatchServiceStatus,
  installCollectWatchService,
  renderCollectWatchPlist,
  uninstallCollectWatchService,
  type CollectServiceEnvironment,
} from "../../../src/trajectory/collect-service";

const roots: string[] = [];
const temporaryHome = (): string => {
  const root = mkdtempSync(join(tmpdir(), "atm-launchd-"));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

const config = {
  intervalSeconds: 30,
  outDir: "/tmp/out & collected",
  runtimes: ["claude-code", "codex"],
  settleSeconds: 60,
} as const;

const fakeEnvironment = (home: string, responses: boolean[] = []): Readonly<{
  environment: CollectServiceEnvironment;
  calls: string[][];
}> => {
  const calls: string[][] = [];
  return {
    calls,
    environment: {
      entryScriptPath: "/repo/dist/collector.js",
      executablePath: "/opt/bun/bin/bun",
      home,
      platform: "darwin",
      sleep: () => undefined,
      uid: 502,
      workingDirectory: "/repo & source",
      runLaunchctl: (argumentsList) => {
        calls.push([...argumentsList]);
        return { success: responses.shift() ?? true };
      },
      runSystemctl: () => ({ success: false }),
    },
  };
};

const fakeLinuxEnvironment = (home: string, responses: boolean[] = []): Readonly<{
  calls: string[][];
  environment: CollectServiceEnvironment & Readonly<{
    runSystemctl: (argumentsList: readonly string[]) => { readonly success: boolean };
  }>;
}> => {
  const calls: string[][] = [];
  return {
    calls,
    environment: {
      entryScriptPath: "/repo/dist/collector.js",
      executablePath: "/opt/bun/bin/bun",
      home,
      platform: "linux",
      sleep: () => undefined,
      uid: 1000,
      workingDirectory: "/repo & source",
      runLaunchctl: () => ({ success: false }),
      runSystemctl: (argumentsList) => {
        calls.push([...argumentsList]);
        return { success: responses.shift() ?? true };
      },
    },
  };
};

describe("safe launchd collector lifecycle", () => {
  test("renders escaped multi-runtime Bun ProgramArguments", () => {
    // Given: paths and command values containing XML-sensitive characters.
    const paths = collectServicePaths("/Users/example & team");

    // When: the launch agent is rendered.
    const plist = renderCollectWatchPlist({
      config,
      entryScriptPath: "/repo/dist/collector.js",
      executablePath: "/opt/bun/bin/bun",
      paths,
      workingDirectory: "/repo & source",
    });

    // Then: launchd receives a built Bun CLI argv with escaped values and the clean label.
    expect(collectServiceLabel).toBe("com.agent-trajectory-marketplace-clean.collect-watch");
    expect(plist).toContain("<string>/opt/bun/bin/bun</string>");
    expect(plist).toContain("<string>/repo/dist/collector.js</string>");
    expect(plist).toContain("<string>trajectory</string>");
    expect(plist).toContain("<string>collect</string>");
    expect(plist.match(/<string>--runtime<\/string>/g)).toHaveLength(2);
    expect(plist).toContain("/tmp/out &amp; collected");
    expect(plist).toContain("/repo &amp; source");
    expect(plist).not.toContain("/repo & source</string>");
  });

  test("persists the telemetry endpoint in the launchd service environment", () => {
    // Given: a service installation launched with the approved PostHog configuration.
    const home = temporaryHome();
    const fake = fakeEnvironment(home);
    const environment = {
      ...fake.environment,
      telemetryEnvironmentVariables: {
        ATM_POSTHOG_API_KEY: "phc_test",
        ATM_POSTHOG_HOST: "https://eu.i.posthog.com",
      },
    };

    // When: the launchd service is rendered without writing it.
    const preview = installCollectWatchService({ config, dryRun: true, environment });

    // Then: the background collector inherits only its PostHog endpoint settings.
    expect(preview).toHaveProperty("plist", expect.stringContaining("ATM_POSTHOG_API_KEY"));
    expect(preview).toHaveProperty("plist", expect.stringContaining("https://eu.i.posthog.com"));
  });

  test("keeps dry-run side-effect free and rejects non-Darwin mutation", () => {
    // Given: injectable environments that count every launchctl invocation.
    const home = temporaryHome();
    const dryRun = fakeEnvironment(home);
    const unsupported = fakeEnvironment(home);
    const unsupportedEnvironment = { ...unsupported.environment, platform: "win32" as const };

    // When: a dry run and a real non-Darwin install are requested.
    const preview = installCollectWatchService({ config, dryRun: true, environment: dryRun.environment });
    const install = () => installCollectWatchService({ config, environment: unsupportedEnvironment });

    // Then: preview renders only; unsupported mutation fails before files or commands.
    expect(preview).toMatchObject({ bootstrapped: false, detail: "dry_run" });
    expect(dryRun.calls).toEqual([]);
    expect(unsupported.calls).toEqual([]);
    expect(existsSync(collectServicePaths(home).plistPath)).toBe(false);
    expect(install).toThrow(CollectorServiceError);
    expect(install).toThrow(/service_unsupported_platform/);
    expect(existsSync(collectServicePaths(home).plistPath)).toBe(false);
  });

  test("installs reports and uninstalls through the injected launchctl runner", () => {
    // Given: launchctl reports bootout success, two still-loaded polls, bootstrap success, then status loaded.
    const home = temporaryHome();
    const fake = fakeEnvironment(home, [true, true, true, false, true, true]);

    // When: the service is installed, inspected, and uninstalled twice.
    const installed = installCollectWatchService({ config, environment: fake.environment });
    const status = collectWatchServiceStatus({ environment: fake.environment });
    const firstRemoval = uninstallCollectWatchService({ environment: fake.environment });
    const secondRemoval = uninstallCollectWatchService({ environment: fake.environment });

    // Then: lifecycle state and argument-array command ordering are machine-readable and idempotent.
    expect(installed).toMatchObject({ bootstrapped: true });
    expect(status).toMatchObject({ installed: true, loaded: true, state: "running" });
    expect(firstRemoval).toMatchObject({ removed: true });
    expect(secondRemoval).toMatchObject({ removed: false });
    expect(fake.calls.slice(0, 4)).toEqual([
      ["bootout", `gui/502/${collectServiceLabel}`],
      ["print", `gui/502/${collectServiceLabel}`],
      ["print", `gui/502/${collectServiceLabel}`],
      ["print", `gui/502/${collectServiceLabel}`],
    ]);
    expect(fake.calls[4]).toEqual(["bootstrap", "gui/502", collectServicePaths(home).plistPath]);
    expect(fake.calls[5]).toEqual(["print", `gui/502/${collectServiceLabel}`]);
    expect(existsSync(collectServicePaths(home).plistPath)).toBe(false);
  });

  test("rejects non-Darwin and rolls back bootstrap failure", () => {
    // Given: a Darwin fake whose bootstrap retries all fail.
    const home = temporaryHome();
    const fake = fakeEnvironment(home, [false, false, false, false, false, false]);

    // When: installation exhausts bounded bootstrap retries.
    const install = () => installCollectWatchService({ config, environment: fake.environment });

    // Then: the typed failure leaves no newly written plist behind.
    expect(install).toThrow(CollectorServiceError);
    expect(fake.calls.filter(([command]) => command === "bootstrap")).toHaveLength(4);
    expect(existsSync(collectServicePaths(home).plistPath)).toBe(false);
  });

  test("preflights conflicting configuration without replacing it", () => {
    // Given: an existing plist belonging to the clean label but with different arguments.
    const home = temporaryHome();
    const fake = fakeEnvironment(home);
    const paths = collectServicePaths(home);
    installCollectWatchService({ config, dryRun: true, environment: fake.environment });
    const existing = "existing sentinel plist";
    const directory = paths.plistPath.slice(0, paths.plistPath.lastIndexOf("/"));
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, ".keep"), "", "utf8");
    writeFileSync(paths.plistPath, existing, "utf8");

    // When: install would replace that configuration.
    const install = () => installCollectWatchService({ config, environment: fake.environment });

    // Then: collision is reported before launchctl or mutation.
    expect(install).toThrow(/service_configuration_conflict/);
    expect(fake.calls).toEqual([]);
    expect(readFileSync(paths.plistPath, "utf8")).toBe(existing);
  });

  test("reports absent and installed-stopped states without parsing stdout", () => {
    // Given: an absent service, then a matching installed plist, while launchctl print fails.
    const home = temporaryHome();
    const fake = fakeEnvironment(home, [false, false]);
    const absent = collectWatchServiceStatus({ environment: fake.environment });
    const preview = installCollectWatchService({ config, dryRun: true, environment: fake.environment });
    const paths = collectServicePaths(home);
    mkdirSync(paths.plistPath.slice(0, paths.plistPath.lastIndexOf("/")), { recursive: true });
    if (preview.manager !== "launchd") throw new Error("expected_launchd_preview");
    writeFileSync(paths.plistPath, preview.plist, "utf8");

    // When: status is queried with the plist present but unloaded.
    const stopped = collectWatchServiceStatus({ environment: fake.environment });

    // Then: both states are determined from exit status and filesystem state only.
    expect(absent).toMatchObject({ installed: false, loaded: false, state: "absent" });
    expect(stopped).toMatchObject({ installed: true, loaded: false, state: "stopped" });
  });
});

describe("safe systemd user collector lifecycle", () => {
  test("renders a no-shell multi-runtime Bun ExecStart with absolute paths", () => {
    // Given: a Linux dry run with paths containing systemd-sensitive characters.
    const home = temporaryHome();
    const fake = fakeLinuxEnvironment(home);

    // When: the systemd user service is previewed.
    const preview = installCollectWatchService({ config, dryRun: true, environment: fake.environment });

    // Then: the unit directly invokes the built collector through Bun for every runtime.
    expect(preview).toMatchObject({ bootstrapped: false, detail: "dry_run", manager: "systemd" });
    expect(preview).toHaveProperty("unitPath", join(home, ".config", "systemd", "user", `${collectServiceLabel}.service`));
    expect(preview).toHaveProperty("unit");
    const unit = "unit" in preview ? preview.unit : "";
    expect(unit).toContain("[Service]");
    expect(unit).toContain('ExecStart="/opt/bun/bin/bun" "/repo/dist/collector.js" "trajectory" "collect" "watch"');
    expect(unit.match(/"--runtime"/g)).toHaveLength(2);
    expect(unit).toContain("Restart=always");
    expect(unit).not.toContain("/bin/sh");
    expect(fake.calls).toEqual([]);
  });

  test("persists the telemetry endpoint in the systemd user environment", () => {
    // Given: a Linux service installation launched with the approved PostHog configuration.
    const home = temporaryHome();
    const fake = fakeLinuxEnvironment(home);
    const environment = {
      ...fake.environment,
      telemetryEnvironmentVariables: {
        ATM_POSTHOG_API_KEY: "phc_test",
        ATM_POSTHOG_HOST: "https://eu.i.posthog.com",
      },
    };

    // When: the systemd unit is rendered without writing it.
    const preview = installCollectWatchService({ config, dryRun: true, environment });

    // Then: the background collector inherits the configured telemetry values.
    expect(preview).toHaveProperty("unit", expect.stringContaining("ATM_POSTHOG_API_KEY=phc_test"));
    expect(preview).toHaveProperty("unit", expect.stringContaining("https://eu.i.posthog.com"));
  });

  test("installs reports and uninstalls through exact systemctl user arguments", () => {
    // Given: an injected systemctl runner and a clean Linux user service directory.
    const home = temporaryHome();
    const fake = fakeLinuxEnvironment(home, [true, true, true, true, true]);

    // When: the service is installed, inspected, and uninstalled.
    const installed = installCollectWatchService({ config, environment: fake.environment });
    const status = collectWatchServiceStatus({ environment: fake.environment });
    const removed = uninstallCollectWatchService({ environment: fake.environment });

    // Then: systemd lifecycle commands are arrays, scoped to the user manager, and ordered safely.
    expect(installed).toMatchObject({ bootstrapped: true, detail: "installed", manager: "systemd" });
    expect(status).toMatchObject({ installed: true, loaded: true, manager: "systemd", state: "running" });
    expect(removed).toMatchObject({ detail: "removed", manager: "systemd", removed: true });
    expect(fake.calls).toEqual([
      ["--user", "daemon-reload"],
      ["--user", "enable", "--now", `${collectServiceLabel}.service`],
      ["--user", "is-active", "--quiet", `${collectServiceLabel}.service`],
      ["--user", "disable", "--now", `${collectServiceLabel}.service`],
      ["--user", "daemon-reload"],
    ]);
    expect(existsSync(join(home, ".config", "systemd", "user", `${collectServiceLabel}.service`))).toBe(false);
  });
});
