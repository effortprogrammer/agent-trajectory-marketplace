import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readPublishBundle } from "../../../src/marketplace/publish-bundle"
import {
  PublishWireContractError,
  encodeCandidateJson,
} from "../../../src/marketplace/publish-contract"
import {
  createPublishFrameBody,
  encodePublishFrame,
  parsePublishFrame,
} from "../../../src/marketplace/publish-frame"

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

  it("ships an accepted fixture whose archive satisfies the dataset bundle contract", () => {
    // Given: the frozen accepted frame and an isolated regular file for its embedded archive.
    const frame = parsePublishFrame(readFileSync("contract/publish-wire/v1/candidate-valid.frame"))
    const root = mkdtempSync(join(tmpdir(), "trajectory-publish-fixture-"))
    const path = join(root, "candidate.zip")
    writeFileSync(path, frame.archive)

    // When: the same reader used by the public CLI validates the fixture archive.
    try {
      const bundle = readPublishBundle(path)

      // Then: the fixture candidate describes the exact valid dataset bundle.
      expect(bundle).toEqual({ archive: frame.archive, candidate: frame.candidate })
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it("streams an admitted archive without materializing a second archive or complete frame", async () => {
    // Given: a representative large archive and a candidate derived from those exact bytes.
    const admittedArchive = Buffer.alloc(8 * 1024 * 1024, 0x61)
    const admittedArchiveSha256 = createHash("sha256").update(admittedArchive).digest("hex")
    const admittedCandidate = {
      ...candidate,
      archiveSha256: admittedArchiveSha256,
      archiveByteCount: admittedArchive.length,
      bundleId: `bundle-${admittedArchiveSha256}`,
    }

    // When: the HTTP body is framed as a bounded stream.
    const framed = createPublishFrameBody(admittedCandidate, admittedArchive)
    const reader = framed.body.getReader()
    const chunks: Uint8Array[] = []
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      chunks.push(result.value)
    }

    // Then: framing retains the caller-owned archive as one stream chunk instead of copying it.
    expect(chunks).toHaveLength(3)
    expect(chunks[2]).toBe(admittedArchive)
    expect(chunks.reduce((total, chunk) => total + chunk.byteLength, 0)).toBe(framed.contentLength)
  })
})
