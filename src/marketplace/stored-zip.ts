const localHeaderSignature = 0x04034b50
const centralHeaderSignature = 0x02014b50
const endOfCentralDirectorySignature = 0x06054b50
const endOfCentralDirectoryBytes = 22
const zip32Max = 0xffffffff

export type StoredZipEntry = Readonly<{
  name: string
  data: Buffer
}>

export class StoredZipError extends Error {
  public constructor(
    public readonly reason:
      | "invalid_entry"
      | "duplicate_entry"
      | "zip32_limit"
      | "invalid_manifest"
      | "invalid_layout"
      | "trace_integrity",
  ) {
    super(reason)
    this.name = "StoredZipError"
  }
}

const crc32Table: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

const crc32 = (data: Buffer): number => {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = (crc >>> 8) ^ (crc32Table[(crc ^ byte) & 0xff] ?? 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const validateName = (name: string): Buffer => {
  const segments = name.split("/")
  const safe =
    /^[a-z0-9][a-z0-9._/-]*$/.test(name) &&
    !name.includes("\\") &&
    segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  const encoded = Buffer.from(name, "utf8")
  if (!safe || encoded.length > 0xffff) throw new StoredZipError("invalid_entry")
  return encoded
}

const writeStoredZip = (entries: readonly StoredZipEntry[]): Buffer => {
  if (entries.length === 0 || entries.length > 0xffff) throw new StoredZipError("zip32_limit")

  const names = new Set<string>()
  const prepared = entries.map((entry) => {
    const nameBytes = validateName(entry.name)
    if (names.has(entry.name)) throw new StoredZipError("duplicate_entry")
    names.add(entry.name)
    if (entry.data.length > zip32Max) throw new StoredZipError("zip32_limit")
    return { entry, nameBytes }
  })

  const estimatedBytes = prepared.reduce(
    (total, item) => total + 30 + item.nameBytes.length + item.entry.data.length + 46 + item.nameBytes.length,
    endOfCentralDirectoryBytes,
  )
  if (estimatedBytes > zip32Max) throw new StoredZipError("zip32_limit")

  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const { entry, nameBytes } of prepared) {
    const checksum = crc32(entry.data)
    const size = entry.data.length
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(localHeaderSignature, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(size, 18)
    localHeader.writeUInt32LE(size, 22)
    localHeader.writeUInt16LE(nameBytes.length, 26)
    localParts.push(localHeader, nameBytes, entry.data)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(centralHeaderSignature, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(size, 20)
    centralHeader.writeUInt32LE(size, 24)
    centralHeader.writeUInt16LE(nameBytes.length, 28)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, nameBytes)
    offset += localHeader.length + nameBytes.length + size
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(endOfCentralDirectoryBytes)
  end.writeUInt32LE(endOfCentralDirectorySignature, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, centralDirectory, end])
}

const parseManifest = (data: Buffer) => {
  if (data.length > datasetArchivePolicy.maxManifestBytes) throw new StoredZipError("invalid_manifest")

  let input: unknown
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data)
    input = JSON.parse(text)
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw new StoredZipError("invalid_manifest")
    }
    throw error
  }
  const parsed = datasetManifestSchema.safeParse(input)
  if (!parsed.success) throw new StoredZipError("invalid_manifest")
  return parsed.data
}

const estimateZipBytes = (entries: readonly StoredZipEntry[]): number =>
  entries.reduce((total, entry) => {
    const nameBytes = Buffer.byteLength(entry.name, "utf8")
    return total + 30 + nameBytes + entry.data.length + 46 + nameBytes
  }, endOfCentralDirectoryBytes)

export const writeDatasetZip = (entries: readonly StoredZipEntry[]): Buffer => {
  const manifests = entries.filter((entry) => entry.name === datasetManifestPath)
  if (manifests.length !== 1) throw new StoredZipError("invalid_layout")
  const manifestEntry = manifests[0]
  if (manifestEntry === undefined) throw new StoredZipError("invalid_layout")
  const manifest = parseManifest(manifestEntry.data)

  const traceEntries = entries.filter((entry) => entry.name !== datasetManifestPath)
  if (traceEntries.length !== manifest.artifacts.length) throw new StoredZipError("invalid_layout")
  const tracesByName = new Map<string, StoredZipEntry>()
  for (const entry of traceEntries) {
    if (tracesByName.has(entry.name)) throw new StoredZipError("duplicate_entry")
    tracesByName.set(entry.name, entry)
  }

  for (const artifact of manifest.artifacts) {
    const entry = tracesByName.get(artifact.path)
    if (entry === undefined) throw new StoredZipError("invalid_layout")
    const sha256 = createHash("sha256").update(entry.data).digest("hex")
    if (entry.data.length !== artifact.byteCount || sha256 !== artifact.sha256) {
      throw new StoredZipError("trace_integrity")
    }
  }

  const orderedTraces = [...traceEntries].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )
  const orderedEntries = [manifestEntry, ...orderedTraces]
  try {
    assertDatasetArchivePlan({
      manifestByteCount: manifestEntry.data.length,
      archiveByteCount: estimateZipBytes(orderedEntries),
      entries: orderedTraces.map((entry) => ({ name: entry.name, byteCount: entry.data.length })),
    })
  } catch (error) {
    if (error instanceof ArchiveContractError) throw new StoredZipError("invalid_layout")
    throw error
  }
  return writeStoredZip(orderedEntries)
}
import { createHash } from "node:crypto"

import {
  ArchiveContractError,
  assertDatasetArchivePlan,
  datasetArchivePolicy,
  datasetManifestPath,
  datasetManifestSchema,
} from "./archive-contract"
