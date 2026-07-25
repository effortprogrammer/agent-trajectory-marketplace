import { randomUUID } from "node:crypto";
import {
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  linkSync,
  openSync,
  realpathSync,
  type Stats,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

import { MarketplaceError } from "./error";

export type BundleOutputOperations = Readonly<{
  readonly openExclusive: (path: string) => number;
  readonly fstat: (descriptor: number) => Stats;
  readonly lstat: (path: string) => Stats;
  readonly realpath: (path: string) => string;
  readonly currentUserId: () => number | undefined;
  readonly write: (descriptor: number, bytes: Uint8Array, offset: number) => number;
  readonly fsync: (descriptor: number) => void;
  readonly close: (descriptor: number) => void;
  readonly link: (temporaryPath: string, outputPath: string) => void;
  readonly unlink: (path: string) => void;
}>;

export const nodeBundleOutputOperations: BundleOutputOperations = Object.freeze({
  openExclusive: (path: string): number => openSync(path, "wx", 0o600),
  fstat: (descriptor: number): Stats => fstatSync(descriptor),
  lstat: (path: string): Stats => lstatSync(path),
  realpath: (path: string): string => realpathSync(path),
  currentUserId: (): number | undefined => typeof process.getuid === "function" ? process.getuid() : undefined,
  write: (descriptor: number, bytes: Uint8Array, offset: number): number =>
    writeSync(descriptor, bytes, offset, bytes.byteLength - offset),
  fsync: (descriptor: number): void => fsyncSync(descriptor),
  close: (descriptor: number): void => closeSync(descriptor),
  link: (temporaryPath: string, outputPath: string): void => linkSync(temporaryPath, outputPath),
  unlink: (path: string): void => unlinkSync(path),
});

const sameFile = (left: Stats, right: Stats): boolean => left.dev === right.dev && left.ino === right.ino;

const isMissing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const safeDirectory = (path: string, operations: BundleOutputOperations): Stats => {
  let current = operations.realpath(path);
  let selected: Stats | undefined;
  while (true) {
    const status = operations.lstat(current);
    const sharedWithoutSticky = (status.mode & 0o022) !== 0 && (status.mode & 0o1000) === 0;
    if (!status.isDirectory() || status.isSymbolicLink() || sharedWithoutSticky) {
      throw new MarketplaceError("invalid_bundle_request");
    }
    if (selected === undefined) {
      const currentUserId = operations.currentUserId();
      if (currentUserId !== undefined && status.uid !== currentUserId) {
        throw new MarketplaceError("invalid_bundle_request");
      }
      selected = status;
    }
    const parent = dirname(current);
    if (parent === current) return selected;
    current = parent;
  }
};

const unlinkSameFile = (path: string, expected: Stats, operations: BundleOutputOperations): void => {
  try {
    const current = operations.lstat(path);
    if (sameFile(expected, current) && !current.isSymbolicLink()) operations.unlink(path);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
};

const linkError = (error: unknown): MarketplaceError | undefined => {
  if (!(error instanceof Error) || !("code" in error) || typeof error.code !== "string") {
    return undefined;
  }
  if (error.code === "EEXIST") return new MarketplaceError("output_exists");
  if (["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV", "EMLINK"].includes(error.code)) {
    return new MarketplaceError("unsupported_platform");
  }
  return undefined;
};

export function writeBundleOutput(
  outputPath: string,
  bytes: Uint8Array,
  operations: BundleOutputOperations = nodeBundleOutputOperations,
): void {
  if (!isAbsolute(outputPath) || outputPath.includes("\0") || bytes.byteLength === 0) {
    throw new MarketplaceError("invalid_bundle_request");
  }
  const temporaryPath = join(
    dirname(outputPath),
    `.${basename(outputPath)}.trajectory-tmp-${process.pid}-${randomUUID()}`,
  );
  const directoryIdentity = safeDirectory(dirname(outputPath), operations);
  let ownsTemporary = false;
  let temporaryIdentity: Stats | undefined;
  try {
    const descriptor = operations.openExclusive(temporaryPath);
    ownsTemporary = true;
    try {
      temporaryIdentity = operations.fstat(descriptor);
      const currentUserId = operations.currentUserId();
      if (!temporaryIdentity.isFile() || (temporaryIdentity.mode & 0o077) !== 0 ||
        (currentUserId !== undefined && temporaryIdentity.uid !== currentUserId)) {
        throw new MarketplaceError("invalid_bundle_request");
      }
      let offset = 0;
      while (offset < bytes.byteLength) {
        const written = operations.write(descriptor, bytes, offset);
        if (!Number.isSafeInteger(written) || written <= 0 || written > bytes.byteLength - offset) {
          throw new MarketplaceError("invalid_bundle_request");
        }
        offset += written;
      }
      operations.fsync(descriptor);
      const temporaryStatus = operations.lstat(temporaryPath);
      const directoryStatus = operations.lstat(dirname(outputPath));
      if (!sameFile(temporaryIdentity, temporaryStatus) || temporaryStatus.isSymbolicLink() ||
        !sameFile(directoryIdentity, directoryStatus) || directoryStatus.isSymbolicLink()) {
        throw new MarketplaceError("invalid_bundle_request");
      }
      operations.link(temporaryPath, outputPath);
      const outputStatus = operations.lstat(outputPath);
      const committedDirectoryStatus = operations.lstat(dirname(outputPath));
      if (!sameFile(temporaryIdentity, outputStatus) ||
        !sameFile(directoryIdentity, committedDirectoryStatus) || committedDirectoryStatus.isSymbolicLink()) {
        unlinkSameFile(outputPath, outputStatus, operations);
        throw new MarketplaceError("invalid_bundle_request");
      }
      operations.unlink(temporaryPath);
      ownsTemporary = false;
    } catch (error) {
      const normalized = linkError(error);
      if (normalized !== undefined) throw normalized;
      throw error;
    } finally {
      operations.close(descriptor);
    }
  } finally {
    if (ownsTemporary && temporaryIdentity !== undefined) {
      unlinkSameFile(temporaryPath, temporaryIdentity, operations);
    }
  }
}
