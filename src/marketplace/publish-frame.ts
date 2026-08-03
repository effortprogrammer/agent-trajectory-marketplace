import {
  PublishWireContractError,
  assertArchiveMatchesCandidate,
  encodeCandidateJson,
  parseCandidateJson,
  publishWirePolicy,
} from "./publish-contract"
import type { PublishCandidate } from "./publish-contract"

const frameHeaderBytes = 4

type PublishFrameParts = Readonly<{
  readonly archive: Buffer
  readonly candidateJson: Buffer
  readonly header: Buffer
  readonly length: number
}>

export type PublishFrameBody = Readonly<{
  readonly body: ReadableStream<Uint8Array>
  readonly contentLength: number
}>

export type ParsedPublishFrame = Readonly<{
  candidate: PublishCandidate
  archive: Buffer
}>

const bufferView = (input: Uint8Array): Buffer =>
  Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength)

const publishFrameParts = (input: unknown, archiveInput: Uint8Array): PublishFrameParts => {
  const candidateJson = encodeCandidateJson(input)
  const candidate = parseCandidateJson(candidateJson)
  const archive = bufferView(archiveInput)
  assertArchiveMatchesCandidate(candidate, archive)
  const header = Buffer.allocUnsafe(frameHeaderBytes)
  header.writeUInt32BE(candidateJson.byteLength, 0)
  return {
    archive,
    candidateJson,
    header,
    length: frameHeaderBytes + candidateJson.byteLength + archive.byteLength,
  }
}

export const createPublishFrameBody = (input: unknown, archiveInput: Uint8Array): PublishFrameBody => {
  const parts = publishFrameParts(input, archiveInput)
  const chunks: readonly Uint8Array[] = [parts.header, parts.candidateJson, parts.archive]
  let index = 0
  return {
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index]
        if (chunk === undefined) {
          controller.close()
          return
        }
        index += 1
        controller.enqueue(chunk)
      },
    }),
    contentLength: parts.length,
  }
}

export const encodePublishFrame = (input: unknown, archiveInput: Uint8Array): Buffer => {
  const parts = publishFrameParts(input, archiveInput)
  return Buffer.concat([parts.header, parts.candidateJson, parts.archive], parts.length)
}

export const parsePublishFrame = (input: Uint8Array): ParsedPublishFrame => {
  const frame = bufferView(input)
  if (frame.byteLength < frameHeaderBytes) throw new PublishWireContractError("invalid_candidate")
  const candidateByteCount = frame.readUInt32BE(0)
  if (candidateByteCount > publishWirePolicy.maxJsonBytes) {
    throw new PublishWireContractError("payload_too_large")
  }
  const candidateEnd = frameHeaderBytes + candidateByteCount
  if (candidateEnd > frame.byteLength) throw new PublishWireContractError("invalid_candidate")
  const candidate = parseCandidateJson(frame.subarray(frameHeaderBytes, candidateEnd))
  const archive = frame.subarray(candidateEnd)
  assertArchiveMatchesCandidate(candidate, archive)
  return { candidate, archive }
}
