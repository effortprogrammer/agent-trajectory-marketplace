import { createHash } from "node:crypto";
import { lstatSync, statSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { TrajectoryAdapterError } from "./adapters/contract";

const invalidExportPath = (path: string): never => {
  throw new TrajectoryAdapterError("invalid_export_path", `invalid_export_path: ${path}`);
};

const sameInode = (left: Readonly<{ dev: number; ino: number }>, right: Readonly<{ dev: number; ino: number }>): boolean =>
  left.dev === right.dev && left.ino === right.ino;

/** Reject symlinks below a canonical collector output root before traversal. */
export const rejectExistingSymlinkPathBelow = (outputRoot: string, path: string): void => {
  const root = resolve(outputRoot);
  let current = resolve(path);
  const relation = relative(root, current);
  if (relation === ".." || relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(relation)) {
    invalidExportPath(path);
  }
  while (current !== root) {
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) invalidExportPath(path);
    current = dirname(current);
  }
};

/** Ensure an existing output is neither a symlink nor the source inode. */
export const assertSafeOutputPath = (sourcePath: string, exportPath: string): void => {
  if (lstatSync(exportPath, { throwIfNoEntry: false })?.isSymbolicLink()) invalidExportPath(exportPath);
  const output = statSync(exportPath, { throwIfNoEntry: false });
  if (output !== undefined && sameInode(statSync(sourcePath), output)) invalidExportPath(exportPath);
};

/**
 * Remove a stale collector-owned output after conversion failed. Cleanup is
 * deliberately conservative: it never traverses symlink parents and cannot
 * unlink the source inode.
 */
export const removeManagedOutputAfterConversionFailure = (
  sourcePath: string,
  outputRoot: string,
  exportPath: string,
): void => {
  try {
    rejectExistingSymlinkPathBelow(outputRoot, dirname(exportPath));
  } catch (error) {
    if (error instanceof TrajectoryAdapterError && error.code === "invalid_export_path") return;
    throw error;
  }
  const output = lstatSync(exportPath, { throwIfNoEntry: false });
  if (output === undefined || output.isSymbolicLink() || !output.isFile()) return;
  if (sameInode(statSync(sourcePath), statSync(exportPath))) return;
  unlinkSync(exportPath);
};

export const collectWatchSessionFileName = (
  runtime: string,
  sessionPath: string,
  sessionId: string,
): string => {
  const readable = encodeURIComponent(sessionId).replaceAll("%", "_").slice(0, 80) || "session";
  const digest = createHash("sha256")
    .update(runtime)
    .update("\0")
    .update(sessionPath)
    .update("\0")
    .update(sessionId)
    .digest("hex")
    .slice(0, 16);
  return `${readable}--${digest}`;
};
