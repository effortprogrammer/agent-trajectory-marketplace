import { createHash } from "node:crypto"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { encodeDatasetManifest } from "../../../src/marketplace/archive-contract"
import {
  createCandidateFromExactBytes,
  encodePublishResponse,
} from "../../../src/marketplace/publish-contract"
import {
  encodePublishFrameForWireContract,
} from "../../../src/marketplace/publish-frame"
import { writeDatasetZip } from "../../../src/marketplace/stored-zip"

type Fixture = Readonly<{
  file: string
  verdict: "accept" | "reject"
  code: string
  bytes: Uint8Array
}>

class FixtureGenerationError extends Error {
  public constructor(public readonly file: string) {
    super(`${file}: fixture generation mismatch`)
    this.name = "FixtureGenerationError"
  }
}

const root = new URL("./", import.meta.url)
const trace = Buffer.from('{"runtime":"codex","status":"collected","eventCount":0,"events":[]}', "utf8")
const label = `s-${"0".repeat(64)}`
const path = `traces/${label}.atf.json`
const manifest = encodeDatasetManifest({
  artifacts: [{
    byteCount: trace.length,
    label,
    path,
    sha256: createHash("sha256").update(trace).digest("hex"),
  }],
  formatVersion: 1,
})
const archive = writeDatasetZip([
  { data: manifest, name: "dataset-manifest.json" },
  { data: trace, name: path },
])
const candidate = createCandidateFromExactBytes({ archive, manifest, artifactCount: 1 })
const frame = encodePublishFrameForWireContract(candidate, archive)
const malformedLength = Buffer.from(frame)
malformedLength.writeUInt32BE(frame.readUInt32BE(0) + 1, 0)
const mutatedZip = Buffer.from(frame)
const archiveOffset = 4 + frame.readUInt32BE(0)
mutatedZip[archiveOffset + 30] ^= 1
const submissionId = "sub_0123456789abcdefghjkmnpqrs"
const statusUrl = `/v1/marketplace/seller/candidates/${submissionId}`

const fixtures: readonly Fixture[] = [
  { file: "candidate-valid.frame", verdict: "accept", code: "accepted", bytes: frame },
  { file: "candidate-mutated-length.frame", verdict: "reject", code: "invalid_candidate", bytes: malformedLength },
  { file: "candidate-mutated-zip.frame", verdict: "reject", code: "invalid_candidate", bytes: mutatedZip },
  {
    file: "receipt-202.json",
    verdict: "accept",
    code: "accepted",
    bytes: encodePublishResponse({ protocolVersion: 1, submissionId, status: "accepted", statusUrl }),
  },
  {
    file: "status-200.json",
    verdict: "accept",
    code: "processing",
    bytes: encodePublishResponse({ protocolVersion: 1, submissionId, status: "processing" }),
  },
  {
    file: "error-400.json",
    verdict: "accept",
    code: "invalid_candidate",
    bytes: encodePublishResponse({ protocolVersion: 1, code: "invalid_candidate" }),
  },
  {
    file: "error-401.json",
    verdict: "accept",
    code: "unauthorized",
    bytes: encodePublishResponse({ protocolVersion: 1, code: "unauthorized" }),
  },
  {
    file: "error-404.json",
    verdict: "accept",
    code: "not_found",
    bytes: encodePublishResponse({ protocolVersion: 1, code: "not_found" }),
  },
  {
    file: "error-409.json",
    verdict: "accept",
    code: "idempotency_conflict",
    bytes: encodePublishResponse({ protocolVersion: 1, code: "idempotency_conflict" }),
  },
  {
    file: "error-413.json",
    verdict: "accept",
    code: "payload_too_large",
    bytes: encodePublishResponse({ protocolVersion: 1, code: "payload_too_large" }),
  },
  {
    file: "error-429.json",
    verdict: "accept",
    code: "rate_limited",
    bytes: encodePublishResponse({ protocolVersion: 1, code: "rate_limited" }),
  },
  {
    file: "error-503.json",
    verdict: "accept",
    code: "unavailable",
    bytes: encodePublishResponse({ protocolVersion: 1, code: "unavailable" }),
  },
  {
    file: "receipt-unknown-field-202.json",
    verdict: "reject",
    code: "invalid_response",
    bytes: Buffer.from(
      `{\"protocolVersion\":1,\"submissionId\":\"${submissionId}\",\"status\":\"accepted\",\"statusUrl\":\"${statusUrl}\",\"requestId\":\"forbidden\"}`,
      "utf8",
    ),
  },
]

const manifestDocument = {
  schemaVersion: 1,
  fixtures: fixtures.map((fixture) => ({
    file: fixture.file,
    sha256: createHash("sha256").update(fixture.bytes).digest("hex"),
    verdict: fixture.verdict,
    code: fixture.code,
  })),
}
const generatedFiles = [
  ...fixtures.map((fixture) => ({ file: fixture.file, bytes: fixture.bytes })),
  {
    file: "manifest.json",
    bytes: Buffer.from(`${JSON.stringify(manifestDocument, null, 2)}\n`, "utf8"),
  },
] as const
const checkIndex = Bun.argv.indexOf("--check")
const checkRoot = checkIndex === -1 ? undefined : Bun.argv[checkIndex + 1]
if (checkIndex !== -1 && checkRoot === undefined) throw new FixtureGenerationError("arguments")

if (checkRoot === undefined) {
  for (const generated of generatedFiles) await Bun.write(new URL(generated.file, root), generated.bytes)
} else {
  const destination = pathToFileURL(`${resolve(checkRoot)}/`)
  for (const generated of generatedFiles) {
    const file = Bun.file(new URL(generated.file, destination))
    if (!await file.exists()) throw new FixtureGenerationError(generated.file)
    const current = Buffer.from(await file.arrayBuffer())
    if (!current.equals(generated.bytes)) throw new FixtureGenerationError(generated.file)
  }
}
