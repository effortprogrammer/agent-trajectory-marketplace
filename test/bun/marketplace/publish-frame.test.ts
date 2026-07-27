import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"

import {
  PublishWireContractError,
  encodeCandidateJson,
} from "../../../src/marketplace/publish-contract"
import { encodePublishFrame, parsePublishFrame } from "../../../src/marketplace/publish-frame"

const archive = Buffer.from("PK\u0003\u0004frozen-dataset", "utf8")
const archiveSha256 = createHash("sha256").update(archive).digest("hex")
const manifestBytes = Buffer.from('{"formatVersion":1,"artifacts":[]}', "utf8")
const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex")
const candidate = {
  protocolVersion: 1,
  bundleId: `bundle-${archiveSha256}`,
  archiveSha256,
  archiveByteCount: archive.length,
  manifestSha256,
  artifactCount: 1,
}

describe("publish frame", () => {
  it("encodes the frozen candidate bytes before the ZIP at the declared uint32BE offset", () => {
    // Given
    const candidateBytes = encodeCandidateJson(candidate)

    // When
    const frame = encodePublishFrame(candidate, archive)

    // Then
    expect(frame.readUInt32BE(0)).toBe(candidateBytes.length)
    expect(frame.subarray(4, 4 + candidateBytes.length).equals(candidateBytes)).toBe(true)
    expect(frame.subarray(4 + candidateBytes.length).equals(archive)).toBe(true)
  })

  it("rejects mutated uint32 length and zip bytes", () => {
    // Given
    const frame = encodePublishFrame(candidate, archive)
    const mutatedLength = Buffer.from(frame)
    mutatedLength.writeUInt32BE(encodeCandidateJson(candidate).length + 1, 0)
    const mutatedZip = Buffer.from(frame)
    mutatedZip[mutatedZip.length - 1] ^= 1

    // When
    const parseLength = (): void => {
      parsePublishFrame(mutatedLength)
    }
    const parseZip = (): void => {
      parsePublishFrame(mutatedZip)
    }

    // Then
    for (const action of [parseLength, parseZip]) {
      expect(action).toThrow(PublishWireContractError)
      try {
        action()
      } catch (error) {
        expect(error).toBeInstanceOf(PublishWireContractError)
        if (error instanceof PublishWireContractError) expect(error.code).toBe("invalid_candidate")
      }
    }
  })
})
