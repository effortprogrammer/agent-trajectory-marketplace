import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  reviewPrivateCandidate,
  type CandidateReviewIdentity,
  type PrivateCandidateReview,
} from "../../../src/marketplace/candidate-review-sidecar";
import { buildDatasetArchive } from "../../../src/marketplace/dataset-archive";
import { parsePublishBundle } from "../../../src/marketplace/publish-bundle";
import { encodePublishFrame } from "../../../src/marketplace/publish-frame";
import { fullSelectorSchema, traceHashSchema, type FrozenTrace } from "../../../src/marketplace/session-contract";

const roots: string[] = [];
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const fixtureRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "trajectory-review-sidecar-"));
  roots.push(root);
  return root;
};

const identity = (policy = "policy-v1"): CandidateReviewIdentity => ({
  schema: "atf-v2",
  policy,
  scanner: "sanitized-artifact/v1",
  reviewer: "local-reviewer/v1",
  context: "seller-candidate",
});

const artifact = (request = "first"): Uint8Array => encoder.encode(JSON.stringify({
  runtime: "codex",
  status: "collected",
  formatVersion: 2,
  eventCount: 1,
  events: [{ kind: "function_enter", name: "turn", payload: { role: "user", content: request } }],
}));

const reviewRationale = "The trace is relevant to the candidate.";
const reviewRawSession = "reviewer transcript with private instruction";
const reviewSecretDerivedHash = "hmac-sha256:local-secret-derived-value";
const review: PrivateCandidateReview = {
  decision: "approved",
  rationale: reviewRationale,
  rawSession: reviewRawSession,
  secretDerivedHashes: [reviewSecretDerivedHash],
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("private content-addressed candidate review sidecars", () => {
  test("hits for the same sanitized artifact and resolved review identity", () => {
    // Given: a private cache and a reviewer whose invocation is observable.
    const root = fixtureRoot();
    const cacheRoot = join(root, "private-cache");
    let calls = 0;
    const execute = (): PrivateCandidateReview => {
      calls += 1;
      return review;
    };

    // When: the same candidate is reviewed twice under the same resolved identity.
    const first = reviewPrivateCandidate({ artifactBytes: artifact(), cacheRoot, identity: identity(), execute });
    const second = reviewPrivateCandidate({ artifactBytes: artifact(), cacheRoot, identity: identity(), execute });

    // Then: only the first review executes and private state remains in the sidecar.
    expect(first.source).toBe("reviewed");
    expect(second.source).toBe("cache");
    expect(calls).toBe(1);
    expect(second.review).toEqual(review);
    expect(lstatSync(cacheRoot).mode & 0o777).toBe(0o700);
    const sidecar = join(cacheRoot, `${first.address}.json`);
    expect(existsSync(sidecar)).toBe(true);
    expect(lstatSync(sidecar).mode & 0o777).toBe(0o600);
    expect(readFileSync(sidecar, "utf8")).toContain(reviewRawSession);
  });

  test("misses to a new address when the sanitized artifact changes", () => {
    // Given: a completed review for one sanitized artifact.
    const root = fixtureRoot();
    const cacheRoot = join(root, "private-cache");
    let calls = 0;
    const execute = (): PrivateCandidateReview => ({ ...review, rationale: `call-${++calls}` });
    const first = reviewPrivateCandidate({ artifactBytes: artifact("first"), cacheRoot, identity: identity(), execute });

    // When: the trace content changes under the same review identity.
    const second = reviewPrivateCandidate({ artifactBytes: artifact("changed"), cacheRoot, identity: identity(), execute });

    // Then: the review does not reuse the prior sidecar.
    expect(calls).toBe(2);
    expect(second.source).toBe("reviewed");
    expect(second.address).not.toBe(first.address);
  });

  test("misses to a new address when the review policy identity changes", () => {
    // Given: a completed review under one policy revision.
    const root = fixtureRoot();
    const cacheRoot = join(root, "private-cache");
    let calls = 0;
    const execute = (): PrivateCandidateReview => ({ ...review, rationale: `call-${++calls}` });
    const first = reviewPrivateCandidate({ artifactBytes: artifact(), cacheRoot, identity: identity("policy-v1"), execute });

    // When: the resolved policy revision changes.
    const second = reviewPrivateCandidate({ artifactBytes: artifact(), cacheRoot, identity: identity("policy-v2"), execute });

    // Then: the policy transition has an independently addressed review.
    expect(calls).toBe(2);
    expect(second.source).toBe("reviewed");
    expect(second.address).not.toBe(first.address);
  });

  test("fails closed by replacing malformed state instead of honoring it", () => {
    // Given: an address containing malformed JSON from an interrupted or tampered prior write.
    const root = fixtureRoot();
    const cacheRoot = join(root, "private-cache");
    const initial = reviewPrivateCandidate({ artifactBytes: artifact(), cacheRoot, identity: identity(), execute: () => review });
    const path = join(cacheRoot, `${initial.address}.json`);
    writeFileSync(path, "{not-json");
    let calls = 0;

    // When: the same input is reviewed again.
    const result = reviewPrivateCandidate({
      artifactBytes: artifact(), cacheRoot, identity: identity(),
      execute: () => ({ ...review, rationale: `fresh-${++calls}` }),
    });

    // Then: malformed contents are never treated as a hit and are atomically replaced with valid state.
    expect(result.source).toBe("reviewed");
    expect(calls).toBe(1);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ review: { rationale: "fresh-1" } });
  });

  test("rejects a symlinked cache root and leaves its target untouched", () => {
    // Given: a cache root path redirected outside the requested private cache location.
    const root = fixtureRoot();
    const outside = join(root, "outside");
    mkdirSync(outside, { mode: 0o700 });
    const redirected = join(root, "private-cache");
    symlinkSync(outside, redirected);

    // When: a sidecar write is requested through that symlink.
    const action = (): unknown => reviewPrivateCandidate({
      artifactBytes: artifact(), cacheRoot: redirected, identity: identity(), execute: () => review,
    });

    // Then: confinement rejects it before any sidecar is created in the target directory.
    expect(action).toThrow("invalid_bundle_request");
    expect(Array.from(new Bun.Glob("*.json").scanSync({ cwd: outside }))).toEqual([]);
  });

  test("keeps review-only fields out of the candidate archive and manifest", () => {
    // Given: a private sidecar holding rationale, raw session text, and a secret-derived hash.
    const root = fixtureRoot();
    const cacheRoot = join(root, "private-cache");
    const bytes = artifact();
    const cached = reviewPrivateCandidate({ artifactBytes: bytes, cacheRoot, identity: identity(), execute: () => review });
    const trace: FrozenTrace = {
      selector: fullSelectorSchema.parse(`s-${"a".repeat(64)}`),
      relativePath: "candidate.atf.json",
      hash: traceHashSchema.parse(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")),
      byteCount: bytes.byteLength,
      runtime: "codex",
      eventCount: 1,
      earliestTimestamp: "unknown",
      bytes,
    };

    // When: the reviewed candidate is archived for publishing.
    const archive = buildDatasetArchive([trace]);
    const frame = encodePublishFrame(parsePublishBundle(archive).candidate, archive);
    const published = decoder.decode(archive);
    const publishedFrame = decoder.decode(frame);

    // Then: private review material is neither embedded nor named by any archive member or publish frame.
    expect(cached.source).toBe("reviewed");
    for (const privateValue of [reviewRationale, reviewRawSession, reviewSecretDerivedHash, cached.address]) {
      expect(published).not.toContain(privateValue);
      expect(publishedFrame).not.toContain(privateValue);
    }
    expect(published).toContain("dataset-manifest.json");
    expect(published).toContain(`traces/${trace.selector}.atf.json`);
  });
});
