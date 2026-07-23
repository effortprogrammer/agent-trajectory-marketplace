import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { classifyInstallRoot } from "../../../src/trajectory/install-state";

const temporaryRoots: string[] = [];

const temporaryRoot = (): string => {
  const root = join(tmpdir(), `atm-checkout-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  temporaryRoots.push(root);
  return root;
};

const git = (root: string, args: readonly string[]): void => {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }
};

const initializeCheckout = (root: string): void => {
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "agent-trajectory-marketplace", version: "1.0.0" })}\n`,
    "utf8",
  );
  writeFileSync(join(root, "README.md"), "ATM fixture\n", "utf8");
  git(root, ["init", "-q"]);
  git(root, [
    "remote",
    "add",
    "origin",
    "https://github.com/effortprogrammer/agent-trajectory-marketplace.git",
  ]);
  git(root, ["add", "."]);
  git(root, [
    "-c",
    "user.name=ATM Test",
    "-c",
    "user.email=atm@example.invalid",
    "commit",
    "-qm",
    "fixture",
  ]);
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("classifyInstallRoot", () => {
  test("recognizes only a clean ATM checkout with the expected origin", () => {
    const root = temporaryRoot();
    initializeCheckout(root);

    expect(classifyInstallRoot(root)).toEqual({ kind: "recognized_clean" });
  });

  test("classifies a recognized checkout with worktree changes as dirty", () => {
    const root = temporaryRoot();
    initializeCheckout(root);
    writeFileSync(join(root, "README.md"), "changed\n", "utf8");

    expect(classifyInstallRoot(root).kind).toBe("dirty");
  });

  test("recognizes a clean legacy checkout containing only collected output", () => {
    const root = temporaryRoot();
    initializeCheckout(root);
    mkdirSync(join(root, "collected"));
    writeFileSync(join(root, "collected", "collect-watch-state.json"), "{}\n", "utf8");
    writeFileSync(join(root, "collected", "session.atf.json"), "{}\n", "utf8");

    expect(classifyInstallRoot(root)).toEqual({ kind: "recognized_clean" });
  });

  test("classifies an ATM package without complete Git metadata as partial", () => {
    const root = temporaryRoot();
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify({ name: "agent-trajectory-marketplace", version: "1.0.0" })}\n`,
      "utf8",
    );

    expect(classifyInstallRoot(root).kind).toBe("partial");
  });

  test("classifies a different origin and malformed package as unrecognized", () => {
    const wrongOrigin = temporaryRoot();
    initializeCheckout(wrongOrigin);
    git(wrongOrigin, ["remote", "set-url", "origin", "https://github.com/example/not-atm.git"]);
    const malformed = temporaryRoot();
    writeFileSync(join(malformed, "package.json"), "{not-json}\n", "utf8");

    expect(classifyInstallRoot(wrongOrigin).kind).toBe("unrecognized");
    expect(classifyInstallRoot(malformed).kind).toBe("unrecognized");
  });

  test("does not mutate a dirty checkout while classifying it", () => {
    const root = temporaryRoot();
    initializeCheckout(root);
    const readmePath = join(root, "README.md");
    writeFileSync(readmePath, "keep this change\n", "utf8");
    const namesBefore = readdirSync(root).sort();

    classifyInstallRoot(root);

    expect(readFileSync(readmePath, "utf8")).toBe("keep this change\n");
    expect(readdirSync(root).sort()).toEqual(namesBefore);
  });
});
