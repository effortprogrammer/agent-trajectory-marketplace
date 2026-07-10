import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"
import { deflateRawSync } from "node:zlib"

// Hand-rolled zip writer for escrow intake tests. Building archives byte by
// byte is the point: every hardening rejection needs a deliberately
// malformed variant (lying sizes, encrypted flags, symlink attributes,
// traversal names) that no well-behaved zip library will produce.

export type ZipEntrySpec = Readonly<{
  name: string
  data: Buffer | string
  compression?: 0 | 8
  generalPurpose?: number
  externalAttributes?: number
  declaredUncompressedSize?: number
  declaredCompressedSize?: number
  compressionMethodOverride?: number
}>

type ZipBuildOptions = Readonly<{
  entryCountOverride?: number
  appendZip64Locator?: boolean
}>

const localHeader = (
  spec: ZipEntrySpec,
  compressed: Buffer,
  declaredUncompressed: number,
  method: number,
): Buffer => {
  const name = Buffer.from(spec.name, "utf8")
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(spec.generalPurpose ?? 0, 6)
  header.writeUInt16LE(method, 8)
  header.writeUInt32LE(0, 10)
  header.writeUInt32LE(0, 14)
  header.writeUInt32LE(compressed.length, 18)
  header.writeUInt32LE(declaredUncompressed, 22)
  header.writeUInt16LE(name.length, 26)
  header.writeUInt16LE(0, 28)
  return Buffer.concat([header, name])
}

const centralHeader = (
  spec: ZipEntrySpec,
  declaredUncompressed: number,
  declaredCompressed: number,
  method: number,
  localOffset: number,
): Buffer => {
  const name = Buffer.from(spec.name, "utf8")
  const header = Buffer.alloc(46)
  header.writeUInt32LE(0x02014b50, 0)
  header.writeUInt16LE(0x031e, 4)
  header.writeUInt16LE(20, 6)
  header.writeUInt16LE(spec.generalPurpose ?? 0, 8)
  header.writeUInt16LE(method, 10)
  header.writeUInt32LE(0, 12)
  header.writeUInt32LE(0, 16)
  header.writeUInt32LE(declaredCompressed, 20)
  header.writeUInt32LE(declaredUncompressed, 24)
  header.writeUInt16LE(name.length, 28)
  header.writeUInt16LE(0, 30)
  header.writeUInt16LE(0, 32)
  header.writeUInt16LE(0, 34)
  header.writeUInt16LE(0, 36)
  header.writeUInt32LE(spec.externalAttributes ?? (0o100644 << 16) >>> 0, 38)
  header.writeUInt32LE(localOffset, 42)
  return Buffer.concat([header, name])
}

export const buildZipArchive = (
  specs: readonly ZipEntrySpec[],
  options: ZipBuildOptions = {},
): Buffer => {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const spec of specs) {
    const data = typeof spec.data === "string" ? Buffer.from(spec.data, "utf8") : spec.data
    const compression = spec.compression ?? 8
    const compressed = compression === 8 ? deflateRawSync(data) : data
    const declaredUncompressed = spec.declaredUncompressedSize ?? data.length
    const declaredCompressed = spec.declaredCompressedSize ?? compressed.length
    const method = spec.compressionMethodOverride ?? compression
    const local = localHeader(spec, compressed, declaredUncompressed, method)
    locals.push(local, compressed)
    centrals.push(centralHeader(spec, declaredUncompressed, declaredCompressed, method, offset))
    offset += local.length + compressed.length
  }
  const directory = Buffer.concat(centrals)
  const locator = options.appendZip64Locator === true ? Buffer.alloc(20) : Buffer.alloc(0)
  if (options.appendZip64Locator === true) {
    locator.writeUInt32LE(0x07064b50, 0)
  }
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  const entryCount = options.entryCountOverride ?? specs.length
  eocd.writeUInt16LE(entryCount, 8)
  eocd.writeUInt16LE(entryCount, 10)
  eocd.writeUInt32LE(directory.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, directory, locator, eocd])
}

// Well-formed escrow dataset archive: manifest with correct server-matching
// hashes plus ATF trace entries. The base fixture for intake and route tests;
// pass overrides to poison specific aspects.
export type EscrowTraceSpec = Readonly<{
  name: string
  trace: unknown
}>

export type EscrowArchiveOverrides = Readonly<{
  manifestOverride?: unknown
  extraEntries?: readonly ZipEntrySpec[]
  omitManifest?: boolean
  artifactPatch?: (
    artifact: { path: string; label: string; sha256: string; byteCount: number },
    index: number,
  ) => { path: string; label: string; sha256: string; byteCount: number }
}>

export const demoTraceDocument = (events: readonly Record<string, string>[]) => ({
  runtime: "hermes",
  status: "collected",
  eventCount: events.length,
  events,
})

export const buildEscrowDatasetArchive = (
  traces: readonly EscrowTraceSpec[],
  overrides: EscrowArchiveOverrides = {},
): Buffer => {
  const traceEntries = traces.map((spec) => ({
    name: spec.name,
    data: Buffer.from(JSON.stringify(spec.trace), "utf8"),
  }))
  const artifacts = traceEntries.map((entry, index) => {
    const artifact = {
      path: entry.name,
      label: entry.name.replace(/^traces\//, "").replace(/\.atf\.json$/, ""),
      sha256: createHash("sha256").update(entry.data).digest("hex"),
      byteCount: entry.data.length,
    }
    return overrides.artifactPatch === undefined
      ? artifact
      : overrides.artifactPatch(artifact, index)
  })
  const manifest = overrides.manifestOverride ?? { formatVersion: 1, artifacts }
  const entries: ZipEntrySpec[] = [
    ...(overrides.omitManifest === true
      ? []
      : [{ name: "dataset-manifest.json", data: JSON.stringify(manifest) }]),
    ...traceEntries,
    ...(overrides.extraEntries ?? []),
  ]
  return buildZipArchive(entries)
}
