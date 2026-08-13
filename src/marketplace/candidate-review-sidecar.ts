import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { z } from "zod";

import { sanitizedArtifactDigest } from "./dataset-archive";
import { MarketplaceError } from "./error";

const reviewFormatVersion = 1;
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const boundedIdentityPart = z.string().trim().min(1).max(512);
const boundedReviewText = z.string().max(64 * 1024);
const boundedSecretHash = z.string().min(1).max(512);

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
  rawSession: boundedReviewText.optional(),
  secretDerivedHashes: z.array(boundedSecretHash).max(256).optional(),
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

export type PrivateCandidateReviewRequest = Readonly<{
  readonly artifactBytes: Uint8Array;
  readonly cacheRoot: string;
  readonly identity: CandidateReviewIdentity;
  readonly execute: () => PrivateCandidateReview;
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
  return Object.freeze({
    ...result.data,
    ...(result.data.secretDerivedHashes === undefined
      ? {}
      : { secretDerivedHashes: [...result.data.secretDerivedHashes] }),
  });
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

const assertPrivateDirectory = (path: string): FileStatus => {
  let status: FileStatus;
  try {
    status = lstatSync(path) as Stats;
  } catch (error) {
    if (isMissing(error)) return invalid();
    throw error;
  }
  const owner = currentUserId();
  if (!status.isDirectory() || status.isSymbolicLink() || (status.mode & 0o077) !== 0 ||
    (owner !== undefined && status.uid !== owner)) return invalid();
  return status;
};

const ensurePrivateCacheRoot = (cacheRoot: string): FileStatus => {
  if (!isAbsolute(cacheRoot) || cacheRoot.includes("\0")) return invalid();
  try {
    mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
  } catch (error) {
    if (error instanceof Error) return invalid();
    throw error;
  }
  return assertPrivateDirectory(cacheRoot);
};

const sidecarPath = (cacheRoot: string, address: string): string => join(cacheRoot, `${address}.json`);

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
  cacheRoot: string,
  rootIdentity: FileStatus,
  address: string,
  artifact: SanitizedArtifactIdentity,
  identity: CandidateReviewIdentity,
): SidecarState | undefined => {
  const path = sidecarPath(cacheRoot, address);
  let descriptor: number | undefined;
  try {
    const before = lstatSync(path);
    const owner = currentUserId();
    if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o077) !== 0 ||
      (owner !== undefined && before.uid !== owner)) return undefined;
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (!sameFile(before, opened)) return undefined;
    const text = readFileSync(descriptor, "utf8");
    const after = lstatSync(path);
    if (!sameFile(before, after) || !sameFile(rootIdentity, assertPrivateDirectory(cacheRoot))) return undefined;
    const parsed = sidecarStateSchema.safeParse(JSON.parse(text));
    if (!parsed.success || !stateMatches(parsed.data, address, artifact, identity)) return undefined;
    return parsed.data;
  } catch (error) {
    if (error instanceof SyntaxError || isMissing(error)) return undefined;
    if (error instanceof MarketplaceError) throw error;
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
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

const writeState = (cacheRoot: string, rootIdentity: FileStatus, state: SidecarState): void => {
  const output = sidecarPath(cacheRoot, state.address);
  const temporary = join(dirname(output), `.${state.address}.${process.pid}.${randomUUID()}.tmp`);
  const bytes = Buffer.from(`${JSON.stringify(state)}\n`, "utf8");
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const temporaryStatus = fstatSync(descriptor);
    const owner = currentUserId();
    if (!temporaryStatus.isFile() || (temporaryStatus.mode & 0o077) !== 0 ||
      (owner !== undefined && temporaryStatus.uid !== owner)) return invalid();
    writeAll(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    const beforeRenameRoot = assertPrivateDirectory(cacheRoot);
    const beforeRenameTemporary = lstatSync(temporary);
    if (!sameFile(rootIdentity, beforeRenameRoot) || !sameFile(temporaryStatus, beforeRenameTemporary) ||
      beforeRenameTemporary.isSymbolicLink()) return invalid();
    renameSync(temporary, output);
    const committed = lstatSync(output);
    if (!committed.isFile() || committed.isSymbolicLink() || (committed.mode & 0o077) !== 0 ||
      !sameFile(beforeRenameTemporary, committed) || !sameFile(rootIdentity, assertPrivateDirectory(cacheRoot))) {
      return invalid();
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (!isMissing(error)) throw error;
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
  const rootIdentity = ensurePrivateCacheRoot(request.cacheRoot);
  const cached = readState(request.cacheRoot, rootIdentity, address, artifact, identity);
  if (cached !== undefined) {
    return Object.freeze({ address, artifact, identity, review: cached.review, source: "cache" });
  }
  const review = parsedReview(request.execute());
  const state = sidecarStateSchema.parse({ formatVersion: reviewFormatVersion, address, artifact, identity, review });
  writeState(request.cacheRoot, rootIdentity, state);
  return Object.freeze({ address, artifact, identity, review, source: "reviewed" });
};
