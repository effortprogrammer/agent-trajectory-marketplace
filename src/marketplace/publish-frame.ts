import {
  PublishWireContractError,
  assertArchiveMatchesCandidate,
  encodeCandidateJson,
  parseCandidateJson,
  publishWirePolicy,
} from "./publish-contract"
import type { PublishCandidate } from "./publish-contract"
import {
  PublishBundleError,
  parsePublishBundle,
  takePublishBundle,
} from "./publish-bundle"
import type { PublishBundle } from "./publish-bundle"

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

const assertCandidateMatchesBundle = (candidate: PublishCandidate, archive: Buffer): void => {
  try {
    const expected = parsePublishBundle(archive).candidate
    if (!encodeCandidateJson(expected).equals(encodeCandidateJson(candidate))) {
      throw new PublishWireContractError("invalid_candidate")
    }
  } catch (error) {
    if (error instanceof PublishWireContractError) throw error
    throw new PublishWireContractError("invalid_candidate")
  }
}

const transferBufferView = (input: Buffer): Buffer => {
  if (
    !(input.buffer instanceof ArrayBuffer) ||
    input.byteOffset !== 0 ||
    input.byteLength !== input.buffer.byteLength
  ) {
    const isolated = Buffer.allocUnsafeSlow(input.byteLength)
    isolated.set(input)
    return isolated
  }
  const transferred = structuredClone(
    new Uint8Array(input.buffer),
    { transfer: [input.buffer] },
  )
  return Buffer.from(transferred.buffer)
}

const assemblePublishFrame = (candidate: PublishCandidate, archive: Buffer): PublishFrameParts => {
  const candidateJson = encodeCandidateJson(candidate)
  const header = Buffer.allocUnsafe(frameHeaderBytes)
  header.writeUInt32BE(candidateJson.byteLength, 0)
  return {
    archive,
    candidateJson,
    header,
    length: frameHeaderBytes + candidateJson.byteLength + archive.byteLength,
  }
}

const rawPublishFrameParts = (input: unknown, archiveInput: Uint8Array): PublishFrameParts => {
  const candidate = parseCandidateJson(encodeCandidateJson(input))
  const archive = bufferView(archiveInput)
  assertCandidateMatchesBundle(candidate, archive)
  return assemblePublishFrame(candidate, archive)
}

export const createPublishFrameBody = (bundle: PublishBundle): PublishFrameBody => {
  let candidate: PublishCandidate
  let archive: Buffer
  try {
    const admitted = takePublishBundle(bundle)
    candidate = admitted.candidate
    archive = transferBufferView(admitted.archive)
    assertArchiveMatchesCandidate(candidate, archive)
  } catch (error) {
    if (error instanceof PublishWireContractError) throw error
    if (error instanceof PublishBundleError) throw new PublishWireContractError("invalid_candidate")
    throw error
  }
  const parts = assemblePublishFrame(candidate, archive)
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
  const parts = rawPublishFrameParts(input, archiveInput)
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
  assertCandidateMatchesBundle(candidate, archive)
  return { candidate, archive }
}
