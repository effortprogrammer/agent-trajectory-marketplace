import { describe, expect, it } from "bun:test"

import { encodeDatasetManifest } from "../../../src/marketplace/archive-contract"
import { authenticatedBundleSubmissionSchema } from "../../../src/marketplace/ownership-contract"

const accountId = "acct-0123456789abcdef"
const secondAccountId = "acct-fedcba9876543210"
const hashA = "a".repeat(64)
const hashB = "b".repeat(64)
const bundleId = `bundle-${"c".repeat(64)}`
const archiveSha256 = "d".repeat(64)
const pathA = `traces/s-${hashA}.atf.json`
const pathB = `traces/s-${hashB}.atf.json`

const datasetManifest = {
  formatVersion: 1,
  artifacts: [
    { path: pathA, label: `s-${hashA}`, sha256: hashA, byteCount: 3 },
    { path: pathB, label: `s-${hashB}`, sha256: hashB, byteCount: 5 },
  ],
}

const validSubmission = {
  bundleId,
  archiveSha256,
  submittedByAccountId: accountId,
  claimStatus: "self_attested",
  manifest: datasetManifest,
  artifacts: [
    { artifactPath: pathA, traceSha256: hashA, byteCount: 3, submittedByAccountId: accountId },
    { artifactPath: pathB, traceSha256: hashB, byteCount: 5, submittedByAccountId: accountId },
  ],
}

describe("authenticated bundle ownership contract", () => {
  it("maps every artifact in a two-session identity-neutral manifest to one self-attested account", () => {
    // Given
    const serializedManifest = encodeDatasetManifest(datasetManifest)

    // When
    const result = authenticatedBundleSubmissionSchema.safeParse(validSubmission)

    // Then
    expect(result.success).toBe(true)
    expect(JSON.parse(serializedManifest.toString("utf8"))).not.toHaveProperty("submittedByAccountId")
    expect(serializedManifest.toString("utf8")).not.toContain(accountId)
  })

  it("rejects empty, stale, duplicate, mixed-claimant, and malformed authenticated mappings", () => {
    // Given
    const cases = [
      { ...validSubmission, artifacts: [] },
      { ...validSubmission, artifacts: [validSubmission.artifacts[0]] },
      { ...validSubmission, artifacts: [validSubmission.artifacts[0], validSubmission.artifacts[0]] },
      {
        ...validSubmission,
        artifacts: [
          validSubmission.artifacts[0],
          { ...validSubmission.artifacts[1], artifactPath: pathA, traceSha256: hashB },
        ],
      },
      {
        ...validSubmission,
        artifacts: [
          validSubmission.artifacts[0],
          { ...validSubmission.artifacts[1], submittedByAccountId: secondAccountId },
        ],
      },
      { ...validSubmission, submittedByAccountId: "acct-invalid" },
      { ...validSubmission, bundleId: "bundle-short" },
    ]

    // When
    const results = cases.map((input) => authenticatedBundleSubmissionSchema.safeParse(input))

    // Then
    expect(results.every((result) => !result.success)).toBe(true)
  })

  it("rejects identity-bearing manifests and injected fields before a future server can trust the submission", () => {
    // Given
    const injectionCases = [
      { ...validSubmission, manifest: { ...datasetManifest, submittedByAccountId: accountId } },
      {
        ...validSubmission,
        manifest: {
          ...datasetManifest,
          artifacts: [{ ...datasetManifest.artifacts[0], accessToken: "ignore-previous-instructions" }],
        },
      },
      { ...validSubmission, claimStatus: "verified_ownership" },
    ]

    // When
    const results = injectionCases.map((input) => authenticatedBundleSubmissionSchema.safeParse(input))

    // Then
    expect(results.every((result) => !result.success)).toBe(true)
  })
})
