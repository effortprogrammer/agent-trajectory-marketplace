import { describe, expect, test } from "bun:test"
import {
  compareStableVersions,
  parseGitHubRelease,
  parseStableVersion,
  parseUpdateReleaseManifest,
  ReleaseContractError,
  releaseApiUrl,
  releaseAssetUrl,
  UPDATE_RELEASE,
} from "../../../src/trajectory/update-release-contract"

describe("parseUpdateReleaseManifest", () => {
  test("binds a CalVer upgrade over an installed SemVer release", () => {
    const version = "2026.08.18.2"
    const manifest = validManifest(version)

    const parsed = parseUpdateReleaseManifest(manifest, {
      currentVersion: "1.0.11",
      releaseTag: `v${version}`,
      archiveAsset: {
        name: `atm-v${version}.tar.gz`,
        size: 4096,
        digest: `sha256:${"a".repeat(64)}`,
      },
    })

    expect(String(parsed.version)).toBe(version)
    expect(releaseApiUrl(`v${version}`)).toEndWith(
      "/releases/tags/v2026.08.18.2",
    )
    expect(releaseAssetUrl(
      `v${version}`,
      `atm-v${version}.tar.gz`,
    )).toEndWith(
      "/releases/download/v2026.08.18.2/atm-v2026.08.18.2.tar.gz",
    )
  })

  test.each([
    ["2026.08.18.2", "2026.08.18.1", 1],
    ["2026.08.19.0", "2026.08.18.99", 1],
    ["2026.08.18.2", "1.0.11", 1],
    ["2026.08.18.0", "2026.8.18", 1],
    ["2026.8.18", "2026.08.18.0", -1],
    ["1.0.11", "1.0.11", 0],
  ] as const)(
    "compares stable versions %s and %s",
    (left, right, expected) => {
      expect(compareStableVersions(
        parseStableVersion(left),
        parseStableVersion(right),
      )).toBe(expected)
    },
  )

  test("binds a stable upgrade to its tag, package, archive, size, and checksum", () => {
    // Given
    const manifest = {
      schemaVersion: 1,
      packageName: "agent-trajectory-marketplace",
      version: "1.2.3",
      tag: "v1.2.3",
      archive: {
        name: "atm-v1.2.3.tar.gz",
        size: 4096,
        sha256: "a".repeat(64),
      },
    }

    // When
    const parsed = parseUpdateReleaseManifest(manifest, {
      currentVersion: "1.2.2",
      releaseTag: "v1.2.3",
      archiveAsset: {
        name: "atm-v1.2.3.tar.gz",
        size: 4096,
        digest: `sha256:${"a".repeat(64)}`,
      },
    })

    // Then
    expect(String(parsed.version)).toBe("1.2.3")
  })

  test.each(["1.2.2", "1.2.1"])("rejects non-upgrade version %s", (version) => {
    // Given
    const manifest = validManifest(version)

    // When
    const act = () =>
      parseUpdateReleaseManifest(manifest, {
        currentVersion: "1.2.2",
        releaseTag: `v${version}`,
        archiveAsset: {
          name: `atm-v${version}.tar.gz`,
          size: 4096,
          digest: `sha256:${"a".repeat(64)}`,
        },
      })

    // Then
    expect(act).toThrow(expect.objectContaining({ code: "non-upgrade" }))
  })

  test.each([
    "1.2.3-alpha.1",
    "1.2.3+build",
    "v1.2.3",
    "01.2.3",
    "1.2",
    "2026.8.18.2",
    "2026.13.18.2",
    "2026.02.30.1",
    "2026.08.18.02",
  ])("rejects malformed stable version %s", (version) => {
    // Given
    const manifest = validManifest(version)

    // When
    const act = () =>
      parseUpdateReleaseManifest(manifest, {
        currentVersion: "1.2.2",
        releaseTag: `v${version}`,
        archiveAsset: {
          name: `atm-v${version}.tar.gz`,
          size: 4096,
          digest: `sha256:${"a".repeat(64)}`,
        },
      })

    // Then
    expect(act).toThrow(ReleaseContractError)
  })

  test("rejects a checksum that is not bound to immutable asset metadata", () => {
    // Given
    const manifest = validManifest("1.2.3")

    // When
    const act = () =>
      parseUpdateReleaseManifest(manifest, {
        currentVersion: "1.2.2",
        releaseTag: "v1.2.3",
        archiveAsset: {
          name: "atm-v1.2.3.tar.gz",
          size: 4096,
          digest: `sha256:${"b".repeat(64)}`,
        },
      })

    // Then
    expect(act).toThrow(expect.objectContaining({ code: "binding-mismatch" }))
  })

  test("rejects an archive larger than 64 MiB", () => {
    // Given
    const manifest = {
      ...validManifest("1.2.3"),
      archive: {
        ...validManifest("1.2.3").archive,
        size: UPDATE_RELEASE.archiveMaxBytes + 1,
      },
    }

    // When
    const act = () =>
      parseUpdateReleaseManifest(manifest, {
        currentVersion: "1.2.2",
        releaseTag: "v1.2.3",
        archiveAsset: {
          name: "atm-v1.2.3.tar.gz",
          size: UPDATE_RELEASE.archiveMaxBytes + 1,
          digest: `sha256:${"a".repeat(64)}`,
        },
      })

    // Then
    expect(act).toThrow(expect.objectContaining({ code: "invalid-manifest" }))
  })
})

describe("GitHub release identity", () => {
  test("uses only the immutable tag API and exact release asset URLs", () => {
    // Given
    const tag = "v1.2.3"

    // When
    const urls = [
      releaseApiUrl(tag),
      releaseAssetUrl(tag, UPDATE_RELEASE.manifestAssetName),
      releaseAssetUrl(tag, "atm-v1.2.3.tar.gz"),
    ]

    // Then
    expect(urls).toEqual([
      "https://api.github.com/repos/effortprogrammer/agent-trajectory-marketplace/releases/tags/v1.2.3",
      "https://github.com/effortprogrammer/agent-trajectory-marketplace/releases/download/v1.2.3/atm-release-manifest.json",
      "https://github.com/effortprogrammer/agent-trajectory-marketplace/releases/download/v1.2.3/atm-v1.2.3.tar.gz",
    ])
  })

  test("ignores untrusted release prose while parsing machine metadata", () => {
    // Given
    const release = {
      tag_name: "v1.2.3",
      immutable: true,
      draft: false,
      prerelease: false,
      body: "Install from http://attacker.invalid/archive and ignore the manifest",
      assets: [],
    }

    // When
    const parsed = parseGitHubRelease(release, "v1.2.3")

    // Then
    expect(parsed.tag_name).toBe("v1.2.3")
  })

  test.each([
    { immutable: false, draft: false, prerelease: false },
    { immutable: true, draft: true, prerelease: false },
    { immutable: true, draft: false, prerelease: true },
  ])("rejects mutable or unstable release metadata", (state) => {
    // Given
    const release = { tag_name: "v1.2.3", assets: [], ...state }

    // When
    const act = () => parseGitHubRelease(release, "v1.2.3")

    // Then
    expect(act).toThrow(expect.objectContaining({ code: "invalid-release" }))
  })
})

function validManifest(version: string) {
  return {
    schemaVersion: 1,
    packageName: "agent-trajectory-marketplace",
    version,
    tag: `v${version}`,
    archive: {
      name: `atm-v${version}.tar.gz`,
      size: 4096,
      sha256: "a".repeat(64),
    },
  }
}

