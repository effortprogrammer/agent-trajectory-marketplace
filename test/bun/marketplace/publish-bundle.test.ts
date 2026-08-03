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

const insert = (archive: Buffer, offset: number, bytes: Buffer): Buffer =>
  Buffer.concat([archive.subarray(0, offset), bytes, archive.subarray(offset)])

const shiftArchiveAfterLocalInsertion = (archive: Buffer, insertedByteCount: number): void => {
  const endOffset = archive.length - 22
  const centralOffset = archive.readUInt32LE(endOffset + 16)
  archive.writeUInt32LE(centralOffset + insertedByteCount, endOffset + 16)
  const shiftedCentralOffset = centralOffset + insertedByteCount
  const expectedCount = archive.readUInt16LE(endOffset + 10)
  let centralPosition = shiftedCentralOffset
  for (let index = 0; index < expectedCount; index += 1) {
    const localOffset = archive.readUInt32LE(centralPosition + 42)
    if (localOffset > 0) archive.writeUInt32LE(localOffset + insertedByteCount, centralPosition + 42)
    centralPosition += 46
      + archive.readUInt16LE(centralPosition + 28)
      + archive.readUInt16LE(centralPosition + 30)
      + archive.readUInt16LE(centralPosition + 32)
  }
}

const insertLocalBytes = (archive: Buffer, bytes: Buffer, kind: "extra" | "name"): Buffer => {
  const nameLength = archive.readUInt16LE(26)
  const insertOffset = kind === "name" ? 30 : 30 + nameLength
  const mutated = insert(archive, insertOffset, bytes)
  const fieldOffset = kind === "name" ? 26 : 28
  mutated.writeUInt16LE(archive.readUInt16LE(fieldOffset) + bytes.length, fieldOffset)
  shiftArchiveAfterLocalInsertion(mutated, bytes.length)
  return mutated
}

const insertCentralBytes = (archive: Buffer, bytes: Buffer, kind: "comment" | "extra" | "name"): Buffer => {
  const endOffset = archive.length - 22
  const centralOffset = archive.readUInt32LE(endOffset + 16)
  const nameLength = archive.readUInt16LE(centralOffset + 28)
  const extraLength = archive.readUInt16LE(centralOffset + 30)
  const insertOffset = kind === "name"
    ? centralOffset + 46
    : centralOffset + 46 + nameLength + (kind === "extra" ? 0 : extraLength)
  const mutated = insert(archive, insertOffset, bytes)
  const fieldOffset = centralOffset + (kind === "name" ? 28 : kind === "extra" ? 30 : 32)
  mutated.writeUInt16LE(archive.readUInt16LE(fieldOffset) + bytes.length, fieldOffset)
  const shiftedEndOffset = endOffset + bytes.length
  mutated.writeUInt32LE(archive.readUInt32LE(endOffset + 12) + bytes.length, shiftedEndOffset + 12)
  return mutated
}

const opaqueMetadata = (archive: Buffer, location: "central_comment" | "central_extra" | "local_extra"): Buffer => {
  const hidden = Buffer.from("hidden-secret-metadata", "utf8")
  switch (location) {
    case "central_comment":
      return insertCentralBytes(archive, hidden, "comment")
    case "central_extra":
      return insertCentralBytes(archive, hidden, "extra")
    case "local_extra":
      return insertLocalBytes(archive, hidden, "extra")
  }
}

const bomName = (archive: Buffer, location: "both" | "central" | "local"): Buffer => {
  const bom = Buffer.from([0xef, 0xbb, 0xbf])
  if (location === "local") return insertLocalBytes(archive, bom, "name")
  if (location === "central") return insertCentralBytes(archive, bom, "name")
  return insertCentralBytes(insertLocalBytes(archive, bom, "name"), bom, "name")
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

  test.each([
    "central_comment",
    "central_extra",
    "local_extra",
  ] as const)("rejects hidden %s metadata before publication", (location) => {
    // Given: an otherwise valid ZIP carrying bytes outside the reviewed manifest and traces.
    const root = mkdtempSync(join(tmpdir(), "trajectory-publish-hidden-metadata-"))
    roots.push(root)
    const path = join(root, "candidate.zip")
    writeFileSync(path, opaqueMetadata(validArchive(), location))

    // When: the public bundle reader validates the local input.
    const read = (): void => {
      readPublishBundle(path)
    }

    // Then: opaque ZIP metadata cannot cross the publication boundary.
    expect(read).toThrow(PublishBundleError)
  })

  test.each(["local", "central", "both"] as const)("rejects %s UTF-8 BOM filename differentials", (location) => {
    // Given: raw local or central ZIP name bytes that decode to a misleading canonical name.
    const root = mkdtempSync(join(tmpdir(), "trajectory-publish-bom-name-"))
    roots.push(root)
    const path = join(root, "candidate.zip")
    writeFileSync(path, bomName(validArchive(), location))

    // When: the public bundle reader validates the local input.
    const read = (): void => {
      readPublishBundle(path)
    }

    // Then: raw filename bytes must match the canonical reviewed path exactly.
    expect(read).toThrow(PublishBundleError)
  })
})
