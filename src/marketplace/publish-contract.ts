import { createHash } from "node:crypto"

import { z } from "zod"

export const publishWirePolicy = { maxJsonBytes: 64 * 1024 } as const

export const publishArchiveSha256Schema = z.string().regex(/^[0-9a-f]{64}$/).brand<"PublishArchiveSha256">()
export const publishBundleIdSchema = z.string().regex(/^bundle-[0-9a-f]{64}$/).brand<"PublishBundleId">()
export const publishSubmissionIdSchema = z
  .string()
  .regex(/^sub_[0-9a-hjkmnp-tv-z]{26}$/)
  .brand<"PublishSubmissionId">()

const positiveIntegerSchema = z.number().int().positive()
const candidateJsonSchema = z
  .object({
    protocolVersion: z.literal(1),
    bundleId: publishBundleIdSchema,
    archiveSha256: publishArchiveSha256Schema,
    archiveByteCount: positiveIntegerSchema,
    manifestSha256: publishArchiveSha256Schema,
    artifactCount: positiveIntegerSchema,
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.bundleId !== `bundle-${candidate.archiveSha256}`) {
      context.addIssue({ code: "custom", message: "bundleId must derive from archiveSha256" })
    }
  })

export const publishReceiptSchema = z
  .object({
    protocolVersion: z.literal(1),
    submissionId: publishSubmissionIdSchema,
    status: z.literal("accepted"),
    statusUrl: z.string().regex(/^\/v1\/marketplace\/seller\/candidates\/sub_[0-9a-hjkmnp-tv-z]{26}$/),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.statusUrl !== `/v1/marketplace/seller/candidates/${receipt.submissionId}`) {
      context.addIssue({ code: "custom", message: "statusUrl must name its submission" })
    }
  })

export const publishStatusSchema = z
  .object({
    protocolVersion: z.literal(1),
    submissionId: publishSubmissionIdSchema,
    status: z.enum(["accepted", "processing", "completed", "rejected"]),
  })
  .strict()

export const publishErrorCodeSchema = z.enum([
  "invalid_candidate",
  "unauthorized",
  "not_found",
  "idempotency_conflict",
  "payload_too_large",
  "rate_limited",
  "unavailable",
])

export const publishErrorSchema = z
  .object({
    protocolVersion: z.literal(1),
    code: publishErrorCodeSchema,
  })
  .strict()

export type PublishArchiveSha256 = z.infer<typeof publishArchiveSha256Schema>
export type PublishBundleId = z.infer<typeof publishBundleIdSchema>
export type PublishSubmissionId = z.infer<typeof publishSubmissionIdSchema>
export type PublishCandidate = Readonly<{
  protocolVersion: 1
  bundleId: PublishBundleId
  archiveSha256: PublishArchiveSha256
  archiveByteCount: number
  manifestSha256: PublishArchiveSha256
  artifactCount: number
}>
export type PublishReceipt = Readonly<{
  protocolVersion: 1
  submissionId: PublishSubmissionId
  status: "accepted"
  statusUrl: string
}>
export type PublishStatus = Readonly<{
  protocolVersion: 1
  submissionId: PublishSubmissionId
  status: "accepted" | "processing" | "completed" | "rejected"
}>
export type PublishErrorCode = z.infer<typeof publishErrorCodeSchema>
export type PublishError = Readonly<{
  protocolVersion: 1
  code: PublishErrorCode
}>
export type PublishResponse = PublishReceipt | PublishStatus | PublishError
export type PublishWireContractErrorCode = "invalid_candidate" | "payload_too_large" | "invalid_response"

export class PublishWireContractError extends Error {
  public readonly name = "PublishWireContractError"
  public constructor(public readonly code: PublishWireContractErrorCode) { super(code) }
}

const decodeUtf8 = (bytes: Uint8Array, code: PublishWireContractErrorCode): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch (error) {
    throw new PublishWireContractError(code)
  }
}

const parseJson = (bytes: Uint8Array, code: PublishWireContractErrorCode): unknown => {
  try {
    return JSON.parse(decodeUtf8(bytes, code))
  } catch (error) {
    if (error instanceof PublishWireContractError) throw error
    throw new PublishWireContractError(code)
  }
}

const ensureJsonCap = (bytes: Uint8Array, code: PublishWireContractErrorCode): void => {
  if (bytes.byteLength > publishWirePolicy.maxJsonBytes) throw new PublishWireContractError(code)
}

const toCandidate = (input: unknown): PublishCandidate => {
  const parsed = candidateJsonSchema.safeParse(input)
  if (!parsed.success) throw new PublishWireContractError("invalid_candidate")
  return {
    protocolVersion: parsed.data.protocolVersion,
    bundleId: parsed.data.bundleId,
    archiveSha256: parsed.data.archiveSha256,
    archiveByteCount: parsed.data.archiveByteCount,
    manifestSha256: parsed.data.manifestSha256,
    artifactCount: parsed.data.artifactCount,
  }
}

export const encodeCandidateJson = (input: unknown): Buffer => {
  const candidate = toCandidate(input)
  const bytes = Buffer.from(
    JSON.stringify({
      protocolVersion: candidate.protocolVersion,
      bundleId: candidate.bundleId,
      archiveSha256: candidate.archiveSha256,
      archiveByteCount: candidate.archiveByteCount,
      manifestSha256: candidate.manifestSha256,
      artifactCount: candidate.artifactCount,
    }),
    "utf8",
  )
  ensureJsonCap(bytes, "payload_too_large")
  return bytes
}

export const parseCandidateJson = (bytes: Uint8Array): PublishCandidate => {
  ensureJsonCap(bytes, "payload_too_large")
  const candidate = toCandidate(parseJson(bytes, "invalid_candidate"))
  if (!Buffer.from(bytes).equals(encodeCandidateJson(candidate))) {
    throw new PublishWireContractError("invalid_candidate")
  }
  return candidate
}

export type PublishCandidateDerivation = Readonly<{
  archive: Uint8Array
  manifest: Uint8Array
  artifactCount: number
}>

export const createCandidateFromExactBytes = (input: PublishCandidateDerivation): PublishCandidate => {
  return toCandidate({
    protocolVersion: 1,
    bundleId: `bundle-${createHash("sha256").update(input.archive).digest("hex")}`,
    archiveSha256: createHash("sha256").update(input.archive).digest("hex"),
    archiveByteCount: input.archive.byteLength,
    manifestSha256: createHash("sha256").update(input.manifest).digest("hex"),
    artifactCount: input.artifactCount,
  })
}

const toReceipt = (input: unknown): PublishReceipt => {
  const parsed = publishReceiptSchema.safeParse(input)
  if (!parsed.success) throw new PublishWireContractError("invalid_response")
  return {
    protocolVersion: parsed.data.protocolVersion,
    submissionId: parsed.data.submissionId,
    status: parsed.data.status,
    statusUrl: parsed.data.statusUrl,
  }
}

const toStatus = (input: unknown): PublishStatus => {
  const parsed = publishStatusSchema.safeParse(input)
  if (!parsed.success) throw new PublishWireContractError("invalid_response")
  return {
    protocolVersion: parsed.data.protocolVersion,
    submissionId: parsed.data.submissionId,
    status: parsed.data.status,
  }
}

const toError = (input: unknown): PublishError => {
  const parsed = publishErrorSchema.safeParse(input)
  if (!parsed.success) throw new PublishWireContractError("invalid_response")
  return { protocolVersion: parsed.data.protocolVersion, code: parsed.data.code }
}

export const publishErrorCodeForHttpStatus = (status: number): Readonly<{ status: number; code: PublishErrorCode }> => {
  switch (status) {
    case 400:
      return { status: 400, code: "invalid_candidate" }
    case 401:
      return { status: 401, code: "unauthorized" }
    case 404:
      return { status: 404, code: "not_found" }
    case 409:
      return { status: 409, code: "idempotency_conflict" }
    case 413:
      return { status: 413, code: "payload_too_large" }
    case 429:
      return { status: 429, code: "rate_limited" }
    case 503:
      return { status: 503, code: "unavailable" }
    default:
      return { status: 503, code: "unavailable" }
  }
}

export const encodePublishResponse = (input: unknown): Buffer => {
  const encoded = typeof input === "object" && input !== null && "statusUrl" in input
    ? JSON.stringify(toReceipt(input))
    : typeof input === "object" && input !== null && "code" in input
      ? JSON.stringify(toError(input))
      : JSON.stringify(toStatus(input))
  const bytes = Buffer.from(encoded, "utf8")
  ensureJsonCap(bytes, "invalid_response")
  return bytes
}

export const parsePublishResponse = (httpStatus: number, bytes: Uint8Array): PublishResponse => {
  ensureJsonCap(bytes, "invalid_response")
  const input = parseJson(bytes, "invalid_response")
  let response: PublishResponse
  switch (httpStatus) {
    case 200:
      response = toStatus(input)
      break
    case 202:
      response = toReceipt(input)
      break
    default: {
      const expected = publishErrorCodeForHttpStatus(httpStatus)
      if (expected.status !== httpStatus) throw new PublishWireContractError("invalid_response")
      const error = toError(input)
      if (error.code !== expected.code) throw new PublishWireContractError("invalid_response")
      response = error
    }
  }
  if (!Buffer.from(bytes).equals(encodePublishResponse(response))) {
    throw new PublishWireContractError("invalid_response")
  }
  return response
}

export const assertArchiveMatchesCandidate = (candidate: PublishCandidate, archive: Uint8Array): void => {
  if (archive.byteLength !== candidate.archiveByteCount) throw new PublishWireContractError("invalid_candidate")
  if (createHash("sha256").update(archive).digest("hex") !== candidate.archiveSha256) {
    throw new PublishWireContractError("invalid_candidate")
  }
}
