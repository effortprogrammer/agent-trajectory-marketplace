import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { datasetArchivePolicy, encodeDatasetManifest } from "../../../src/marketplace/archive-contract"
import {
  PublishBundleError,
  parsePublishBundle,
  readPublishBundle,
} from "../../../src/marketplace/publish-bundle"
import { writeDatasetZip } from "../../../src/marketplace/stored-zip"

const roots: string[] = []

const archiveForTrace = (trace: Buffer): Buffer => {
  const label = `s-${"0".repeat(64)}`
  const path = `traces/${label}.atf.json`
  const manifest = encodeDatasetManifest({
    artifacts: [{ byteCount: trace.length, label, path, sha256: createHash("sha256").update(trace).digest("hex") }],
    formatVersion: 1,
  })
  return writeDatasetZip([{ data: manifest, name: "dataset-manifest.json" }, { data: trace, name: path }])
}

const validArchive = (): Buffer =>
  archiveForTrace(Buffer.from('{"runtime":"codex","status":"collected","eventCount":0,"events":[]}', "utf8"))

const fixedMetadata = (
  archive: Buffer,
  field:
    | "central_date"
    | "central_external_attributes"
    | "central_internal_attributes"
    | "central_made_by"
    | "central_time"
    | "central_version"
    | "local_date"
    | "local_time"
    | "local_version",
): Buffer => {
  const mutated = Buffer.from(archive)
  const centralOffset = mutated.readUInt32LE(mutated.length - 6)
  const positions = {
    central_date: [centralOffset + 14, 2],
    central_external_attributes: [centralOffset + 38, 4],
    central_internal_attributes: [centralOffset + 36, 2],
    central_made_by: [centralOffset + 4, 2],
    central_time: [centralOffset + 12, 2],
    central_version: [centralOffset + 6, 2],
    local_date: [12, 2],
    local_time: [10, 2],
    local_version: [4, 2],
  } as const
  const [offset, width] = positions[field]
  if (width === 2) mutated.writeUInt16LE(0x1234, offset)
  else mutated.writeUInt32LE(0x12345678, offset)
  return mutated
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

const reverseEntryRecords = (archive: Buffer, includeLocalRecords: boolean): Buffer => {
  const endOffset = archive.length - 22
  const centralOffset = archive.readUInt32LE(endOffset + 16)
  const localRecords: Readonly<{ bytes: Buffer; offset: number }>[] = []
  let localPosition = 0
  while (localPosition < centralOffset) {
    const recordLength = 30
      + archive.readUInt16LE(localPosition + 26)
      + archive.readUInt16LE(localPosition + 28)
      + archive.readUInt32LE(localPosition + 18)
    localRecords.push({
      bytes: Buffer.from(archive.subarray(localPosition, localPosition + recordLength)),
      offset: localPosition,
    })
    localPosition += recordLength
  }

  const centralRecords: Buffer[] = []
  let centralPosition = centralOffset
  while (centralPosition < endOffset) {
    const recordLength = 46
      + archive.readUInt16LE(centralPosition + 28)
      + archive.readUInt16LE(centralPosition + 30)
      + archive.readUInt16LE(centralPosition + 32)
    centralRecords.push(Buffer.from(archive.subarray(centralPosition, centralPosition + recordLength)))
    centralPosition += recordLength
  }

  const reversedCentral = centralRecords.reverse()
  if (!includeLocalRecords) {
    return Buffer.concat([
      archive.subarray(0, centralOffset),
      ...reversedCentral,
      archive.subarray(endOffset),
    ])
  }

  const reversedLocal = localRecords.reverse()
  const replacementOffsets = new Map<number, number>()
  let replacementOffset = 0
  for (const record of reversedLocal) {
    replacementOffsets.set(record.offset, replacementOffset)
    replacementOffset += record.bytes.length
  }
  for (const record of reversedCentral) {
    const originalOffset = record.readUInt32LE(42)
    const newOffset = replacementOffsets.get(originalOffset)
    if (newOffset === undefined) throw new Error("missing reordered local ZIP record")
    record.writeUInt32LE(newOffset, 42)
  }
  return Buffer.concat([
    ...reversedLocal.map((record) => record.bytes),
    ...reversedCentral,
    archive.subarray(endOffset),
  ])
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

  test.each([
    ["central directory", false],
    ["local and central entries", true],
  ] as const)("rejects noncanonical %s order", (_case, includeLocalRecords) => {
    // Given: valid reviewed entries whose physical ZIP order differs from the canonical writer.
    const archive = reverseEntryRecords(validArchive(), includeLocalRecords)

    // When: direct publication admission validates the archive.
    const parse = (): void => {
      parsePublishBundle(archive)
    }

    // Then: public admission cannot accept an archive the private consumer rejects by order.
    expect(parse).toThrow(PublishBundleError)
  })

  test("rejects archive policy overflow before reading ZIP fields", () => {
    // Given: an oversized Buffer-shaped input that traps every field except byteLength.
    const oversized = new Proxy({ byteLength: datasetArchivePolicy.maxArchiveBytes + 1 }, {
      get(target, property) {
        if (property === "byteLength") return target.byteLength
        throw new Error(`unexpected archive field access: ${String(property)}`)
      },
    }) as unknown as Buffer

    // When: the direct parser receives bytes beyond the public archive policy.
    const parse = (): void => {
      parsePublishBundle(oversized)
    }

    // Then: policy rejection occurs before any ZIP scan.
    expect(parse).toThrow(PublishBundleError)
  })

  test.each([
    "local_version",
    "local_time",
    "local_date",
    "central_made_by",
    "central_version",
    "central_time",
    "central_date",
    "central_internal_attributes",
    "central_external_attributes",
  ] as const)("rejects noncanonical %s fixed metadata", (field) => {
    // Given: a valid archive with one ignored fixed-width metadata field changed.
    const archive = fixedMetadata(validArchive(), field)

    // When: direct admission validates the complete archive representation.
    const parse = (): void => {
      parsePublishBundle(archive)
    }

    // Then: only canonical writer metadata can cross the boundary.
    expect(parse).toThrow(PublishBundleError)
  })

  test.each([
    ["invalid_json", Buffer.from("{", "utf8")],
    ["invalid_schema", Buffer.from('{"runtime":"codex","status":"collected","eventCount":1,"events":[]}', "utf8")],
    ["unsafe_payload", Buffer.from(JSON.stringify({
      runtime: "codex",
      status: "collected",
      formatVersion: 2,
      eventCount: 1,
      events: [{
        kind: "tool",
        name: "credential-bearing-input",
        payload: { input: { apiKey: "review-secret-314159" } },
      }],
    }), "utf8")],
  ] as const)("rejects %s ATF admission", (_case, trace) => {
    // Given: manifest-consistent trace bytes that fail semantic or redaction admission.
    const archive = archiveForTrace(trace)

    // When: direct publication admission parses the trace.
    const parse = (): void => {
      parsePublishBundle(archive)
    }

    // Then: hash consistency alone is insufficient.
    expect(parse).toThrow(PublishBundleError)
  })

  test("re-admits existing bundles through the residual-secret gate", () => {
    // Given: a manifest-consistent archive built outside the local construction flow.
    const residual = `github_pat_${"a".repeat(82)}`
    const trace = Buffer.from(JSON.stringify({
      runtime: "codex",
      status: "collected",
      formatVersion: 2,
      eventCount: 1,
      events: [{ kind: "message", name: "assistant", payload: { content: residual } }],
    }), "utf8")
    const archive = archiveForTrace(trace)

    // When: the publish boundary independently admits the archive bytes.
    const parse = (): void => {
      parsePublishBundle(archive)
    }

    // Then: bundles created before this gate cannot bypass it.
    expect(parse).toThrow(PublishBundleError)
  })

  test("rejects an existing bundle whose JSON-escaped payload decodes to a credential", () => {
    // Given: a manifest-consistent trace whose serialized content conceals a GitHub token.
    const trace = Buffer.from(`{"runtime":"codex","status":"collected","formatVersion":2,"eventCount":1,"events":[{"kind":"message","name":"assistant","payload":{"content":"github_pat_\\u0061${"a".repeat(81)}"}}]}`, "utf8")
    const archive = archiveForTrace(trace)

    // When: the existing bundle crosses direct publication admission.
    const parse = (): void => {
      parsePublishBundle(archive)
    }

    // Then: admission scans decoded semantic trace content rather than escape bytes.
    expect(parse).toThrow(PublishBundleError)
  })

  test("rejects an existing bundle whose decoded property name carries a credential", () => {
    // Given: a manifest-consistent trace whose payload key itself contains a GitHub token.
    const token = `github_pat_${"a".repeat(82)}`
    const trace = Buffer.from(JSON.stringify({
      runtime: "codex",
      status: "collected",
      formatVersion: 2,
      eventCount: 1,
      events: [{
        kind: "tool",
        name: "read",
        payload: { input: { [token]: "redacted" } },
      }],
    }), "utf8")
    const archive = archiveForTrace(trace)

    // When: the existing bundle crosses direct publication admission.
    const parse = (): void => {
      parsePublishBundle(archive)
    }

    // Then: property names cannot carry residual credentials to the registry.
    expect(parse).toThrow(PublishBundleError)
  })

  test.each([
    ["runtime", {
      runtime: "Bearer TOP_SECRET_123456789",
      status: "collected",
      eventCount: 0,
      events: [],
    }],
    ["event name", {
      runtime: "codex",
      status: "collected",
      eventCount: 1,
      events: [{ kind: "tool", name: "Bearer TOP_SECRET_123456789" }],
    }],
    ["event kind", {
      runtime: "codex",
      status: "collected",
      eventCount: 1,
      events: [{ kind: "Bearer TOP_SECRET_123456789", name: "call" }],
    }],
    ["source event id", {
      runtime: "codex",
      status: "collected",
      formatVersion: 2,
      eventCount: 1,
      events: [{
        kind: "tool",
        name: "call",
        timestamp: "2026-08-04T00:00:00Z",
        sourceEventId: "Bearer TOP_SECRET_123456789",
      }],
    }],
    ["parent source event id", {
      runtime: "codex",
      status: "collected",
      formatVersion: 2,
      eventCount: 1,
      events: [{
        kind: "tool",
        name: "call",
        timestamp: "2026-08-04T00:00:00Z",
        sourceEventId: "call-1",
        parentSourceEventId: "Bearer TOP_SECRET_123456789",
      }],
    }],
    ["oversized runtime", {
      runtime: "x".repeat(16 * 1024 + 1),
      status: "collected",
      eventCount: 0,
      events: [],
    }],
  ] as const)("rejects unsafe ATF %s metadata", (_case, document) => {
    // Given: a schema-valid trace with a credential outside the payload object.
    const archive = archiveForTrace(Buffer.from(JSON.stringify(document), "utf8"))

    // When: direct publication admission parses every string-bearing ATF field.
    const parse = (): void => {
      parsePublishBundle(archive)
    }

    // Then: no credential-bearing trace metadata can cross the publication boundary.
    expect(parse).toThrow(PublishBundleError)
  })

  test.each([
    ["top-level", '{"runtime":"Bearer TOP_SECRET_123456789","runtime":"codex","status":"collected","eventCount":0,"events":[]}'],
    ["escaped-equivalent", '{"runtime":"codex","\\u0072untime":"Bearer TOP_SECRET_123456789","status":"collected","eventCount":0,"events":[]}'],
    ["nested-payload", '{"runtime":"codex","status":"collected","formatVersion":2,"eventCount":1,"events":[{"kind":"tool","name":"read","payload":{"label":"Bearer TOP_SECRET_123456789","label":"safe"}}]}'],
  ] as const)("rejects duplicate %s JSON keys before admission", (_case, traceText) => {
    // Given: exact trace bytes whose duplicate keys hide credential material from JSON.parse.
    const archive = archiveForTrace(Buffer.from(traceText, "utf8"))

    // When: direct publication admission parses the trace.
    const parse = (): void => {
      parsePublishBundle(archive)
    }

    // Then: discarded parser values cannot smuggle retained credential bytes.
    expect(parse).toThrow(PublishBundleError)
  })

  test("rejects duplicate manifest JSON keys before admission", () => {
    // Given: a manifest whose duplicate formatVersion collapses to a valid parse but taints raw bytes.
    const trace = Buffer.from('{"runtime":"codex","status":"collected","eventCount":0,"events":[]}', "utf8")
    const label = `s-${"0".repeat(64)}`
    const path = `traces/${label}.atf.json`
    const sha256 = createHash("sha256").update(trace).digest("hex")
    const manifest = Buffer.from(
      `{"formatVersion":0,"formatVersion":1,"artifacts":[{"path":"${path}","label":"${label}","sha256":"${sha256}","byteCount":${trace.length}}]}`,
      "utf8",
    )
    const archive = writeDatasetZip([{ data: manifest, name: "dataset-manifest.json" }, { data: trace, name: path }])

    // When: direct admission parses the manifest.
    const parse = (): void => {
      parsePublishBundle(archive)
    }

    // Then: duplicate manifest keys cannot cross the boundary.
    expect(parse).toThrow(PublishBundleError)
  })

  test.each(["manifest", "trace"] as const)("rejects UTF-8 BOM prefixed %s bytes", (location) => {
    // Given: otherwise valid JSON bytes prefixed with a UTF-8 BOM.
    const bom = Buffer.from([0xef, 0xbb, 0xbf])
    const trace = Buffer.from('{"runtime":"codex","status":"collected","eventCount":0,"events":[]}', "utf8")
    const label = `s-${"0".repeat(64)}`
    const path = `traces/${label}.atf.json`
    const traceEntry = location === "trace" ? Buffer.concat([bom, trace]) : trace
    const manifest = encodeDatasetManifest({
      artifacts: [{ byteCount: traceEntry.length, label, path, sha256: createHash("sha256").update(traceEntry).digest("hex") }],
      formatVersion: 1,
    })
    const manifestEntry = location === "manifest" ? Buffer.concat([bom, manifest]) : manifest
    const archive = writeDatasetZip([{ data: manifestEntry, name: "dataset-manifest.json" }, { data: traceEntry, name: path }])

    // When: direct admission decodes the entry bytes.
    const parse = (): void => {
      parsePublishBundle(archive)
    }

    // Then: BOM parser differentials are rejected at the boundary.
    expect(parse).toThrow(PublishBundleError)
  })

  test("rejects traces beyond the event admission bound", () => {
    // Given: a schema-valid trace with more events than the publish admission budget.
    const events = Array.from({ length: 65_537 }, () => ({ kind: "a", name: "b" }))
    const trace = Buffer.from(JSON.stringify({
      runtime: "codex",
      status: "collected",
      eventCount: events.length,
      events,
    }), "utf8")
    const archive = archiveForTrace(trace)

    // When: direct admission validates the trace.
    const parse = (): void => {
      parsePublishBundle(archive)
    }

    // Then: unbounded event arrays cannot consume publisher resources.
    expect(parse).toThrow(PublishBundleError)
  })

  test("preserves safe noncanonical ATF bytes exactly", () => {
    // Given: semantically valid, redaction-fixed-point trace bytes with noncanonical whitespace.
    const trace = Buffer.from('{\n  "runtime": "codex",\n  "status": "collected",\n  "eventCount": 0,\n  "events": []\n}', "utf8")
    const archive = archiveForTrace(trace)

    // When: the bundle is admitted.
    const bundle = parsePublishBundle(archive)

    // Then: admission validates without rewriting the caller's exact bytes.
    expect(bundle.archive).toBe(archive)
  })
})
