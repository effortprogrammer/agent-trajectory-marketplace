import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  defaultManagedStateRoot,
  parseDoctorCommand,
  runDoctorCli,
} from "../../../src/cli/doctor";
import {
  deriveInstallPaths,
  writeInstallState,
} from "../../../src/trajectory/install-state";

const decoder = new TextDecoder();
const roots: string[] = [];

const runCli = (argumentsList: readonly string[]) => Bun.spawnSync(
  [process.execPath, "src/cli/index.ts", ...argumentsList],
  { cwd: process.cwd(), stderr: "pipe", stdout: "pipe" },
);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("doctor CLI", () => {
  test("accepts only canonical and flat doctor commands", () => {
    expect(parseDoctorCommand(["trajectory", "doctor"])).toEqual({ command: "doctor" });
    expect(parseDoctorCommand(["doctor"])).toEqual({ command: "doctor" });
    expect(() => parseDoctorCommand(["trajectory", "doctor", "extra"])).toThrow();
    expect(() => parseDoctorCommand(["doctor", "extra"])).toThrow();
  });

  test("reports an available update with the exact apply command", async () => {
    const result = await runDoctorCli(["trajectory", "doctor"], {
      bunVersion: "1.3.14",
      latestVersion: async () => "1.1.0",
      packageVersion: "1.0.11",
      stateRoot: undefined,
    });

    expect(result).toEqual({
      status: "attention_required",
      version: "1.0.11",
      bunVersion: "1.3.14",
      runtime: { status: "supported", minimumVersion: "1.3.0" },
      installation: { status: "development" },
      update: {
        status: "update_available",
        currentVersion: "1.0.11",
        latestVersion: "1.1.0",
        command: "trajectory update",
      },
    });
  });

  test("keeps a failed release check machine-readable", async () => {
    const result = await runDoctorCli(["doctor"], {
      bunVersion: "1.3.14",
      latestVersion: async () => {
        throw new Error("offline");
      },
      packageVersion: "1.0.11",
      stateRoot: undefined,
    });

    expect(result).toEqual({
      status: "attention_required",
      version: "1.0.11",
      bunVersion: "1.3.14",
      runtime: { status: "supported", minimumVersion: "1.3.0" },
      installation: { status: "development" },
      update: {
        status: "check_failed",
        currentVersion: "1.0.11",
      },
    });
  });

  test("reports an unsupported Bun runtime", async () => {
    const result = await runDoctorCli(["doctor"], {
      bunVersion: "1.2.9",
      latestVersion: async () => "1.0.11",
      packageVersion: "1.0.11",
      stateRoot: undefined,
    });

    expect(result).toEqual({
      status: "attention_required",
      version: "1.0.11",
      bunVersion: "1.2.9",
      runtime: { status: "unsupported", minimumVersion: "1.3.0" },
      installation: { status: "development" },
      update: {
        status: "up_to_date",
        currentVersion: "1.0.11",
        latestVersion: "1.0.11",
      },
    });
  });

  test("discovers and reports a corrupt managed installation", async () => {
    const root = mkdtempSync(join(tmpdir(), "atm-doctor-invalid-"));
    roots.push(root);
    writeFileSync(join(root, "install-state.json"), "{}");
    const stateRoot = defaultManagedStateRoot({
      environment: {},
      executable: join(root, "current", "dist", "collector.js"),
      workingDirectory: tmpdir(),
    });

    expect(stateRoot).toBe(root);
    expect(await runDoctorCli(["doctor"], {
      bunVersion: "1.3.14",
      latestVersion: async () => "1.0.11",
      packageVersion: "1.0.11",
      stateRoot,
    })).toEqual({
      status: "attention_required",
      version: "1.0.11",
      bunVersion: "1.3.14",
      runtime: { status: "supported", minimumVersion: "1.3.0" },
      installation: { status: "invalid", stateRoot: root },
      update: {
        status: "not_checked",
        currentVersion: "1.0.11",
      },
    });
  });

  test("rejects install state bound to a different root", async () => {
    const root = mkdtempSync(join(tmpdir(), "atm-doctor-mismatch-"));
    const other = mkdtempSync(join(tmpdir(), "atm-doctor-other-"));
    roots.push(root, other);
    const release = join(root, "releases", "1.0.11");
    mkdirSync(release, { recursive: true });
    symlinkSync(release, join(root, "current"));
    writeInstallState(deriveInstallPaths(root, "1.0.11"), {
      schemaVersion: 1,
      installRoot: other,
      outputDir: join(root, "collected"),
      service: {
        runtimes: [],
        intervalSeconds: 21_600,
        settleSeconds: 30,
      },
    });

    expect(await runDoctorCli(["doctor"], {
      bunVersion: "1.3.14",
      latestVersion: async () => "1.0.11",
      packageVersion: "1.0.11",
      stateRoot: root,
    })).toMatchObject({
      status: "attention_required",
      installation: { status: "invalid", stateRoot: root },
      update: { status: "not_checked" },
    });
  });

  test("aborts the latest release check with the command", async () => {
    const controller = new AbortController();
    let reportStarted = (): void => {};
    const started = new Promise<void>((resolve) => {
      reportStarted = resolve;
    });
    const result = runDoctorCli(["doctor"], {
      bunVersion: "1.3.14",
      latestVersion: async (signal) =>
        await new Promise<string>((_resolve, reject) => {
          reportStarted();
          signal.addEventListener(
            "abort",
            () => reject(signal.reason),
            { once: true },
          );
        }),
      packageVersion: "1.0.11",
      signal: controller.signal,
      stateRoot: undefined,
    });
    await started;
    controller.abort();

    expect(await result).toMatchObject({
      status: "attention_required",
      update: { status: "check_failed" },
    });
  });

  test("discovers doctor and update help from the real entrypoint", () => {
    const root = runCli(["--help"]);
    const doctor = runCli(["trajectory", "doctor", "--help"]);
    const update = runCli(["trajectory", "update", "--help"]);

    expect(root.exitCode).toBe(0);
    expect(decoder.decode(root.stderr)).toBe("");
    expect(decoder.decode(root.stdout)).toContain("doctor");
    expect(decoder.decode(root.stdout)).toContain("update [status]");

    expect(doctor.exitCode).toBe(0);
    expect(decoder.decode(doctor.stderr)).toBe("");
    expect(decoder.decode(doctor.stdout)).toContain("Usage: trajectory doctor");

    expect(update.exitCode).toBe(0);
    expect(decoder.decode(update.stderr)).toBe("");
    expect(decoder.decode(update.stdout)).toContain("Usage: trajectory update [status]");
  });
});
