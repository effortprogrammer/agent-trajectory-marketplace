import { createHash } from "node:crypto"
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs"
import { isAbsolute } from "node:path"

import { datasetArchivePolicy, datasetManifestPath, datasetManifestSchema } from "./archive-contract"
import { createCandidateFromExactBytes } from "./publish-contract"
import type { PublishCandidate } from "./publish-contract"
import { crc32 } from "./zip-crc32"

const localHeader = 0x04034b50
const centralHeader = 0x02014b50
const endHeader = 0x06054b50
const endBytes = 22
const maxEntryCount = datasetArchivePolicy.maxTraces + 1

export class PublishBundleError extends Error {
  readonly name = "PublishBundleError"
  constructor(readonly code: "invalid_bundle_request") { super(code) }
}

type BundleEntry = Readonly<{
  readonly crc32: number
  readonly data: Buffer
  readonly name: string
  readonly nameBytes: Buffer
  readonly offset: number
}>
export type PublishBundle = Readonly<{ readonly archive: Buffer; readonly candidate: PublishCandidate }>

const invalid = (): never => { throw new PublishBundleError("invalid_bundle_request") }

const sameFile = (left: Readonly<{ readonly dev: number; readonly ino: number; readonly size: number }>, right: Readonly<{ readonly dev: number; readonly ino: number; readonly size: number }>): boolean => left.dev === right.dev && left.ino === right.ino && left.size === right.size

const readBundle = (path: string): Buffer => {
  if (!isAbsolute(path) || path.includes("\0")) return invalid()
  let descriptor: number | undefined
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const before = fstatSync(descriptor)
    if (!before.isFile() || before.size <= 0 || before.size > datasetArchivePolicy.maxArchiveBytes) return invalid()
    const bytes = Buffer.allocUnsafe(before.size)
    let offset = 0
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset)
      if (count <= 0) return invalid()
      offset += count
    }
    if (!sameFile(before, fstatSync(descriptor))) return invalid()
    return bytes
  } catch (error) {
    if (error instanceof PublishBundleError) throw error
    return invalid()
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

const readEntries = (archive: Buffer): readonly BundleEntry[] => {
  const endOffset = archive.length - endBytes
  if (archive.length < endBytes || archive.readUInt32LE(endOffset) !== endHeader) return invalid()
  const disk = archive.readUInt16LE(endOffset + 4)
  const centralDisk = archive.readUInt16LE(endOffset + 6)
  const entriesOnDisk = archive.readUInt16LE(endOffset + 8)
  const expectedCount = archive.readUInt16LE(endOffset + 10)
  const centralSize = archive.readUInt32LE(endOffset + 12)
  const centralOffset = archive.readUInt32LE(endOffset + 16)
  const commentLength = archive.readUInt16LE(endOffset + 20)
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== expectedCount ||
    expectedCount === 0 ||
    expectedCount > maxEntryCount ||
    commentLength !== 0
  ) return invalid()
  if (centralOffset > endOffset || centralSize !== endOffset - centralOffset) return invalid()
  const entries: BundleEntry[] = []
  const entriesByOffset = new Map<number, BundleEntry>()
  let offset = 0
  while (offset < centralOffset) {
    if (entries.length >= expectedCount) return invalid()
    if (offset + 30 > centralOffset || archive.readUInt32LE(offset) !== localHeader) return invalid()
    const flags = archive.readUInt16LE(offset + 6)
    const compression = archive.readUInt16LE(offset + 8)
    const checksum = archive.readUInt32LE(offset + 14)
    const compressedSize = archive.readUInt32LE(offset + 18)
    const size = archive.readUInt32LE(offset + 22)
    const nameLength = archive.readUInt16LE(offset + 26)
    const extraLength = archive.readUInt16LE(offset + 28)
    if (flags !== 0 || compression !== 0 || compressedSize !== size || extraLength !== 0) return invalid()
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const dataEnd = dataStart + size
    if (dataEnd > centralOffset) return invalid()
    const nameBytes = archive.subarray(nameStart, nameStart + nameLength)
    let name: string
    try { name = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(nameBytes) } catch { return invalid() }
    if (name.length === 0 || name.includes("\\") || name.split("/").some((part) => part === "" || part === "." || part === "..")) return invalid()
    const data = archive.subarray(dataStart, dataEnd)
    if (crc32(data) !== checksum) return invalid()
    const entry = { crc32: checksum, data, name, nameBytes, offset }
    entries.push(entry)
    entriesByOffset.set(offset, entry)
    offset = dataEnd
  }
  let centralPosition = centralOffset
  for (let index = 0; index < expectedCount; index += 1) {
    if (centralPosition + 46 > endOffset || archive.readUInt32LE(centralPosition) !== centralHeader) return invalid()
    const flags = archive.readUInt16LE(centralPosition + 8)
    const compression = archive.readUInt16LE(centralPosition + 10)
    const checksum = archive.readUInt32LE(centralPosition + 16)
    const compressedSize = archive.readUInt32LE(centralPosition + 20)
    const size = archive.readUInt32LE(centralPosition + 24)
    const nameLength = archive.readUInt16LE(centralPosition + 28)
    const extraLength = archive.readUInt16LE(centralPosition + 30)
    const commentLength = archive.readUInt16LE(centralPosition + 32)
    const diskStart = archive.readUInt16LE(centralPosition + 34)
    const localOffset = archive.readUInt32LE(centralPosition + 42)
    if (
      flags !== 0 ||
      compression !== 0 ||
      compressedSize !== size ||
      extraLength !== 0 ||
      commentLength !== 0 ||
      diskStart !== 0
    ) return invalid()
    const nameBytes = archive.subarray(centralPosition + 46, centralPosition + 46 + nameLength)
    let name: string
    try { name = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(nameBytes) } catch { return invalid() }
    const local = entriesByOffset.get(localOffset)
    if (
      local === undefined ||
      local.name !== name ||
      !local.nameBytes.equals(nameBytes) ||
      local.data.length !== size ||
      local.crc32 !== checksum
    ) return invalid()
    entriesByOffset.delete(localOffset)
    centralPosition += 46 + nameLength + extraLength + commentLength
  }
  if (centralPosition !== endOffset) return invalid()
  if (entries.length !== expectedCount || entriesByOffset.size !== 0) return invalid()
  return entries
}

export const parsePublishBundle = (archive: Buffer): PublishBundle => {
  const entries = readEntries(archive)
  const names = new Set(entries.map((entry) => entry.name))
  if (names.size !== entries.length || !names.has(datasetManifestPath)) return invalid()
  const manifestEntry = entries.find((entry) => entry.name === datasetManifestPath)
  if (manifestEntry === undefined || manifestEntry.data.length > datasetArchivePolicy.maxManifestBytes) return invalid()
  let manifestInput: unknown
  try { manifestInput = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestEntry.data)) } catch { return invalid() }
  const manifest = datasetManifestSchema.safeParse(manifestInput)
  if (!manifest.success || entries.length !== manifest.data.artifacts.length + 1) return invalid()
  for (const artifact of manifest.data.artifacts) {
    const entry = entries.find((candidate) => candidate.name === artifact.path)
    if (entry === undefined || entry.data.length !== artifact.byteCount || createHash("sha256").update(entry.data).digest("hex") !== artifact.sha256) return invalid()
  }
  return { archive, candidate: createCandidateFromExactBytes({ archive, artifactCount: manifest.data.artifacts.length, manifest: manifestEntry.data }) }
}

export const readPublishBundle = (path: string): PublishBundle => parsePublishBundle(readBundle(path))
