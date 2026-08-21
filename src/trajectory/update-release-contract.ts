import { z } from "zod"

export const UPDATE_RELEASE = {
  archiveMaxBytes: 64 * 1024 * 1024,
  archiveRedirectHosts: ["github.com", "release-assets.githubusercontent.com"],
  manifestAssetName: "atm-release-manifest.json",
  manifestMaxBytes: 64 * 1024,
  maxRedirects: 3,
  packageDirectory: "agent-trajectory-marketplace/",
  packageName: "agent-trajectory-marketplace",
  repository: "effortprogrammer/agent-trajectory-marketplace",
} as const

const semanticVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const calendarVersionPattern =
  /^([1-9]\d{3})\.(0[1-9]|1[0-2])\.(0[1-9]|[12]\d|3[01])\.(0|[1-9]\d*)$/
const checksumPattern = /^[a-f0-9]{64}$/

export const isStableVersion = (input: string): boolean => {
  if (semanticVersionPattern.test(input)) return true
  const matched = calendarVersionPattern.exec(input)
  if (matched === null) return false
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  return new Date(Date.UTC(year, month, 0)).getUTCDate() >= day
}

const stableVersionSchema = z
  .string()
  .refine(isStableVersion)
  .brand<"StableVersion">()
const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    packageName: z.literal(UPDATE_RELEASE.packageName),
    version: stableVersionSchema,
    tag: z.string(),
    archive: z
      .object({
        name: z.string(),
        size: z.number().int().positive().max(UPDATE_RELEASE.archiveMaxBytes),
        sha256: z.string().regex(checksumPattern),
      })
      .strict(),
  })
  .strict()

const releaseAssetSchema = z
  .object({
    name: z.string(),
    size: z.number().int().positive(),
    digest: z.string().nullable(),
    browser_download_url: z.string(),
  })
  .passthrough()

const githubReleaseSchema = z
  .object({
    tag_name: z.string(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    immutable: z.literal(true),
    assets: z.array(releaseAssetSchema),
  })
  .passthrough()

export type StableVersion = z.infer<typeof stableVersionSchema>
export type UpdateReleaseManifest = z.infer<typeof manifestSchema>
export type GitHubRelease = z.infer<typeof githubReleaseSchema>
export type GitHubReleaseAsset = z.infer<typeof releaseAssetSchema>

export type ManifestBinding = {
  readonly currentVersion: string
  readonly releaseTag: string
  readonly archiveAsset: {
    readonly name: string
    readonly size: number
    readonly digest: string | null
  }
}

export type ReleaseContractErrorCode =
  | "invalid-release"
  | "invalid-manifest"
  | "non-upgrade"
  | "binding-mismatch"

export class ReleaseContractError extends Error {
  readonly code: ReleaseContractErrorCode

  constructor(code: ReleaseContractErrorCode, message: string) {
    super(message)
    this.name = "ReleaseContractError"
    this.code = code
  }
}

export function parseStableVersion(input: string): StableVersion {
  const parsed = stableVersionSchema.safeParse(input)
  if (!parsed.success) {
    throw new ReleaseContractError(
      "invalid-manifest",
      "version must be stable X.Y.Z or YYYY.MM.DD.N",
    )
  }
  return parsed.data
}

export function compareStableVersions(left: StableVersion, right: StableVersion): number {
  const leftParts = left.split(".")
  const rightParts = right.split(".")
  const componentCount = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < componentCount; index += 1) {
    const leftPart = leftParts[index] ?? "0"
    const rightPart = rightParts[index] ?? "0"
    const difference = BigInt(leftPart) - BigInt(rightPart)
    if (difference !== 0n) {
      return difference > 0n ? 1 : -1
    }
  }
  if (leftParts.length !== rightParts.length) {
    return leftParts.length > rightParts.length ? 1 : -1
  }
  return 0
}

export function releaseApiUrl(tag: string): string {
  const version = parseTag(tag)
  return `https://api.github.com/repos/${UPDATE_RELEASE.repository}/releases/tags/v${version}`
}

export function releaseAssetUrl(tag: string, assetName: string): string {
  const version = parseTag(tag)
  const expectedNames = new Set([UPDATE_RELEASE.manifestAssetName, `atm-v${version}.tar.gz`])
  if (!expectedNames.has(assetName)) {
    throw new ReleaseContractError("binding-mismatch", "unexpected release asset name")
  }
  return `https://github.com/${UPDATE_RELEASE.repository}/releases/download/v${version}/${assetName}`
}

export function parseGitHubRelease(input: unknown, expectedTag: string): GitHubRelease {
  const version = parseTag(expectedTag)
  const parsed = githubReleaseSchema.safeParse(input)
  if (!parsed.success || parsed.data.tag_name !== `v${version}`) {
    throw new ReleaseContractError(
      "invalid-release",
      "release metadata is not immutable and bound to the tag",
    )
  }
  if (parsed.data.draft || parsed.data.prerelease) {
    throw new ReleaseContractError("invalid-release", "draft and prerelease updates are forbidden")
  }
  return parsed.data
}

export function parseUpdateReleaseManifest(
  input: unknown,
  binding: ManifestBinding,
): UpdateReleaseManifest {
  const parsed = manifestSchema.safeParse(input)
  if (!parsed.success) {
    throw new ReleaseContractError("invalid-manifest", "release manifest is malformed")
  }
  const currentVersion = parseStableVersion(binding.currentVersion)
  const expectedTag = `v${parsed.data.version}`
  const expectedArchiveName = `atm-${expectedTag}.tar.gz`
  if (compareStableVersions(parsed.data.version, currentVersion) <= 0) {
    throw new ReleaseContractError("non-upgrade", "release version must be newer")
  }
  if (
    parsed.data.tag !== expectedTag ||
    binding.releaseTag !== expectedTag ||
    parsed.data.archive.name !== expectedArchiveName ||
    binding.archiveAsset.name !== expectedArchiveName ||
    parsed.data.archive.size !== binding.archiveAsset.size ||
    binding.archiveAsset.digest !== `sha256:${parsed.data.archive.sha256}`
  ) {
    throw new ReleaseContractError(
      "binding-mismatch",
      "manifest binding does not match release metadata",
    )
  }
  return parsed.data
}

function parseTag(input: string): StableVersion {
  if (!input.startsWith("v")) {
    throw new ReleaseContractError(
      "invalid-release",
      "release tag must be stable vX.Y.Z or vYYYY.MM.DD.N",
    )
  }
  return parseStableVersion(input.slice(1))
}

