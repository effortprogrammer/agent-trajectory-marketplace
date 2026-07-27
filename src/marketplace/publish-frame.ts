import {
  PublishWireContractError,
  assertArchiveMatchesCandidate,
  encodeCandidateJson,
  parseCandidateJson,
  publishWirePolicy,
} from "./publish-contract"
import type { PublishCandidate } from "./publish-contract"

const frameHeaderBytes = 4

export type ParsedPublishFrame = Readonly<{
  candidate: PublishCandidate
  archive: Buffer
}>

export const encodePublishFrame = (input: unknown, archiveInput: Uint8Array): Buffer => {
  const candidateJson = encodeCandidateJson(input)
  const candidate = parseCandidateJson(candidateJson)
  const archive = Buffer.from(archiveInput)
  assertArchiveMatchesCandidate(candidate, archive)
  const frame = Buffer.allocUnsafe(frameHeaderBytes + candidateJson.byteLength + archive.byteLength)
  frame.writeUInt32BE(candidateJson.byteLength, 0)
  candidateJson.copy(frame, frameHeaderBytes)
  archive.copy(frame, frameHeaderBytes + candidateJson.byteLength)
  return frame
}

export const parsePublishFrame = (input: Uint8Array): ParsedPublishFrame => {
  const frame = Buffer.from(input)
  if (frame.byteLength < frameHeaderBytes) throw new PublishWireContractError("invalid_candidate")
  const candidateByteCount = frame.readUInt32BE(0)
  if (candidateByteCount > publishWirePolicy.maxJsonBytes) {
    throw new PublishWireContractError("payload_too_large")
  }
  const candidateEnd = frameHeaderBytes + candidateByteCount
  if (candidateEnd > frame.byteLength) throw new PublishWireContractError("invalid_candidate")
  const candidate = parseCandidateJson(frame.subarray(frameHeaderBytes, candidateEnd))
  const archive = Buffer.from(frame.subarray(candidateEnd))
  assertArchiveMatchesCandidate(candidate, archive)
  return { candidate, archive }
}
