import { type VerifiedReleaseArchive, verifyUpdateReleaseArchive } from "./update-release-archive"
import {
  type GitHubReleaseAsset,
  parseGitHubRelease,
  parseStableVersion,
  parseUpdateReleaseManifest,
  ReleaseContractError,
  releaseApiUrl,
  releaseAssetUrl,
  type StableVersion,
  UPDATE_RELEASE,
} from "./update-release-contract"

const requestTimeoutMs = 15_000
const redirectStatuses = new Set([301, 302, 303, 307, 308])

export type ReleaseTransportRequest = {
  readonly url: string
  readonly maxBytes: number
  readonly signal: AbortSignal
}

export type ReleaseTransportResponse = {
  readonly status: number
  readonly headers: {
    readonly location?: string
  }
  readonly body: Uint8Array
}

export interface ReleaseTransport {
  request(request: ReleaseTransportRequest): Promise<ReleaseTransportResponse>
}

export type VerifyAvailableReleaseRequest = {
  readonly currentVersion: string
  readonly targetTag: string
  readonly transport: ReleaseTransport
}

export type VerifiedAvailableRelease = {
  readonly version: StableVersion
  readonly tag: string
  readonly archive: VerifiedReleaseArchive
  readonly archiveBytes: Uint8Array
}

export async function verifyAvailableRelease(
  request: VerifyAvailableReleaseRequest,
): Promise<VerifiedAvailableRelease> {
  parseStableVersion(request.currentVersion)
  const apiUrl = releaseApiUrl(request.targetTag)
  const metadataResponse = await requestOnce(
    request.transport,
    apiUrl,
    UPDATE_RELEASE.manifestMaxBytes,
  )
  if (metadataResponse.status !== 200) {
    throw new ReleaseContractError("invalid-release", "release metadata request failed")
  }
  const metadata = parseGitHubRelease(
    parseJson(metadataResponse.body, "release metadata"),
    request.targetTag,
  )
  const manifestAsset = findAsset(metadata.assets, UPDATE_RELEASE.manifestAssetName)
  const archiveName = `atm-${request.targetTag}.tar.gz`
  const archiveAsset = findAsset(metadata.assets, archiveName)
  verifyAssetMetadata(manifestAsset, request.targetTag, UPDATE_RELEASE.manifestMaxBytes)
  verifyAssetMetadata(archiveAsset, request.targetTag, UPDATE_RELEASE.archiveMaxBytes)

  const manifestResponse = await requestAsset(
    request.transport,
    manifestAsset.browser_download_url,
    UPDATE_RELEASE.manifestMaxBytes,
  )
  if (manifestResponse.body.byteLength !== manifestAsset.size) {
    throw new ReleaseContractError(
      "binding-mismatch",
      "manifest size does not match release metadata",
    )
  }
  const manifest = parseUpdateReleaseManifest(
    parseJson(manifestResponse.body, "release manifest"),
    {
      currentVersion: request.currentVersion,
      releaseTag: request.targetTag,
      archiveAsset,
    },
  )
  const archiveResponse = await requestAsset(
    request.transport,
    archiveAsset.browser_download_url,
    UPDATE_RELEASE.archiveMaxBytes,
  )
  const archive = await verifyUpdateReleaseArchive(archiveResponse.body, manifest)
  return { version: manifest.version, tag: manifest.tag, archive, archiveBytes: archiveResponse.body }
}

async function requestAsset(
  transport: ReleaseTransport,
  initialUrl: string,
  maxBytes: number,
): Promise<ReleaseTransportResponse> {
  let url = initialUrl
  for (let redirects = 0; redirects <= UPDATE_RELEASE.maxRedirects; redirects += 1) {
    verifyAssetRequestUrl(url, redirects === 0)
    const response = await requestOnce(transport, url, maxBytes)
    if (!redirectStatuses.has(response.status)) {
      if (response.status !== 200) {
        throw new ReleaseContractError("invalid-release", "release asset request failed")
      }
      return response
    }
    if (redirects === UPDATE_RELEASE.maxRedirects) {
      throw new ReleaseContractError("invalid-release", "release asset exceeded redirect limit")
    }
    const location = response.headers.location
    if (location === undefined) {
      throw new ReleaseContractError(
        "invalid-release",
        "release asset redirect is missing location",
      )
    }
    url = resolveRedirectUrl(url, location)
  }
  throw new ReleaseContractError("invalid-release", "release asset redirect state is invalid")
}

async function requestOnce(
  transport: ReleaseTransport,
  url: string,
  maxBytes: number,
): Promise<ReleaseTransportResponse> {
  const signal = AbortSignal.timeout(requestTimeoutMs)
  const response = await Promise.race([
    transport.request({ url, maxBytes, signal }),
    new Promise<never>((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new ReleaseContractError("invalid-release", "release request timed out")),
        { once: true },
      )
    }),
  ])
  if (response.body.byteLength > maxBytes) {
    throw new ReleaseContractError("invalid-release", "release response exceeds size limit")
  }
  return response
}

function verifyAssetMetadata(asset: GitHubReleaseAsset, tag: string, maxBytes: number): void {
  const expectedUrl = releaseAssetUrl(tag, asset.name)
  if (asset.browser_download_url !== expectedUrl || asset.size > maxBytes || asset.size <= 0) {
    throw new ReleaseContractError("invalid-release", "release asset metadata violates policy")
  }
}

function verifyAssetRequestUrl(input: string, initial: boolean): void {
  let url: URL
  try {
    url = new URL(input)
  } catch (error) {
    if (error instanceof TypeError) {
      throw new ReleaseContractError("invalid-release", "release asset URL is malformed")
    }
    throw error
  }
  if (
    url.protocol !== "https:" ||
    !UPDATE_RELEASE.archiveRedirectHosts.some((host) => host === url.hostname)
  ) {
    throw new ReleaseContractError("invalid-release", "release asset URL host is forbidden")
  }
  if (initial && url.hostname !== "github.com") {
    throw new ReleaseContractError("invalid-release", "release asset initial host is forbidden")
  }
}

function resolveRedirectUrl(currentUrl: string, location: string): string {
  try {
    return new URL(location, currentUrl).toString()
  } catch (error) {
    if (error instanceof TypeError) {
      throw new ReleaseContractError("invalid-release", "release redirect URL is malformed")
    }
    throw error
  }
}

function findAsset(assets: readonly GitHubReleaseAsset[], name: string): GitHubReleaseAsset {
  const matches = assets.filter((asset) => asset.name === name)
  if (matches.length !== 1) {
    throw new ReleaseContractError(
      "invalid-release",
      "required release asset is missing or duplicated",
    )
  }
  const asset = matches[0]
  if (asset === undefined) {
    throw new ReleaseContractError("invalid-release", "required release asset is missing")
  }
  return asset
}

function parseJson(input: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input))
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw new ReleaseContractError("invalid-release", `${label} is malformed`)
    }
    throw error
  }
}
