import { z } from "zod"
import {
  ReleaseContractError,
  UPDATE_RELEASE,
  type UpdateReleaseManifest,
} from "./update-release-contract"

const tarBlockBytes = 512
const maxExpandedBytes = UPDATE_RELEASE.archiveMaxBytes * 4
const packageJsonSchema = z
  .object({
    name: z.literal(UPDATE_RELEASE.packageName),
    version: z.string(),
  })
  .passthrough()

export type VerifiedReleaseArchive = {
  readonly byteLength: number
  readonly sha256: string
  readonly version: string
}

export async function verifyUpdateReleaseArchive(
  archive: Uint8Array,
  manifest: UpdateReleaseManifest,
): Promise<VerifiedReleaseArchive> {
  if (
    archive.byteLength !== manifest.archive.size ||
    archive.byteLength > UPDATE_RELEASE.archiveMaxBytes
  ) {
    throw new ReleaseContractError("binding-mismatch", "archive size does not match manifest")
  }
  const digest = new Bun.CryptoHasher("sha256").update(archive).digest("hex")
  if (digest !== manifest.archive.sha256) {
    throw new ReleaseContractError("binding-mismatch", "archive checksum does not match manifest")
  }

  const tar = await decompressGzipBounded(archive)
  const packageVersion = inspectTar(tar)
  if (packageVersion !== manifest.version) {
    throw new ReleaseContractError(
      "binding-mismatch",
      "archive package version does not match manifest",
    )
  }
  return { byteLength: archive.byteLength, sha256: digest, version: packageVersion }
}

async function decompressGzipBounded(archive: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([archive]).stream().pipeThrough(new DecompressionStream("gzip"))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let expandedBytes = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) {
        break
      }
      expandedBytes += result.value.byteLength
      if (expandedBytes > maxExpandedBytes) {
        throw new ReleaseContractError("invalid-release", "expanded archive is too large")
      }
      chunks.push(result.value)
    }
  } catch (error) {
    if (error instanceof ReleaseContractError) {
      throw error
    }
    throw new ReleaseContractError("invalid-release", "archive is not valid gzip")
  } finally {
    reader.releaseLock()
  }

  const tar = new Uint8Array(expandedBytes)
  let offset = 0
  for (const chunk of chunks) {
    tar.set(chunk, offset)
    offset += chunk.byteLength
  }
  return tar
}

function inspectTar(tar: Uint8Array): string {
  const paths = new Set<string>()
  let packageVersion: string | undefined
  let offset = 0
  while (offset + tarBlockBytes <= tar.byteLength) {
    const header = tar.subarray(offset, offset + tarBlockBytes)
    if (header.every((byte) => byte === 0)) {
      break
    }
    verifyTarHeaderChecksum(header)
    const path = tarPath(header)
    if (paths.has(path)) {
      throw new ReleaseContractError("invalid-release", "archive contains duplicate paths")
    }
    paths.add(path)
    const size = parseTarOctal(header.subarray(124, 136))
    const type = String.fromCharCode(header[156] ?? 0)
    const contentOffset = offset + tarBlockBytes
    const contentEnd = contentOffset + size
    if (contentEnd > tar.byteLength) {
      throw new ReleaseContractError("invalid-release", "archive entry is truncated")
    }
    if (type === "1" || type === "2") {
      throw new ReleaseContractError("invalid-release", "archive links are forbidden")
    }
    if (type !== "\0" && type !== "0" && type !== "5") {
      throw new ReleaseContractError("invalid-release", "archive entry type is forbidden")
    }
    verifyTarPath(path, type === "5")
    if (path === `${UPDATE_RELEASE.packageDirectory}package.json` && type !== "5") {
      if (packageVersion !== undefined) {
        throw new ReleaseContractError("invalid-release", "archive package metadata is duplicated")
      }
      packageVersion = parsePackageVersion(tar.subarray(contentOffset, contentEnd))
    }
    offset = contentOffset + Math.ceil(size / tarBlockBytes) * tarBlockBytes
  }
  if (packageVersion === undefined) {
    throw new ReleaseContractError("invalid-release", "archive package metadata is missing")
  }
  return packageVersion
}

function verifyTarPath(path: string, directory: boolean): void {
  const rootDirectory = UPDATE_RELEASE.packageDirectory.slice(0, -1)
  const comparable = directory && path.endsWith("/") ? path.slice(0, -1) : path
  const components = comparable.split("/")
  if (
    path.includes("\\") ||
    path.startsWith("/") ||
    components.some((component) => component === "" || component === "." || component === "..") ||
    (comparable !== rootDirectory && !path.startsWith(UPDATE_RELEASE.packageDirectory))
  ) {
    throw new ReleaseContractError("invalid-release", "archive path is unsafe")
  }
}

function tarPath(header: Uint8Array): string {
  const decoder = new TextDecoder("utf-8", { fatal: true })
  try {
    const name = decoder.decode(trimNulls(header.subarray(0, 100)))
    const prefix = decoder.decode(trimNulls(header.subarray(345, 500)))
    const path = prefix.length > 0 ? `${prefix}/${name}` : name
    if (path.length === 0) {
      throw new ReleaseContractError("invalid-release", "archive path is empty")
    }
    return path
  } catch (error) {
    if (error instanceof ReleaseContractError) {
      throw error
    }
    throw new ReleaseContractError("invalid-release", "archive path is malformed")
  }
}

function parsePackageVersion(content: Uint8Array): string {
  try {
    const parsed = packageJsonSchema.safeParse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content)),
    )
    if (!parsed.success) {
      throw new ReleaseContractError("binding-mismatch", "archive package identity is invalid")
    }
    return parsed.data.version
  } catch (error) {
    if (error instanceof ReleaseContractError) {
      throw error
    }
    throw new ReleaseContractError("invalid-release", "archive package metadata is malformed")
  }
}

function parseTarOctal(field: Uint8Array): number {
  const value = new TextDecoder().decode(field).replace(/\0.*$/, "").trim()
  if (!/^[0-7]+$/.test(value)) {
    throw new ReleaseContractError("invalid-release", "archive entry size is malformed")
  }
  const parsed = Number.parseInt(value, 8)
  if (!Number.isSafeInteger(parsed)) {
    throw new ReleaseContractError("invalid-release", "archive entry size is unsafe")
  }
  return parsed
}

function verifyTarHeaderChecksum(header: Uint8Array): void {
  const expected = parseTarOctal(header.subarray(148, 156))
  let actual = 0
  for (let index = 0; index < header.byteLength; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : (header[index] ?? 0)
  }
  if (actual !== expected) {
    throw new ReleaseContractError("invalid-release", "archive header checksum is invalid")
  }
}

function trimNulls(input: Uint8Array): Uint8Array {
  const nullIndex = input.indexOf(0)
  return nullIndex === -1 ? input : input.subarray(0, nullIndex)
}

