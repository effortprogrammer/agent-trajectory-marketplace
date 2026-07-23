import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

const ATM_PACKAGE_NAME = "agent-trajectory-marketplace";
const ATM_ORIGINS = new Set([
  "https://github.com/effortprogrammer/agent-trajectory-marketplace",
  "git@github.com:effortprogrammer/agent-trajectory-marketplace",
  "ssh://git@github.com/effortprogrammer/agent-trajectory-marketplace",
]);

const packageIdentitySchema = z.object({
  name: z.literal(ATM_PACKAGE_NAME),
  version: z.string().min(1),
});

export type InstallRootClassification =
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "recognized_clean" }>
  | Readonly<{ kind: "dirty" }>
  | Readonly<{ kind: "partial" }>
  | Readonly<{ kind: "unrecognized" }>;

type GitResult = Readonly<{
  exitCode: number;
  stdout: string;
}>;

const runGit = (root: string, args: readonly string[]): GitResult => {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString().trim(),
  };
};

const hasExpectedPackageIdentity = (root: string): boolean => {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) {
    return false;
  }
  try {
    return packageIdentitySchema.safeParse(JSON.parse(readFileSync(packagePath, "utf8"))).success;
  } catch (caught: unknown) {
    if (caught instanceof SyntaxError) {
      return false;
    }
    throw caught;
  }
};

const normalizeOrigin = (origin: string): string =>
  origin.endsWith(".git") ? origin.slice(0, -4) : origin.replace(/\/$/, "");

const isCollectorOutput = (statusLine: string): boolean =>
  statusLine.startsWith("?? collected/");

export const classifyInstallRoot = (installRoot: string): InstallRootClassification => {
  if (!existsSync(installRoot)) {
    return { kind: "absent" };
  }
  if (!statSync(installRoot).isDirectory()) {
    return { kind: "unrecognized" };
  }

  const expectedPackage = hasExpectedPackageIdentity(installRoot);
  const gitDirectoryPresent = existsSync(join(installRoot, ".git"));
  if (!gitDirectoryPresent) {
    return expectedPackage ? { kind: "partial" } : { kind: "unrecognized" };
  }

  const repository = runGit(installRoot, ["rev-parse", "--is-inside-work-tree"]);
  const origin = runGit(installRoot, ["config", "--get", "remote.origin.url"]);
  if (repository.exitCode !== 0 || repository.stdout !== "true" || origin.exitCode !== 0) {
    return expectedPackage ? { kind: "partial" } : { kind: "unrecognized" };
  }

  if (!expectedPackage || !ATM_ORIGINS.has(normalizeOrigin(origin.stdout))) {
    return { kind: "unrecognized" };
  }

  const status = runGit(installRoot, ["status", "--porcelain", "--untracked-files=all"]);
  if (status.exitCode !== 0) {
    return { kind: "partial" };
  }
  const meaningfulChanges = status.stdout
    .split("\n")
    .filter((line) => line.length > 0 && !isCollectorOutput(line));
  return meaningfulChanges.length === 0 ? { kind: "recognized_clean" } : { kind: "dirty" };
};
