import { z } from "zod"

import {
  inferenceCreditErrorSchema,
  inferenceCreditKeyCreateRequestSchema,
  inferenceCreditKeyCreateResponseSchema,
  inferenceCreditKeyListResponseSchema,
  inferenceCreditKeyRevokeResponseSchema,
  inferenceCreditMaximumDocumentBytes,
  inferenceCreditPrivacyHeadersSchema,
  inferenceCreditQuoteRequestSchema,
  inferenceCreditQuoteResponseSchema,
  inferenceCreditRequestCreateSchema,
  inferenceCreditRequestResponseSchema,
  inferenceCreditUsageResponseSchema,
} from "./inference-credit-types"
import type { InferenceCreditDocument, InferenceCreditDocumentKind, InferenceCreditRequest } from "./inference-credit-types"

export { inferenceCreditMaximumDocumentBytes } from "./inference-credit-types"
export type { InferenceCreditDocument, InferenceCreditDocumentKind, InferenceCreditRequest } from "./inference-credit-types"

export class InferenceCreditContractError extends Error {
  public readonly name = "InferenceCreditContractError"
  public constructor() { super("invalid_inference_credit_document") }
}

const statusIsExpected = (kind: InferenceCreditDocumentKind, status: number): boolean => {
  switch (kind) {
    case "key-create-request":
    case "quote-request":
    case "request-create":
      return status === 0
    case "key-create":
      return status === 201
    case "request":
      return status === 202
    case "key-list":
    case "key-revoke":
    case "quote":
    case "cancel":
    case "probe":
    case "usage":
    case "privacy":
      return status === 200
    case "error":
      return status === 400 || status === 401 || status === 403 || status === 404 || status === 409
  }
}

const errorCodeIsExpected = (status: number, code: string): boolean => {
  switch (status) {
    case 400:
      return code === "invalid_request"
    case 401:
      return code === "unauthenticated"
    case 403:
      return code === "forbidden"
    case 404:
      return code === "request_not_found"
    case 409:
      return code === "quote_expired" || code === "conflict"
    default:
      return false
  }
}

const schemaFor = (kind: InferenceCreditDocumentKind): z.ZodType<InferenceCreditDocument> => {
  switch (kind) {
    case "key-create-request":
      return inferenceCreditKeyCreateRequestSchema
    case "key-create":
      return inferenceCreditKeyCreateResponseSchema
    case "key-list":
      return inferenceCreditKeyListResponseSchema
    case "key-revoke":
      return inferenceCreditKeyRevokeResponseSchema
    case "quote-request":
      return inferenceCreditQuoteRequestSchema
    case "quote":
      return inferenceCreditQuoteResponseSchema
    case "request-create":
      return inferenceCreditRequestCreateSchema
    case "request":
    case "cancel":
    case "probe":
      return inferenceCreditRequestResponseSchema
    case "usage":
      return inferenceCreditUsageResponseSchema
    case "privacy":
      return inferenceCreditPrivacyHeadersSchema
    case "error":
      return inferenceCreditErrorSchema
  }
}

const parseJson = (bytes: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) throw new InferenceCreditContractError()
    throw error
  }
}

const encodeBody = (kind: InferenceCreditDocumentKind, input: unknown): Buffer => {
  const parsed = schemaFor(kind).safeParse(input)
  if (!parsed.success) throw new InferenceCreditContractError()
  const encoded = Buffer.from(JSON.stringify(parsed.data), "utf8")
  if (encoded.byteLength > inferenceCreditMaximumDocumentBytes) throw new InferenceCreditContractError()
  return encoded
}

export const encodeInferenceCreditDocument = (kind: InferenceCreditDocumentKind, input: unknown): Buffer => encodeBody(kind, input)

export const parseInferenceCreditDocument = (kind: InferenceCreditDocumentKind, status: number, bytes: Uint8Array): InferenceCreditDocument => {
  if (!statusIsExpected(kind, status) || bytes.byteLength > inferenceCreditMaximumDocumentBytes) throw new InferenceCreditContractError()
  const parsed = schemaFor(kind).safeParse(parseJson(bytes))
  if (!parsed.success || !Buffer.from(bytes).equals(encodeBody(kind, parsed.data))) throw new InferenceCreditContractError()
  if (kind === "error") {
    const error = inferenceCreditErrorSchema.safeParse(parsed.data)
    if (!error.success || !errorCodeIsExpected(status, error.data.error.code)) throw new InferenceCreditContractError()
  }
  return parsed.data
}

const finalStreamPrefix = "event: final\ndata: "
const finalStreamSuffix = "\n\ndata: [DONE]\n"

export const encodeInferenceCreditFinalStream = (request: InferenceCreditRequest): Buffer => {
  if (request.status !== "final" && request.status !== "cancelled") throw new InferenceCreditContractError()
  const body = encodeBody("cancel", { ok: true, request })
  const stream = Buffer.from(`${finalStreamPrefix}${body.toString("utf8")}${finalStreamSuffix}`, "utf8")
  if (stream.byteLength > inferenceCreditMaximumDocumentBytes) throw new InferenceCreditContractError()
  return stream
}

export const parseInferenceCreditFinalStream = (bytes: Uint8Array): { readonly request: InferenceCreditRequest } => {
  if (bytes.byteLength > inferenceCreditMaximumDocumentBytes) throw new InferenceCreditContractError()
  let stream: string
  try {
    stream = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch (error) {
    if (error instanceof TypeError) throw new InferenceCreditContractError()
    throw error
  }
  if (!stream.startsWith(finalStreamPrefix) || !stream.endsWith(finalStreamSuffix)) throw new InferenceCreditContractError()
  const body = stream.slice(finalStreamPrefix.length, -finalStreamSuffix.length)
  const parsed = inferenceCreditRequestResponseSchema.safeParse(parseJson(Buffer.from(body, "utf8")))
  if (!parsed.success || (parsed.data.request.status !== "final" && parsed.data.request.status !== "cancelled")) throw new InferenceCreditContractError()
  if (!bytesEqual(bytes, encodeInferenceCreditFinalStream(parsed.data.request))) throw new InferenceCreditContractError()
  return parsed.data
}

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => Buffer.from(left).equals(right)
