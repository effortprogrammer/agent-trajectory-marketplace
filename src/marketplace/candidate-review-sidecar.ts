import { createHash, randomUUID } from "node:crypto";
import { dlopen } from "bun:ffi";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { z } from "zod";

import { sanitizedArtifactDigest } from "./dataset-archive";
import { MarketplaceError } from "./error";

const reviewFormatVersion = 1;
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const boundedIdentityPart = z.string().trim().min(1).max(512);
const boundedReviewText = z.string().max(64 * 1024);

export const candidateReviewIdentitySchema = z.object({
  schema: boundedIdentityPart,
  policy: boundedIdentityPart,
  scanner: boundedIdentityPart,
  reviewer: boundedIdentityPart,
  context: boundedIdentityPart,
}).strict();

export type CandidateReviewIdentity = Readonly<z.infer<typeof candidateReviewIdentitySchema>>;

export const privateCandidateReviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  rationale: boundedReviewText.optional(),
}).strict();

export type PrivateCandidateReview = Readonly<z.infer<typeof privateCandidateReviewSchema>>;

type SanitizedArtifactIdentity = Readonly<{
  readonly byteCount: number;
  readonly sha256: string;
}>;

const artifactIdentitySchema = z.object({
  byteCount: z.number().int().positive(),
  sha256: sha256Schema,
}).strict();

const sidecarStateSchema = z.object({
  formatVersion: z.literal(reviewFormatVersion),
  address: sha256Schema,
  artifact: artifactIdentitySchema,
  identity: candidateReviewIdentitySchema,
  review: privateCandidateReviewSchema,
}).strict();

type SidecarState = Readonly<z.infer<typeof sidecarStateSchema>>;

type CandidateReviewSidecarTestHooks = Readonly<{
  readonly afterCacheRootValidated?: () => void;
  readonly afterCacheDirectoryOpened?: () => void;
  readonly afterTemporaryOpen?: (temporaryName: string) => void;
}>;

export type PrivateCandidateReviewRequest = Readonly<{
  readonly artifactBytes: Uint8Array;
  readonly cacheRoot: string;
  readonly identity: CandidateReviewIdentity;
  readonly execute: () => PrivateCandidateReview;
  readonly testHooks?: CandidateReviewSidecarTestHooks;
}>;

export type PrivateCandidateReviewResult = Readonly<{
  readonly address: string;
  readonly artifact: SanitizedArtifactIdentity;
  readonly identity: CandidateReviewIdentity;
  readonly review: PrivateCandidateReview;
  readonly source: "cache" | "reviewed";
}>;

const digest = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

const invalid = (): never => {
  throw new MarketplaceError("invalid_bundle_request");
};

const currentUserId = (): number | undefined =>
  typeof process.getuid === "function" ? process.getuid() : undefined;

const isMissing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const sameFile = (left: Readonly<{ dev: number; ino: number }>, right: Readonly<{ dev: number; ino: number }>): boolean =>
  left.dev === right.dev && left.ino === right.ino;

const parsedIdentity = (identity: CandidateReviewIdentity): CandidateReviewIdentity => {
  const result = candidateReviewIdentitySchema.safeParse(identity);
  if (!result.success) return invalid();
  return Object.freeze({ ...result.data });
};

const parsedReview = (review: PrivateCandidateReview): PrivateCandidateReview => {
  const result = privateCandidateReviewSchema.safeParse(review);
  if (!result.success) return invalid();
  return Object.freeze({ ...result.data });
};

const artifactFor = (bytes: Uint8Array): SanitizedArtifactIdentity => {
  const result = artifactIdentitySchema.safeParse(sanitizedArtifactDigest(bytes));
  if (!result.success) return invalid();
  return Object.freeze(result.data);
};

const addressFor = (artifact: SanitizedArtifactIdentity, identity: CandidateReviewIdentity): string => digest(JSON.stringify({
  formatVersion: reviewFormatVersion,
  artifact,
  identity: {
    schema: identity.schema,
    policy: identity.policy,
    scanner: identity.scanner,
    reviewer: identity.reviewer,
    context: identity.context,
  },
}));

type FileStatus = Stats;

const nativeSymbols = {
  openat: { args: ["i32", "ptr", "i32", "u32"], returns: "i32" },
  renameat: { args: ["i32", "ptr", "i32", "ptr"], returns: "i32" },
  unlinkat: { args: ["i32", "ptr", "i32"], returns: "i32" },
} as const;

const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const fileFlags = constants.O_RDONLY | constants.O_NOFOLLOW;

type NativeLibrary = ReturnType<typeof loadNative>;

type CacheDirectory = Readonly<{
  readonly library: NativeLibrary;
  readonly descriptor: number;
}>;

const assertPrivateDirectoryStatus = (status: FileStatus): FileStatus => {
  const owner = currentUserId();
  if (!status.isDirectory() || status.isSymbolicLink() || (status.mode & 0o077) !== 0 ||
    (owner !== undefined && status.uid !== owner)) return invalid();
  return status;
};

const assertPrivateDirectory = (path: string): FileStatus => {
  try {
    return assertPrivateDirectoryStatus(lstatSync(path) as Stats);
  } catch (error) {
    if (isMissing(error)) return invalid();
    throw error;
  }
};

const resolvedPrivateCacheRoot = (cacheRoot: string): string => {
  if (!isAbsolute(cacheRoot) || cacheRoot.includes("\0")) return invalid();
  return resolve(cacheRoot);
};

const assertNoSymlinkedExistingAncestor = (path: string): void => {
  let current = path;
  while (true) {
    try {
      if (lstatSync(current).isSymbolicLink()) return invalid();
    } catch (error) {
      if (!isMissing(error)) return invalid();
    }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
};

const ensurePrivateCacheRoot = (cacheRoot: string): void => {
  assertNoSymlinkedExistingAncestor(cacheRoot);
  try {
    mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
  } catch (error) {
    if (error instanceof Error) return invalid();
    throw error;
  }
  assertNoSymlinkedExistingAncestor(cacheRoot);
  assertPrivateDirectory(cacheRoot);
};

function loadNative() {
  const path = process.platform === "darwin"
    ? "/usr/lib/libSystem.B.dylib"
    : process.platform === "linux" ? "libc.so.6" : undefined;
  if (path === undefined) return invalid();
  try {
    return dlopen(path, nativeSymbols);
  } catch {
    return invalid();
  }
}

const encodedName = (name: string): Uint8Array => {
  if (name.length === 0 || name === "." || name === ".." || name.includes("/") || name.includes("\0")) return invalid();
  return new TextEncoder().encode(`${name}\0`);
};

const openAt = (library: NativeLibrary, directory: number, name: string, flags: number, mode = 0): number =>
  library.symbols.openat(directory, encodedName(name), flags, mode);

const renameAt = (library: NativeLibrary, directory: number, source: string, destination: string): number =>
  library.symbols.renameat(directory, encodedName(source), directory, encodedName(destination));

const unlinkAt = (library: NativeLibrary, directory: number, name: string): number =>
  library.symbols.unlinkat(directory, encodedName(name), 0);

const openPrivateCacheDirectory = (cacheRoot: string): CacheDirectory => {
  let library: NativeLibrary | undefined;
  let descriptor: number | undefined;
  try {
    library = loadNative();
    descriptor = openSync("/", directoryFlags);
    for (const name of cacheRoot.split("/").filter((part) => part.length > 0)) {
      const child = openAt(library, descriptor, name, directoryFlags);
      if (child < 0) return invalid();
      closeSync(descriptor);
      descriptor = child;
    }
    assertPrivateDirectoryStatus(fstatSync(descriptor));
    return { library, descriptor };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    library?.close();
    if (error instanceof MarketplaceError) throw error;
    return invalid();
  }
};

const closeCacheDirectory = (directory: CacheDirectory): void => {
  try {
    closeSync(directory.descriptor);
  } finally {
    directory.library.close();
  }
};

const sidecarName = (address: string): string => `${address}.json`;

const isPrivateSidecar = (status: FileStatus): boolean => {
  const owner = currentUserId();
  return status.isFile() && !status.isSymbolicLink() && (status.mode & 0o077) === 0 &&
    (owner === undefined || status.uid === owner);
};

const stateMatches = (
  state: SidecarState,
  address: string,
  artifact: SanitizedArtifactIdentity,
  identity: CandidateReviewIdentity,
): boolean =>
  state.address === address &&
  state.artifact.byteCount === artifact.byteCount &&
  state.artifact.sha256 === artifact.sha256 &&
  state.identity.schema === identity.schema &&
  state.identity.policy === identity.policy &&
  state.identity.scanner === identity.scanner &&
  state.identity.reviewer === identity.reviewer &&
  state.identity.context === identity.context;

const readState = (
  directory: CacheDirectory,
  address: string,
  artifact: SanitizedArtifactIdentity,
  identity: CandidateReviewIdentity,
): SidecarState | undefined => {
  let descriptor: number | undefined;
  try {
    descriptor = openAt(directory.library, directory.descriptor, sidecarName(address), fileFlags);
    if (descriptor < 0) return undefined;
    if (!isPrivateSidecar(fstatSync(descriptor))) return undefined;
    const parsed = sidecarStateSchema.safeParse(JSON.parse(readFileSync(descriptor, "utf8")));
    if (!parsed.success || !stateMatches(parsed.data, address, artifact, identity)) return undefined;
    return parsed.data;
  } catch (error) {
    if (error instanceof SyntaxError || isMissing(error)) return undefined;
    if (error instanceof MarketplaceError) throw error;
    return undefined;
  } finally {
    if (descriptor !== undefined && descriptor >= 0) closeSync(descriptor);
  }
};

const writeAll = (descriptor: number, bytes: Buffer): void => {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = writeSync(descriptor, bytes, offset, bytes.byteLength - offset);
    if (!Number.isSafeInteger(written) || written <= 0 || written > bytes.byteLength - offset) return invalid();
    offset += written;
  }
};

const writeState = (
  directory: CacheDirectory,
  state: SidecarState,
  testHooks: CandidateReviewSidecarTestHooks | undefined,
): void => {
  const temporaryName = `.${state.address}.${process.pid}.${randomUUID()}.tmp`;
  const outputName = sidecarName(state.address);
  const bytes = Buffer.from(`${JSON.stringify(state)}\n`, "utf8");
  let descriptor: number | undefined;
  let temporaryStatus: FileStatus | undefined;
  let temporaryCreated = false;
  let temporaryCommitted = false;
  try {
    descriptor = openAt(
      directory.library,
      directory.descriptor,
      temporaryName,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    if (descriptor < 0) return invalid();
    temporaryCreated = true;
    // Bun FFI cannot pass openat's variadic mode argument on Darwin, so apply
    // the required private mode directly to the newly created descriptor.
    fchmodSync(descriptor, 0o600);
    testHooks?.afterTemporaryOpen?.(temporaryName);
    temporaryStatus = fstatSync(descriptor);
    if (!isPrivateSidecar(temporaryStatus)) return invalid();
    writeAll(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    const currentTemporary = openAt(directory.library, directory.descriptor, temporaryName, fileFlags);
    if (currentTemporary < 0) return invalid();
    try {
      if (!sameFile(temporaryStatus, fstatSync(currentTemporary))) return invalid();
    } finally {
      closeSync(currentTemporary);
    }
    if (renameAt(directory.library, directory.descriptor, temporaryName, outputName) < 0) return invalid();
    temporaryCommitted = true;
    const committed = openAt(directory.library, directory.descriptor, outputName, fileFlags);
    if (committed < 0) return invalid();
    try {
      if (!sameFile(temporaryStatus, fstatSync(committed)) || !isPrivateSidecar(fstatSync(committed))) return invalid();
    } finally {
      closeSync(committed);
    }
  } finally {
    if (descriptor !== undefined && descriptor >= 0) closeSync(descriptor);
    if (temporaryCreated && !temporaryCommitted) {
      const currentTemporary = openAt(directory.library, directory.descriptor, temporaryName, fileFlags);
      if (currentTemporary >= 0) {
        const currentStatus = fstatSync(currentTemporary);
        closeSync(currentTemporary);
        if (temporaryStatus !== undefined && sameFile(temporaryStatus, currentStatus) &&
          unlinkAt(directory.library, directory.descriptor, temporaryName) < 0) invalid();
      }
    }
  }
};

/**
 * Resolves a private review through a local content-addressed sidecar. The only
 * identity derived from candidate bytes is the existing sanitized artifact digest;
 * review material never crosses into archive or publish APIs.
 */
export const reviewPrivateCandidate = (request: PrivateCandidateReviewRequest): PrivateCandidateReviewResult => {
  const identity = parsedIdentity(request.identity);
  const artifact = artifactFor(request.artifactBytes);
  const address = addressFor(artifact, identity);
  const cacheRoot = resolvedPrivateCacheRoot(request.cacheRoot);
  ensurePrivateCacheRoot(cacheRoot);
  request.testHooks?.afterCacheRootValidated?.();
  const directory = openPrivateCacheDirectory(cacheRoot);
  try {
    request.testHooks?.afterCacheDirectoryOpened?.();
    const cached = readState(directory, address, artifact, identity);
    if (cached !== undefined) {
      return Object.freeze({ address, artifact, identity, review: cached.review, source: "cache" });
    }
    const review = parsedReview(request.execute());
    const state = sidecarStateSchema.parse({ formatVersion: reviewFormatVersion, address, artifact, identity, review });
    writeState(directory, state, request.testHooks);
    return Object.freeze({ address, artifact, identity, review, source: "reviewed" });
  } finally {
    closeCacheDirectory(directory);
  }
};
