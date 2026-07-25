import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"

import {
  ArchiveContractError,
  assertDatasetArchivePlan,
  datasetArchivePolicy,
  datasetManifestSchema,
  encodeDatasetManifest,
} from "../../../src/marketplace/archive-contract"
import { writeDatasetZip } from "../../../src/marketplace/stored-zip"

const hashA = "a".repeat(64)
const hashB = "b".repeat(64)
const pathA = `traces/s-${hashA}.atf.json`
const pathB = `traces/s-${hashB}.atf.json`

const manifest = {
  formatVersion: 1,
  artifacts: [
    { path: pathA, label: `s-${hashA}`, sha256: hashA, byteCount: 3 },
    { path: pathB, label: `s-${hashB}`, sha256: hashB, byteCount: 3 },
  ],
}

describe("dataset archive contract", () => {
  it("accepts only the closed identity-neutral manifest when fields are valid", () => {
    // Given
    const input = structuredClone(manifest)

    // When
    const result = datasetManifestSchema.safeParse(input)

    // Then
    expect(result.success).toBe(true)
  })

  it("rejects identity, local metadata, and transport fields when the manifest is parsed", () => {
    // Given
    const forbiddenFields = ["timestamp", "root", "localPath", "topic", "notes", "candidate", "apiKey"]

    // When
    const results = forbiddenFields.map((field) =>
      datasetManifestSchema.safeParse({ ...manifest, [field]: "secret" }),
    )

    // Then
    expect(results.every((result) => !result.success)).toBe(true)
  })

  it("rejects duplicate artifacts and labels that do not match their opaque paths", () => {
    // Given
    const duplicate = { formatVersion: 1, artifacts: [manifest.artifacts[0], manifest.artifacts[0]] }
    const mismatched = {
      formatVersion: 1,
      artifacts: [{ ...manifest.artifacts[0], label: `s-${hashB}` }],
    }

    // When
    const duplicateResult = datasetManifestSchema.safeParse(duplicate)
    const mismatchResult = datasetManifestSchema.safeParse(mismatched)

    // Then
    expect(duplicateResult.success).toBe(false)
    expect(mismatchResult.success).toBe(false)
  })

  it("rejects unsafe trace paths and non-positive byte counts", () => {
    // Given
    const unsafePaths = ["../x.atf.json", "/traces/x.atf.json", "traces/x.atf.json", `${pathA}/x`]

    // When
    const results = unsafePaths.map((path) =>
      datasetManifestSchema.safeParse({
        formatVersion: 1,
        artifacts: [{ ...manifest.artifacts[0], path, byteCount: 0 }],
      }),
    )

    // Then
    expect(results.every((result) => !result.success)).toBe(true)
  })

  it("accepts each archive cap at its exact boundary without allocating the declared bytes", () => {
    // Given
    const namedEntries = (count: number, byteCount: number) =>
      Array.from({ length: count }, (_, index) => ({
        byteCount,
        name: `traces/s-${index.toString(16).padStart(64, "0")}.atf.json`,
      }))
    const plans = [
      { manifestByteCount: datasetArchivePolicy.maxManifestBytes, archiveByteCount: 1, entries: namedEntries(1, 1) },
      { manifestByteCount: 1, archiveByteCount: datasetArchivePolicy.maxArchiveBytes, entries: namedEntries(1, 1) },
      { manifestByteCount: 1, archiveByteCount: 1, entries: namedEntries(1, datasetArchivePolicy.maxTraceBytes) },
      { manifestByteCount: 1, archiveByteCount: 1, entries: namedEntries(datasetArchivePolicy.maxTraces, 1) },
      {
        manifestByteCount: 1,
        archiveByteCount: 1,
        entries: [
          ...namedEntries(31, datasetArchivePolicy.maxTraceBytes),
          ...namedEntries(1, datasetArchivePolicy.maxTraceBytes - 1).map((entry) => ({
            ...entry,
            name: `traces/s-${"f".repeat(64)}.atf.json`,
          })),
        ],
      },
    ]

    // When
    const actions = plans.map((plan) => (): void => assertDatasetArchivePlan(plan))

    // Then
    for (const action of actions) expect(action).not.toThrow()
  })

  it("rejects every archive cap immediately above its boundary using declared sizes", () => {
    // Given
    const validEntry = { name: pathA, byteCount: 1 }
    const cases = [
      { manifestByteCount: datasetArchivePolicy.maxManifestBytes + 1, archiveByteCount: 1, entries: [validEntry] },
      { manifestByteCount: 1, archiveByteCount: datasetArchivePolicy.maxArchiveBytes + 1, entries: [validEntry] },
      {
        manifestByteCount: 1,
        archiveByteCount: 1,
        entries: [{ ...validEntry, byteCount: datasetArchivePolicy.maxTraceBytes + 1 }],
      },
      {
        manifestByteCount: 1,
        archiveByteCount: 1,
        entries: Array.from({ length: datasetArchivePolicy.maxTraces + 1 }, () => validEntry),
      },
      {
        manifestByteCount: 1,
        archiveByteCount: 1,
        entries: Array.from({ length: 33 }, (_, index) => ({
          byteCount: datasetArchivePolicy.maxTraceBytes,
          name: `traces/s-${index.toString(16).padStart(64, "0")}.atf.json`,
        })),
      },
    ]

    // When
    const actions = cases.map((plan) => (): void => assertDatasetArchivePlan(plan))

    // Then
    for (const action of actions) expect(action).toThrow(ArchiveContractError)
  })

  it("encodes a deterministic manifest and rejects an oversized encoded manifest", () => {
    // Given
    const valid = structuredClone(manifest)
    const oversizedLabel = `s-${"c".repeat(datasetArchivePolicy.maxManifestBytes)}`

    // When
    const first = encodeDatasetManifest(valid)
    const second = encodeDatasetManifest(valid)
    const invalid = (): Buffer =>
      encodeDatasetManifest({
        formatVersion: 1,
        artifacts: [{ ...valid.artifacts[0], label: oversizedLabel }],
      })

    // Then
    expect(first.equals(second)).toBe(true)
    expect(invalid).toThrow()
  })
})

describe("store-only ZIP writer", () => {
  it("writes byte-identical output for identical ordered entries", () => {
    // Given
    const firstData = Buffer.from("one")
    const secondData = Buffer.from("two")
    const validManifest = {
      formatVersion: 1,
      artifacts: [
        { ...manifest.artifacts[0], sha256: createHash("sha256").update(firstData).digest("hex") },
        { ...manifest.artifacts[1], sha256: createHash("sha256").update(secondData).digest("hex") },
      ],
    }
    const manifestBytes = encodeDatasetManifest(validManifest)
    const entries = [
      { name: "dataset-manifest.json", data: manifestBytes },
      { name: pathA, data: firstData },
      { name: pathB, data: secondData },
    ]

    // When
    const first = writeDatasetZip(entries)
    const second = writeDatasetZip([...entries].reverse())

    // Then
    expect(first.equals(second)).toBe(true)
  })

  it("rejects extra entries and unsafe entry names before writing", () => {
    // Given
    const data = Buffer.from("one")
    const validManifest = encodeDatasetManifest({
      formatVersion: 1,
      artifacts: [{ ...manifest.artifacts[0], sha256: createHash("sha256").update(data).digest("hex") }],
    })
    const cases = [
      [
        { name: "dataset-manifest.json", data: validManifest },
        { name: pathA, data },
        { name: "extra.txt", data },
      ],
      [{ name: "../escape", data }],
      [{ name: "/absolute", data }],
      [{ name: "traces//empty", data }],
      [{ name: "traces\\windows", data }],
    ]

    // When
    const actions = cases.map((entries) => (): Buffer => writeDatasetZip(entries))

    // Then
    for (const action of actions) expect(action).toThrow()
  })

  it("rejects missing and duplicate manifests before writing", () => {
    // Given
    const data = Buffer.from("one")
    const valid = encodeDatasetManifest({
      formatVersion: 1,
      artifacts: [{ ...manifest.artifacts[0], sha256: createHash("sha256").update(data).digest("hex") }],
    })
    const cases = [
      [{ name: pathA, data }],
      [
        { name: "dataset-manifest.json", data: valid },
        { name: "dataset-manifest.json", data: valid },
        { name: pathA, data },
      ],
    ]

    // When
    const actions = cases.map((entries) => (): Buffer => writeDatasetZip(entries))

    // Then
    for (const action of actions) expect(action).toThrow()
  })

  it("rejects zero traces and any difference between manifest membership and ZIP membership", () => {
    // Given
    const data = Buffer.from("one")
    const second = Buffer.from("two")
    const artifactA = { ...manifest.artifacts[0], sha256: createHash("sha256").update(data).digest("hex") }
    const artifactB = { ...manifest.artifacts[1], sha256: createHash("sha256").update(second).digest("hex") }
    const rawManifest = (artifacts: readonly typeof artifactA[]): Buffer =>
      Buffer.from(JSON.stringify({ formatVersion: 1, artifacts }), "utf8")
    const cases = [
      [{ name: "dataset-manifest.json", data: rawManifest([]) }],
      [
        { name: "dataset-manifest.json", data: rawManifest([artifactA]) },
        { name: pathA, data },
        { name: pathB, data: second },
      ],
      [
        { name: "dataset-manifest.json", data: rawManifest([artifactA, artifactB]) },
        { name: pathA, data },
      ],
    ]

    // When
    const actions = cases.map((entries) => (): Buffer => writeDatasetZip(entries))

    // Then
    for (const action of actions) expect(action).toThrow()
  })

  it("rejects path, hash, or byte-count claims that differ from the provided trace bytes", () => {
    // Given
    const data = Buffer.from("one")
    const actualHash = createHash("sha256").update(data).digest("hex")
    const rawManifest = (artifact: Readonly<Record<string, string | number>>): Buffer =>
      Buffer.from(JSON.stringify({ formatVersion: 1, artifacts: [artifact] }), "utf8")
    const cases = [
      [
        { name: "dataset-manifest.json", data: rawManifest({ ...manifest.artifacts[0], path: pathB, label: `s-${hashB}`, sha256: actualHash }) },
        { name: pathA, data },
      ],
      [
        { name: "dataset-manifest.json", data: rawManifest({ ...manifest.artifacts[0], sha256: hashB }) },
        { name: pathA, data },
      ],
      [
        { name: "dataset-manifest.json", data: rawManifest({ ...manifest.artifacts[0], sha256: actualHash, byteCount: data.length + 1 }) },
        { name: pathA, data },
      ],
    ]

    // When
    const actions = cases.map((entries) => (): Buffer => writeDatasetZip(entries))

    // Then
    for (const action of actions) expect(action).toThrow()
  })

  it("rejects duplicate artifact paths and duplicate artifact hashes", () => {
    // Given
    const data = Buffer.from("one")
    const actualHash = createHash("sha256").update(data).digest("hex")
    const artifactA = { ...manifest.artifacts[0], sha256: actualHash }
    const artifactB = { ...manifest.artifacts[1], sha256: actualHash }
    const encoded = (artifacts: readonly typeof artifactA[]): Buffer =>
      Buffer.from(JSON.stringify({ formatVersion: 1, artifacts }), "utf8")
    const cases = [
      [
        { name: "dataset-manifest.json", data: encoded([artifactA, artifactA]) },
        { name: pathA, data },
        { name: pathA, data },
      ],
      [
        { name: "dataset-manifest.json", data: encoded([artifactA, artifactB]) },
        { name: pathA, data },
        { name: pathB, data },
      ],
    ]

    // When
    const actions = cases.map((entries) => (): Buffer => writeDatasetZip(entries))

    // Then
    for (const action of actions) expect(action).toThrow()
  })
})
