import { describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  parsePublishBundle,
  readPublishBundle,
} from "../../../src/marketplace/publish-bundle"
import {
  PublishWireContractError,
  encodeCandidateJson,
} from "../../../src/marketplace/publish-contract"
import {
  createPublishFrameBody,
  encodePublishFrame,
  parsePublishFrame,
} from "../../../src/marketplace/publish-frame"

const fixture = parsePublishFrame(readFileSync("contract/publish-wire/v1/candidate-valid.frame"))
const { archive, candidate } = fixture

const rawFrame = (input: unknown, archiveBytes: Uint8Array): Buffer => {
  const candidateBytes = encodeCandidateJson(input)
  const header = Buffer.allocUnsafe(4)
  header.writeUInt32BE(candidateBytes.length, 0)
  return Buffer.concat([header, candidateBytes, archiveBytes])
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
      expect(bundle.archive).toEqual(frame.archive)
      expect(bundle.candidate).toEqual(frame.candidate)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it.each([
    { field: "manifestSha256", value: "0".repeat(64) },
    { field: "artifactCount", value: candidate.artifactCount + 1 },
  ] as const)("binds candidate $field to the embedded dataset ZIP", ({ field, value }) => {
    // Given: valid archive bytes with canonical but false candidate metadata.
    const substituted = { ...candidate, [field]: value }
    const maliciousFrame = rawFrame(substituted, archive)

    // When: both local encoding and received-frame parsing validate those bytes.
    const encode = (): void => {
      encodePublishFrame(substituted, archive)
    }
    const parse = (): void => {
      parsePublishFrame(maliciousFrame)
    }

    // Then: neither boundary accepts candidate metadata that does not describe the ZIP.
    expect(encode).toThrow(PublishWireContractError)
    expect(parse).toThrow(PublishWireContractError)
  })

  it("transfers archive ownership before exposing streamed bytes", async () => {
    // Given: a valid bundle archive whose caller retains a mutable reference.
    const admittedArchive = Buffer.allocUnsafeSlow(archive.byteLength)
    admittedArchive.set(archive)
    const archiveByteCount = admittedArchive.byteLength
    const bundle = parsePublishBundle(admittedArchive)

    // When: the HTTP body is framed as a bounded stream.
    const framed = createPublishFrameBody(bundle)
    if (admittedArchive.byteLength > 0) admittedArchive[admittedArchive.byteLength - 1] ^= 1
    const reader = framed.body.getReader()
    const chunks: Uint8Array[] = []
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      chunks.push(result.value)
    }

    // Then: the caller is detached and the internal frame still describes the admitted archive exactly.
    const emitted = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
    expect(chunks).toHaveLength(3)
    expect(admittedArchive.byteLength).toBe(0)
    expect(chunks[2]).not.toBe(admittedArchive)
    expect(chunks[2]?.byteLength).toBe(archiveByteCount)
    expect(chunks.reduce((total, chunk) => total + chunk.byteLength, 0)).toBe(framed.contentLength)
    expect(parsePublishFrame(emitted)).toEqual(fixture)
  })

  it("isolates archive subviews without detaching sibling storage", async () => {
    // Given: a valid archive in the middle of caller-owned backing storage.
    const backing = Buffer.allocUnsafeSlow(archive.byteLength + 16)
    backing.fill(0x7a)
    archive.copy(backing, 8)
    const prefix = backing.subarray(0, 8)
    const selected = backing.subarray(8, 8 + archive.byteLength)
    const suffix = backing.subarray(8 + archive.byteLength)
    const expectedPrefix = Buffer.from(prefix)
    const expectedSuffix = Buffer.from(suffix)
    const bundle = parsePublishBundle(selected)

    // When: only the selected archive view is framed.
    const framed = createPublishFrameBody(bundle)
    const reader = framed.body.getReader()
    while (!(await reader.read()).done) {
      // Drain the exact framed stream.
    }

    // Then: unrelated caller storage stays attached and byte-identical.
    expect(backing.byteLength).toBe(archive.byteLength + 16)
    expect(prefix).toEqual(expectedPrefix)
    expect(suffix).toEqual(expectedSuffix)
    expect(selected.byteLength).toBe(archive.byteLength)
  })

  it("consumes an admitted bundle exactly once", () => {
    // Given: one bundle admitted from exact archive bytes.
    const bundle = parsePublishBundle(Buffer.from(archive))

    // When: framing consumes its ownership token.
    createPublishFrameBody(bundle)
    const reuse = (): void => {
      createPublishFrameBody(bundle)
    }

    // Then: a second attempt must perform a fresh bundle admission.
    expect(reuse).toThrow(PublishWireContractError)
  })
})
