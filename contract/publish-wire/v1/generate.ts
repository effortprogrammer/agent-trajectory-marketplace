import { createHash } from "node:crypto"

import {
  createCandidateFromExactBytes,
  encodePublishResponse,
} from "../../../src/marketplace/publish-contract"
import { encodePublishFrame } from "../../../src/marketplace/publish-frame"

type Fixture = Readonly<{
  file: string
  verdict: "accept" | "reject"
  code: string
  bytes: Uint8Array
}>

const root = new URL("./", import.meta.url)
const archive = Buffer.from("PK\u0003\u0004publish-wire-v1-dataset", "utf8")
const manifest = Buffer.from('{"formatVersion":1,"artifacts":[]}', "utf8")
const candidate = createCandidateFromExactBytes({ archive, manifest, artifactCount: 1 })
const frame = encodePublishFrame(candidate, archive)
const malformedLength = Buffer.from(frame)
malformedLength.writeUInt32BE(frame.readUInt32BE(0) + 1, 0)
const mutatedZip = Buffer.from(frame)
mutatedZip[mutatedZip.byteLength - 1] ^= 1
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

for (const fixture of fixtures) await Bun.write(new URL(fixture.file, root), fixture.bytes)

const manifestDocument = {
  schemaVersion: 1,
  fixtures: fixtures.map((fixture) => ({
    file: fixture.file,
    sha256: createHash("sha256").update(fixture.bytes).digest("hex"),
    verdict: fixture.verdict,
    code: fixture.code,
  })),
}
await Bun.write(new URL("manifest.json", root), `${JSON.stringify(manifestDocument, null, 2)}\n`)
