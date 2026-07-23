import { describe, expect, test } from "bun:test"
import { UPDATE_RELEASE } from "../../../src/trajectory/update-release-contract"
import {
  type ReleaseTransport,
  type ReleaseTransportRequest,
  type ReleaseTransportResponse,
  verifyAvailableRelease,
} from "../../../src/trajectory/update-release-verifier"

const encoder = new TextEncoder()
const tag = "v1.2.3"
const apiUrl =
  "https://api.github.com/repos/effortprogrammer/agent-trajectory-marketplace/releases/tags/v1.2.3"
const manifestUrl =
  "https://github.com/effortprogrammer/agent-trajectory-marketplace/releases/download/v1.2.3/atm-release-manifest.json"
const archiveUrl =
  "https://github.com/effortprogrammer/agent-trajectory-marketplace/releases/download/v1.2.3/atm-v1.2.3.tar.gz"

describe("verifyAvailableRelease", () => {
  test("accepts an immutable release bound through metadata, manifest, checksum, and package", async () => {
    // Given
    const fixture = releaseFixture()
    const transport = new FixtureTransport([
      [apiUrl, response(200, fixture.metadata)],
      [manifestUrl, response(200, fixture.manifest)],
      [archiveUrl, response(302, new Uint8Array(), { location: fixture.redirectUrl })],
      [fixture.redirectUrl, response(200, fixture.archive)],
    ])

    // When
    const verified = await verifyAvailableRelease({
      currentVersion: "1.2.2",
      targetTag: tag,
      transport,
    })

    // Then
    expect(String(verified.version)).toBe("1.2.3")
    expect(verified.tag).toBe(tag)
    expect(verified.archive).toEqual({
      byteLength: fixture.archive.byteLength,
      sha256: fixture.sha256,
      version: "1.2.3",
    })
    expect(verified.archiveBytes).toEqual(fixture.archive)
    expect(transport.requests.map((request) => request.url)).toEqual([
      apiUrl,
      manifestUrl,
      archiveUrl,
      fixture.redirectUrl,
    ])
    expect(transport.requests.every((request) => request.signal instanceof AbortSignal)).toBe(true)
  })

  test("rejects a corrupt archive checksum", async () => {
    // Given
    const fixture = releaseFixture({ manifestSha256: "f".repeat(64) })
    const transport = fixtureTransport(fixture)

    // When
    const verification = verifyAvailableRelease({
      currentVersion: "1.2.2",
      targetTag: tag,
      transport,
    })

    // Then
    await expect(verification).rejects.toEqual(
      expect.objectContaining({ code: "binding-mismatch" }),
    )
  })

  test.each([
    "../outside/package.json",
    "/agent-trajectory-marketplace/package.json",
    "other-package/package.json",
    "agent-trajectory-marketplace\\package.json",
  ])("rejects unsafe archive path %s", async (path) => {
    // Given
    const fixture = releaseFixture({ archivePath: path })

    // When
    const verification = verifyAvailableRelease({
      currentVersion: "1.2.2",
      targetTag: tag,
      transport: fixtureTransport(fixture),
    })

    // Then
    await expect(verification).rejects.toEqual(expect.objectContaining({ code: "invalid-release" }))
  })

  test.each(["1", "2"])("rejects archive link type %s", async (type) => {
    // Given
    const fixture = releaseFixture({ archiveType: type })

    // When
    const verification = verifyAvailableRelease({
      currentVersion: "1.2.2",
      targetTag: tag,
      transport: fixtureTransport(fixture),
    })

    // Then
    await expect(verification).rejects.toEqual(expect.objectContaining({ code: "invalid-release" }))
  })

  test.each([
    "http://github.com/archive",
    "https://localhost/archive",
    "https://evil.invalid/archive",
  ])("rejects redirect URL %s", async (location) => {
    // Given
    const fixture = releaseFixture()
    const transport = new FixtureTransport([
      [apiUrl, response(200, fixture.metadata)],
      [manifestUrl, response(200, fixture.manifest)],
      [archiveUrl, response(302, new Uint8Array(), { location })],
    ])

    // When
    const verification = verifyAvailableRelease({
      currentVersion: "1.2.2",
      targetTag: tag,
      transport,
    })

    // Then
    await expect(verification).rejects.toEqual(expect.objectContaining({ code: "invalid-release" }))
  })

  test("rejects more than three redirects", async () => {
    // Given
    const fixture = releaseFixture()
    const redirects = [
      "https://release-assets.githubusercontent.com/asset-0",
      "https://release-assets.githubusercontent.com/asset-1",
      "https://release-assets.githubusercontent.com/asset-2",
      "https://release-assets.githubusercontent.com/asset-3",
    ] as const
    const transport = new FixtureTransport([
      [apiUrl, response(200, fixture.metadata)],
      [manifestUrl, response(200, fixture.manifest)],
      [archiveUrl, response(302, new Uint8Array(), { location: redirects[0] })],
      [redirects[0], response(302, new Uint8Array(), { location: redirects[1] })],
      [redirects[1], response(302, new Uint8Array(), { location: redirects[2] })],
      [redirects[2], response(302, new Uint8Array(), { location: redirects[3] })],
    ])

    // When
    const verification = verifyAvailableRelease({
      currentVersion: "1.2.2",
      targetTag: tag,
      transport,
    })

    // Then
    await expect(verification).rejects.toEqual(expect.objectContaining({ code: "invalid-release" }))
  })

  test("rejects a response exceeding the transport byte contract", async () => {
    // Given
    const oversized = new Uint8Array(UPDATE_RELEASE.manifestMaxBytes + 1)
    const transport = new FixtureTransport([[apiUrl, response(200, oversized)]])

    // When
    const verification = verifyAvailableRelease({
      currentVersion: "1.2.2",
      targetTag: tag,
      transport,
    })

    // Then
    await expect(verification).rejects.toEqual(expect.objectContaining({ code: "invalid-release" }))
  })
})

type FixtureOptions = {
  readonly archivePath?: string
  readonly archiveType?: string
  readonly manifestSha256?: string
}

function releaseFixture(options: FixtureOptions = {}) {
  const packageJson = encoder.encode(
    JSON.stringify({ name: "agent-trajectory-marketplace", version: "1.2.3" }),
  )
  const tar = tarArchive(
    options.archivePath ?? "agent-trajectory-marketplace/package.json",
    options.archiveType ?? "0",
    packageJson,
  )
  const archive = Bun.gzipSync(tar)
  const sha256 = new Bun.CryptoHasher("sha256").update(archive).digest("hex")
  const manifest = encoder.encode(
    JSON.stringify({
      schemaVersion: 1,
      packageName: "agent-trajectory-marketplace",
      version: "1.2.3",
      tag,
      archive: {
        name: "atm-v1.2.3.tar.gz",
        size: archive.byteLength,
        sha256: options.manifestSha256 ?? sha256,
      },
    }),
  )
  const metadata = encoder.encode(
    JSON.stringify({
      tag_name: tag,
      immutable: true,
      draft: false,
      prerelease: false,
      body: "untrusted release prose",
      assets: [
        {
          name: "atm-release-manifest.json",
          size: manifest.byteLength,
          digest: null,
          browser_download_url: manifestUrl,
        },
        {
          name: "atm-v1.2.3.tar.gz",
          size: archive.byteLength,
          digest: `sha256:${options.manifestSha256 ?? sha256}`,
          browser_download_url: archiveUrl,
        },
      ],
    }),
  )
  return {
    archive,
    manifest,
    metadata,
    redirectUrl: "https://release-assets.githubusercontent.com/asset?signature=opaque",
    sha256,
  }
}

function fixtureTransport(fixture: ReturnType<typeof releaseFixture>): FixtureTransport {
  return new FixtureTransport([
    [apiUrl, response(200, fixture.metadata)],
    [manifestUrl, response(200, fixture.manifest)],
    [archiveUrl, response(200, fixture.archive)],
  ])
}

class FixtureTransport implements ReleaseTransport {
  readonly requests: ReleaseTransportRequest[] = []
  readonly #responses: Map<string, ReleaseTransportResponse>

  constructor(responses: readonly (readonly [string, ReleaseTransportResponse])[]) {
    this.#responses = new Map(responses)
  }

  request(request: ReleaseTransportRequest): Promise<ReleaseTransportResponse> {
    this.requests.push(request)
    const fixture = this.#responses.get(request.url)
    if (fixture === undefined) {
      return Promise.resolve(response(404, new Uint8Array()))
    }
    return Promise.resolve(fixture)
  }
}

function response(
  status: number,
  body: Uint8Array,
  headers: ReleaseTransportResponse["headers"] = {},
): ReleaseTransportResponse {
  return { status, body, headers }
}

function tarArchive(path: string, type: string, content: Uint8Array): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(512)
  writeTarText(header, 0, 100, path)
  writeTarText(header, 100, 8, "0000644")
  writeTarText(header, 108, 8, "0000000")
  writeTarText(header, 116, 8, "0000000")
  writeTarText(header, 124, 12, `${content.byteLength.toString(8).padStart(11, "0")}\0`)
  writeTarText(header, 136, 12, "00000000000")
  header.fill(32, 148, 156)
  writeTarText(header, 156, 1, type)
  writeTarText(header, 257, 6, "ustar\0")
  writeTarText(header, 263, 2, "00")
  let checksum = 0
  for (const byte of header) {
    checksum += byte
  }
  writeTarText(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `)
  const paddedContentBytes = Math.ceil(content.byteLength / 512) * 512
  const tar = new Uint8Array(512 + paddedContentBytes + 1024)
  tar.set(header)
  tar.set(content, 512)
  return tar
}

function writeTarText(target: Uint8Array, offset: number, width: number, value: string): void {
  const encoded = encoder.encode(value)
  target.set(encoded.subarray(0, width), offset)
}
