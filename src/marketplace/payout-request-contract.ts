import { z } from "zod"

const maximumSafeInteger = Number.MAX_SAFE_INTEGER
const nonnegativeSafeIntegerSchema = z.number().int().min(0).max(maximumSafeInteger)
const payoutRequestTimestampSchema = z.string().datetime({ offset: true })
const payoutRequestIdSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
)
const payoutOperationIdSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
)

export const payoutRequestStatuses = [
  "requested",
  "pending",
  "approved",
  "processing",
  "cancelled",
  "rejected",
  "paid",
] as const
export const payoutRequestStatusSchema = z.enum(payoutRequestStatuses)

export const payoutRequestErrorMessages = Object.freeze({
  invalid_request: "The payout request is invalid.",
  unauthorized: "Authentication is required.",
  forbidden: "Payout request access is not permitted.",
  open_request_exists: "An active payout request already exists.",
  request_not_withdrawable: "This payout request can no longer be withdrawn.",
  payout_request_conflict: "The payout request conflicts with an existing operation.",
  below_payout_threshold: "At least USD 100.00 is required to request payout.",
  rate_limited: "Too many payout request attempts. Try again later.",
  weekly_payout_limit_reached: "The rolling weekly payout limit has been reached.",
  payout_request_creation_disabled: "Payout requests are temporarily unavailable.",
  payout_request_service_unavailable: "Payout request service is unavailable.",
} as const)

export type PayoutRequestErrorCode = keyof typeof payoutRequestErrorMessages
export type PayoutRequestStatus = (typeof payoutRequestStatuses)[number]

export const payoutRequestDetailSchema = z
  .object({
    requestId: payoutRequestIdSchema,
    amountMinor: nonnegativeSafeIntegerSchema,
    status: payoutRequestStatusSchema,
    requestedAt: payoutRequestTimestampSchema,
    approvedAt: payoutRequestTimestampSchema.nullable(),
    rejectedReason: z.string().min(1).max(255).regex(/^[^\u0000-\u001f\u007f]*$/).nullable(),
    paidAt: payoutRequestTimestampSchema.nullable(),
    externalReference: z.string().min(1).max(255).regex(/^[^\u0000-\u001f\u007f]*$/).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const approvedStatus = value.status === "approved" || value.status === "processing" || value.status === "paid"
    const issues: ReadonlyArray<readonly [boolean, string]> = [
      [approvedStatus !== (value.approvedAt !== null), "approvedAt"],
      [(value.status === "rejected") !== (value.rejectedReason !== null), "rejectedReason"],
      [(value.status === "paid") !== (value.paidAt !== null), "paidAt"],
      [(value.status === "paid") !== (value.externalReference !== null), "externalReference"],
    ]
    for (const [invalid, path] of issues) {
      if (invalid) context.addIssue({ code: "custom", message: `status/nullability mismatch: ${path}`, path: [path] })
    }
  })

export const payoutRequestEnvelopeSchema = z
  .object({
    ok: z.literal(true),
    payoutRequest: z
      .object({
        currency: z.literal("USD"),
        thresholdMinor: z.literal(10000),
        availableMinor: nonnegativeSafeIntegerSchema,
        heldMinor: nonnegativeSafeIntegerSchema,
        request: payoutRequestDetailSchema.nullable(),
      })
      .strict(),
  })
  .strict()

export const payoutRequestErrorSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.string().regex(/^[a-z][a-z0-9_]*$/),
        message: z.string().min(1),
      })
      .strict(),
  })
  .strict()

export type PayoutRequestDetail = z.infer<typeof payoutRequestDetailSchema>
export type PayoutRequestEnvelope = z.infer<typeof payoutRequestEnvelopeSchema>
export type PayoutRequestError = z.infer<typeof payoutRequestErrorSchema>
export type PayoutRequestHttpResponse = PayoutRequestEnvelope | PayoutRequestError

export class PayoutRequestContractError extends Error {
  public readonly name = "PayoutRequestContractError"
  public constructor() { super("invalid_response") }
}

const errorMessagesByCode: Readonly<Record<string, string>> = payoutRequestErrorMessages
const successStatuses = new Set([200, 201])
const errorCodesByStatus = new Map<number, ReadonlySet<string>>([
  [400, new Set(["invalid_request"])],
  [401, new Set(["unauthorized"])],
  [403, new Set(["forbidden"])],
  [409, new Set(["open_request_exists", "request_not_withdrawable", "payout_request_conflict"])],
  [422, new Set(["below_payout_threshold"])],
  [429, new Set(["rate_limited", "weekly_payout_limit_reached"])],
  [503, new Set(["payout_request_creation_disabled", "payout_request_service_unavailable"])],
])

export const isValidPayoutOperationId = (value: string): boolean =>
  payoutOperationIdSchema.safeParse(value).success

const parseJson = (bytes: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch {
    throw new PayoutRequestContractError()
  }
}

const encodeDetail = (request: PayoutRequestDetail): Record<string, unknown> => ({
  requestId: request.requestId,
  amountMinor: request.amountMinor,
  status: request.status,
  requestedAt: request.requestedAt,
  approvedAt: request.approvedAt,
  rejectedReason: request.rejectedReason,
  paidAt: request.paidAt,
  externalReference: request.externalReference,
})

export const encodePayoutRequestResponse = (response: PayoutRequestHttpResponse): Buffer => {
  if (response.ok) {
    const { payoutRequest } = response
    return Buffer.from(JSON.stringify({
      ok: true,
      payoutRequest: {
        currency: payoutRequest.currency,
        thresholdMinor: payoutRequest.thresholdMinor,
        availableMinor: payoutRequest.availableMinor,
        heldMinor: payoutRequest.heldMinor,
        request: payoutRequest.request === null ? null : encodeDetail(payoutRequest.request),
      },
    }), "utf8")
  }
  return Buffer.from(JSON.stringify({
    ok: false,
    error: { code: response.error.code, message: response.error.message },
  }), "utf8")
}

export const parsePayoutRequestResponse = (status: number, bytes: Uint8Array): PayoutRequestHttpResponse => {
  const input = parseJson(bytes)
  let response: PayoutRequestHttpResponse
  if (successStatuses.has(status)) {
    const parsed = payoutRequestEnvelopeSchema.safeParse(input)
    if (!parsed.success) throw new PayoutRequestContractError()
    response = parsed.data
  } else {
    const allowedCodes = errorCodesByStatus.get(status)
    if (allowedCodes === undefined) throw new PayoutRequestContractError()
    const parsed = payoutRequestErrorSchema.safeParse(input)
    if (!parsed.success) throw new PayoutRequestContractError()
    const { code, message } = parsed.data.error
    if (!allowedCodes.has(code) || message !== errorMessagesByCode[code]) {
      throw new PayoutRequestContractError()
    }
    response = parsed.data
  }
  if (!Buffer.from(bytes).equals(encodePayoutRequestResponse(response))) {
    throw new PayoutRequestContractError()
  }
  return response
}
