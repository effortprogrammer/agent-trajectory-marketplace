import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  linkSync,
  openSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

import { MarketplaceError } from "./error";

export type BundleOutputOperations = Readonly<{
  readonly openExclusive: (path: string) => number;
  readonly write: (descriptor: number, bytes: Uint8Array, offset: number) => number;
  readonly fsync: (descriptor: number) => void;
  readonly close: (descriptor: number) => void;
  readonly link: (temporaryPath: string, outputPath: string) => void;
  readonly unlink: (path: string) => void;
}>;

export const nodeBundleOutputOperations: BundleOutputOperations = Object.freeze({
  openExclusive: (path: string): number => openSync(path, "wx", 0o600),
  write: (descriptor: number, bytes: Uint8Array, offset: number): number =>
    writeSync(descriptor, bytes, offset, bytes.byteLength - offset),
  fsync: (descriptor: number): void => fsyncSync(descriptor),
  close: (descriptor: number): void => closeSync(descriptor),
  link: (temporaryPath: string, outputPath: string): void => linkSync(temporaryPath, outputPath),
  unlink: (path: string): void => unlinkSync(path),
});

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
  let ownsTemporary = false;
  try {
    const descriptor = operations.openExclusive(temporaryPath);
    ownsTemporary = true;
    try {
      let offset = 0;
      while (offset < bytes.byteLength) {
        const written = operations.write(descriptor, bytes, offset);
        if (!Number.isSafeInteger(written) || written <= 0 || written > bytes.byteLength - offset) {
          throw new MarketplaceError("invalid_bundle_request");
        }
        offset += written;
      }
      operations.fsync(descriptor);
    } finally {
      operations.close(descriptor);
    }
    try {
      operations.link(temporaryPath, outputPath);
    } catch (error) {
      const normalized = linkError(error);
      if (normalized !== undefined) throw normalized;
      throw error;
    }
    operations.unlink(temporaryPath);
    ownsTemporary = false;
  } finally {
    if (ownsTemporary) operations.unlink(temporaryPath);
  }
}
