import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

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
  const root = realpathSync(mkdtempSync(join(tmpdir(), "trajectory-review-sidecar-")));
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
  events: [{
    kind: "function_enter",
    name: "turn",
    timestamp: "2026-09-01T00:00:00.000Z",
    sourceEventId: "usage-0",
    payload: {
      role: "user",
      content: request,
      usage: {
        model: "claude-fable-5",
        inputTokens: 1,
        outputTokens: 1,
      },
    },
  }],
}));

const reviewRationale = "The trace is relevant to the candidate.";
const review: PrivateCandidateReview = {
  decision: "approved",
  rationale: reviewRationale,
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

    // Then: only the first review executes and its bounded decision state remains in the sidecar.
    expect(first.source).toBe("reviewed");
    expect(second.source).toBe("cache");
    expect(calls).toBe(1);
    expect(second.review).toEqual(review);
    expect(lstatSync(cacheRoot).mode & 0o777).toBe(0o700);
    const sidecar = join(cacheRoot, `${first.address}.json`);
    expect(existsSync(sidecar)).toBe(true);
    expect(lstatSync(sidecar).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(sidecar, "utf8"))).toMatchObject({ review });
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

  test.each([
    { rawSession: "native session bytes" },
    { secretDerivedHashes: ["hmac-sha256:secret-derived-value"] },
  ])("fails closed when a reviewer returns prohibited private field %s", (prohibited) => {
    // Given: a reviewer that returns a legacy raw-session or secret-derived field.
    const root = fixtureRoot();
    const cacheRoot = join(root, "private-cache");
    const execute = (): PrivateCandidateReview => ({
      decision: "approved",
      rationale: reviewRationale,
      ...prohibited,
    } as unknown as PrivateCandidateReview);

    // When: the result reaches the strict sidecar boundary.
    const action = (): unknown => reviewPrivateCandidate({ artifactBytes: artifact(), cacheRoot, identity: identity(), execute });

    // Then: it is rejected before a sidecar can serialize prohibited review state.
    expect(action).toThrow("invalid_bundle_request");
    expect(Array.from(new Bun.Glob("*.json").scanSync({ cwd: cacheRoot }))).toEqual([]);
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

  test("rejects a cache root beneath a symlinked existing ancestor", () => {
    // Given: an absent cache root whose existing parent redirects outside the requested path.
    const root = fixtureRoot();
    const outside = join(root, "outside");
    mkdirSync(outside, { mode: 0o700 });
    const redirectedParent = join(root, "cache-parent");
    symlinkSync(outside, redirectedParent, "dir");
    const cacheRoot = join(redirectedParent, "private-cache");

    // When: sidecar creation follows the apparent cache-root path.
    const action = (): unknown => reviewPrivateCandidate({
      artifactBytes: artifact(), cacheRoot, identity: identity(), execute: () => review,
    });

    // Then: no directory or sidecar is created through the symlinked ancestor.
    expect(action).toThrow("invalid_bundle_request");
    expect(existsSync(join(outside, "private-cache"))).toBe(false);
  });

  test("does not create a cache beneath an ancestor replaced after validation", () => {
    // Given: a missing cache path and an outside directory controlled by an attacker.
    const root = fixtureRoot();
    const outside = join(root, "outside");
    const redirectedParent = join(root, "cache-parent");
    const cacheRoot = join(redirectedParent, "private-cache");
    mkdirSync(outside, { mode: 0o700 });

    // When: the missing parent is replaced after pathname validation but before creation.
    const action = (): unknown => reviewPrivateCandidate({
      artifactBytes: artifact(), cacheRoot, identity: identity(), execute: () => review,
      testHooks: {
        afterCachePathValidatedBeforeCreate: (): void => symlinkSync(outside, redirectedParent, "dir"),
      },
    });

    // Then: the confinement boundary fails without creating any cache state outside the requested path.
    expect(action).toThrow("invalid_bundle_request");
    expect(existsSync(join(outside, "private-cache"))).toBe(false);
    expect(Array.from(new Bun.Glob("*").scanSync({ cwd: outside }))).toEqual([]);
  });

  test("pins creation beneath a newly opened cache component", () => {
    // Given: a cache root with a missing parent and an outside directory controlled by an attacker.
    const root = fixtureRoot();
    const outside = join(root, "outside");
    const cacheParent = join(root, "cache-parent");
    const cacheRoot = join(cacheParent, "private-cache");
    mkdirSync(outside, { mode: 0o700 });
    let replaced = false;

    // When: the newly created parent is replaced after its descriptor has opened but before its child is created.
    const result = reviewPrivateCandidate({
      artifactBytes: artifact(), cacheRoot, identity: identity(), execute: () => review,
      testHooks: {
        afterCacheComponentOpened: (name): void => {
          if (name !== "cache-parent") return;
          renameSync(cacheParent, join(root, "opened-cache-parent"));
          symlinkSync(outside, cacheParent, "dir");
          replaced = true;
        },
      },
    });

    // Then: descendant creation and sidecar writes stay beneath the pinned directory descriptor.
    expect(replaced).toBe(true);
    expect(result).toMatchObject({ source: "reviewed", review });
    expect(Array.from(new Bun.Glob("*").scanSync({ cwd: outside }))).toEqual([]);
    expect(Array.from(new Bun.Glob("*.json").scanSync({ cwd: join(root, "opened-cache-parent", "private-cache") }))).toHaveLength(1);
  });

  test("pins a validated cache root before its pathname is replaced", () => {
    // Given: a cache root that is private when validated and an outside directory controlled by an attacker.
    const root = fixtureRoot();
    const cacheRoot = join(root, "private-cache");
    const outside = join(root, "outside");
    mkdirSync(cacheRoot, { mode: 0o700 });
    mkdirSync(outside, { mode: 0o700 });
    let outsideTemporaryOpened = false;

    // When: the root is atomically replaced with a symlink immediately after validation.
    const action = (): unknown => reviewPrivateCandidate({
      artifactBytes: artifact(), cacheRoot, identity: identity(), execute: () => review,
      testHooks: {
        afterCacheRootValidated: (): void => {
          renameSync(cacheRoot, join(root, "validated-cache"));
          symlinkSync(outside, cacheRoot, "dir");
        },
        afterTemporaryOpen: (temporaryPath): void => {
          outsideTemporaryOpened = existsSync(join(outside, basename(temporaryPath)));
        },
      },
    });

    // Then: no private sidecar bytes can be opened in the redirected directory.
    expect(action()).toMatchObject({ source: "reviewed", review });
    expect(outsideTemporaryOpened).toBe(false);
    expect(Array.from(new Bun.Glob("*").scanSync({ cwd: outside }))).toEqual([]);
    expect(Array.from(new Bun.Glob("*.json").scanSync({ cwd: join(root, "validated-cache") }))).toHaveLength(1);
  });

  test("pins sidecar reads to the opened cache directory", () => {
    // Given: a populated cache and an attacker-controlled replacement target.
    const root = fixtureRoot();
    const cacheRoot = join(root, "private-cache");
    const outside = join(root, "outside");
    mkdirSync(outside, { mode: 0o700 });
    const cached = reviewPrivateCandidate({ artifactBytes: artifact(), cacheRoot, identity: identity(), execute: () => review });
    let executeCalls = 0;

    // When: the cache path is replaced after its verified directory descriptor has opened.
    const result = reviewPrivateCandidate({
      artifactBytes: artifact(), cacheRoot, identity: identity(),
      execute: (): PrivateCandidateReview => ({ ...review, rationale: `unexpected-${++executeCalls}` }),
      testHooks: {
        afterCacheDirectoryOpened: (): void => {
          renameSync(cacheRoot, join(root, "validated-cache"));
          symlinkSync(outside, cacheRoot, "dir");
        },
      },
    });

    // Then: the cache hit comes from the descriptor-pinned original directory, not the replacement path.
    expect(result).toMatchObject({ address: cached.address, source: "cache", review });
    expect(executeCalls).toBe(0);
    expect(Array.from(new Bun.Glob("*").scanSync({ cwd: outside }))).toEqual([]);
  });

  test("pins sidecar writes to the opened cache directory", () => {
    // Given: an empty private cache and an attacker-controlled replacement target.
    const root = fixtureRoot();
    const cacheRoot = join(root, "private-cache");
    const outside = join(root, "outside");
    mkdirSync(outside, { mode: 0o700 });
    let outsideTemporaryOpened = false;

    // When: the cache path is replaced immediately before a cache miss writes its sidecar.
    const result = reviewPrivateCandidate({
      artifactBytes: artifact(), cacheRoot, identity: identity(), execute: () => review,
      testHooks: {
        afterCacheDirectoryOpened: (): void => {
          renameSync(cacheRoot, join(root, "validated-cache"));
          symlinkSync(outside, cacheRoot, "dir");
        },
        afterTemporaryOpen: (temporaryName): void => {
          outsideTemporaryOpened = existsSync(join(outside, temporaryName));
        },
      },
    });

    // Then: the private bytes are committed only beneath the opened original directory.
    expect(result.source).toBe("reviewed");
    expect(outsideTemporaryOpened).toBe(false);
    expect(Array.from(new Bun.Glob("*").scanSync({ cwd: outside }))).toEqual([]);
    expect(Array.from(new Bun.Glob("*.json").scanSync({ cwd: join(root, "validated-cache") }))).toHaveLength(1);
  });

  test("keeps review-only fields out of the candidate archive and manifest", () => {
    // Given: a private sidecar holding only bounded review decision material.
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
    for (const privateValue of [reviewRationale, cached.address]) {
      expect(published).not.toContain(privateValue);
      expect(publishedFrame).not.toContain(privateValue);
    }
    expect(published).toContain("dataset-manifest.json");
    expect(published).toContain(`traces/${trace.selector}.atf.json`);
  });
});
