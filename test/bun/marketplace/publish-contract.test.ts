import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"

import {
  PublishWireContractError,
  createCandidateFromExactBytes,
  encodeCandidateJson,
  parseCandidateJson,
} from "../../../src/marketplace/publish-contract"

const archive = Buffer.from("exact archive bytes", "utf8")
const manifest = Buffer.from('{"formatVersion":1,"artifacts":[]}', "utf8")
const candidate = createCandidateFromExactBytes({ archive, manifest, artifactCount: 1 })

describe("publish candidate contract", () => {
  it("derives every digest from the exact unparsed input bytes and emits frozen property order", () => {
    // Given
    const expectedArchiveSha256 = createHash("sha256").update(archive).digest("hex")
    const expectedManifestSha256 = createHash("sha256").update(manifest).digest("hex")

    // When
    const encoded = encodeCandidateJson(candidate)

    // Then
    expect(encoded.toString("utf8")).toBe(
      `{\"protocolVersion\":1,\"bundleId\":\"bundle-${expectedArchiveSha256}\",\"archiveSha256\":\"${expectedArchiveSha256}\",\"archiveByteCount\":${archive.length},\"manifestSha256\":\"${expectedManifestSha256}\",\"artifactCount\":1}`,
    )
  })

  it("rejects forbidden identity fields and non-canonical candidate JSON", () => {
    // Given
    const identity = Buffer.from(`${encodeCandidateJson(candidate).toString("utf8").slice(0, -1)},\"accountId\":\"acct-forbidden\"}`, "utf8")
    const reordered = Buffer.from(
      JSON.stringify({
        archiveSha256: candidate.archiveSha256,
        protocolVersion: candidate.protocolVersion,
        bundleId: candidate.bundleId,
        archiveByteCount: candidate.archiveByteCount,
        manifestSha256: candidate.manifestSha256,
        artifactCount: candidate.artifactCount,
      }),
      "utf8",
    )

    // When
    const parseIdentity = (): void => {
      parseCandidateJson(identity)
    }
    const parseReordered = (): void => {
      parseCandidateJson(reordered)
    }

    // Then
    for (const action of [parseIdentity, parseReordered]) {
      expect(action).toThrow(PublishWireContractError)
    }
  })

  it("rejects malformed UTF-8 and candidate JSON above the frozen 64 KiB cap", () => {
    // Given
    const malformedUtf8 = Buffer.from([0xff])
    const oversized = Buffer.alloc(64 * 1024 + 1, 0x20)

    // When
    const parseMalformed = (): void => {
      parseCandidateJson(malformedUtf8)
    }
    const parseOversized = (): void => {
      parseCandidateJson(oversized)
    }

    // Then
    expect(parseMalformed).toThrow(PublishWireContractError)
    expect(parseOversized).toThrow(PublishWireContractError)
  })
})
