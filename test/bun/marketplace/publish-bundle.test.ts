import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { encodeDatasetManifest } from "../../../src/marketplace/archive-contract"
import { PublishBundleError, readPublishBundle } from "../../../src/marketplace/publish-bundle"
import { writeDatasetZip } from "../../../src/marketplace/stored-zip"

const roots: string[] = []

const validArchive = (): Buffer => {
  const trace = Buffer.from('{"runtime":"codex","status":"collected","eventCount":0,"events":[]}', "utf8")
  const label = `s-${"0".repeat(64)}`
  const path = `traces/${label}.atf.json`
  const manifest = encodeDatasetManifest({
    artifacts: [{ byteCount: trace.length, label, path, sha256: createHash("sha256").update(trace).digest("hex") }],
    formatVersion: 1,
  })
  return writeDatasetZip([{ data: manifest, name: "dataset-manifest.json" }, { data: trace, name: path }])
}

const corruptCrc = (archive: Buffer, location: "both" | "central" | "local"): Buffer => {
  const corrupted = Buffer.from(archive)
  const endOffset = corrupted.length - 22
  const centralOffset = corrupted.readUInt32LE(endOffset + 16)
  if (location === "both" || location === "local") corrupted.writeUInt32LE(0, 14)
  if (location === "both" || location === "central") corrupted.writeUInt32LE(0, centralOffset + 16)
  return corrupted
}

const corruptMetadata = (
  archive: Buffer,
  field: "central_disk_start" | "eocd_comment_length" | "eocd_disk" | "eocd_entries_on_disk",
): Buffer => {
  const corrupted = Buffer.from(archive)
  const endOffset = corrupted.length - 22
  const centralOffset = corrupted.readUInt32LE(endOffset + 16)
  switch (field) {
    case "central_disk_start":
      corrupted.writeUInt16LE(1, centralOffset + 34)
      break
    case "eocd_comment_length":
      corrupted.writeUInt16LE(1, endOffset + 20)
      break
    case "eocd_disk":
      corrupted.writeUInt16LE(1, endOffset + 4)
      break
    case "eocd_entries_on_disk":
      corrupted.writeUInt16LE(1, endOffset + 8)
      break
  }
  return corrupted
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe("publish bundle ZIP integrity", () => {
  test.each(["local", "central", "both"] as const)("rejects corrupted %s CRC before publication", (location) => {
    // Given: a valid dataset ZIP whose declared CRC integrity is corrupted.
    const root = mkdtempSync(join(tmpdir(), "trajectory-publish-crc-"))
    roots.push(root)
    const path = join(root, "candidate.zip")
    writeFileSync(path, corruptCrc(validArchive(), location))

    // When: the public bundle reader validates the local input.
    const read = (): void => {
      readPublishBundle(path)
    }

    // Then: malformed ZIP bytes cannot cross the network boundary.
    expect(read).toThrow(PublishBundleError)
  })

  test.each([
    "central_disk_start",
    "eocd_comment_length",
    "eocd_disk",
    "eocd_entries_on_disk",
  ] as const)("rejects unsupported or inconsistent %s metadata", (field) => {
    // Given: an otherwise valid dataset ZIP with malformed ZIP32 topology metadata.
    const root = mkdtempSync(join(tmpdir(), "trajectory-publish-metadata-"))
    roots.push(root)
    const path = join(root, "candidate.zip")
    writeFileSync(path, corruptMetadata(validArchive(), field))

    // When: the public bundle reader validates the local input.
    const read = (): void => {
      readPublishBundle(path)
    }

    // Then: unsupported disk layouts and impossible EOCD metadata are rejected locally.
    expect(read).toThrow(PublishBundleError)
  })
})
