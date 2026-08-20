import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CollectorRequestError } from "../../../src/cli/collector-error";
import {
  deriveInstallPaths,
  writeInstallState,
} from "../../../src/trajectory/install-state";
import {
  defaultUpdateStateRoot,
  runUpdateCli,
  type UpdateCliDependencies,
} from "../../../src/trajectory/update-cli";

const roots: string[] = [];

const installFixture = (): string => {
  const root = join(tmpdir(), `atm-update-cli-${crypto.randomUUID()}`);
  const release = join(root, "releases", "1.0.0");
  roots.push(root);
  mkdirSync(release, { recursive: true });
  symlinkSync(release, join(root, "current"));
  writeInstallState(deriveInstallPaths(root, "1.0.0"), {
    schemaVersion: 1,
    installRoot: root,
    outputDir: join(root, "collected"),
    service: {
      runtimes: ["codex"],
      intervalSeconds: 30,
      settleSeconds: 60,
    },
  });
  return root;
};

const dependencies = (
  stateRoot: string,
  onResolve: () => void,
): UpdateCliDependencies => ({
  stateRoot,
  source: {
    resolve: async () => {
      onResolve();
      return { kind: "up_to_date", version: "1.0.0" };
    },
  },
  builder: { stage: async () => undefined },
  service: {
    activate: async () => undefined,
    rollback: async () => undefined,
  },
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("async update dispatcher", () => {
  test("discovers the stable state root when the executable runs through current", () => {
    const stateRoot = installFixture();
    const executable = join(stateRoot, "current", "dist", "collector.js");

    expect(defaultUpdateStateRoot({
      executable,
      environment: {},
      workingDirectory: join(stateRoot, "current"),
    })).toBe(stateRoot);
  });

  test("applies the latest verified release from the update command", async () => {
    const stateRoot = installFixture();
    let checked = false;

    expect(await runUpdateCli(
      ["trajectory", "update"],
      dependencies(stateRoot, () => {
        checked = true;
      }),
    )).toEqual({ status: "up_to_date", currentVersion: "1.0.0" });
    expect(checked).toBe(true);
  });

  test("rejects update status without contacting the release source", async () => {
    const stateRoot = installFixture();
    let checked = false;

    await expect(runUpdateCli(
      ["trajectory", "update", "status"],
      dependencies(stateRoot, () => {
        checked = true;
      }),
    )).rejects.toBeInstanceOf(CollectorRequestError);
    expect(checked).toBe(false);
  });
});
