import { z } from "zod"

export const inferenceCreditMaximumDocumentBytes = 64 * 1024
const maximumSafeInteger = Number.MAX_SAFE_INTEGER
const safeInteger = z.number().int().min(0).max(maximumSafeInteger)
const positiveSafeInteger = safeInteger.min(1)
const timestamp = z.string().datetime({ offset: true }).max(64)
const canonicalModel = z.string().regex(/^[a-z][a-z0-9-]{0,127}$/)
const providerSlug = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)
const keyId = z.string().regex(/^ikey-[a-z0-9]{16}$/)
const quoteId = z.string().regex(/^iquote-[a-z0-9]{16}$/)
const requestId = z.string().regex(/^ireq-[a-z0-9]{16}$/)
const idempotencyKey = z.string().regex(/^idem-[a-z0-9-]{8,64}$/)
const cursor = z.string().regex(/^cursor-[a-z0-9-]{8,64}$/)

export const inferenceCreditScopes = ["inference:quote", "inference:request", "inference:usage"] as const
export const inferenceCreditScopeSchema = z.enum(inferenceCreditScopes)
export const inferenceCreditCapabilities = ["text"] as const
export const inferenceCreditCapabilitySchema = z.enum(inferenceCreditCapabilities)
export const inferenceCreditRequestStatuses = ["authorized", "streaming", "final", "cancelled", "unknown"] as const
export const inferenceCreditRequestStatusSchema = z.enum(inferenceCreditRequestStatuses)
export const inferenceCreditErrorCodes = ["invalid_request", "unauthenticated", "forbidden", "quote_expired", "request_not_found", "conflict"] as const
export const inferenceCreditErrorCodeSchema = z.enum(inferenceCreditErrorCodes)
export const inferenceCreditErrorMessages = {
  invalid_request: "The inference request is invalid.",
  unauthenticated: "Authentication is required.",
  forbidden: "Inference access is not permitted.",
  quote_expired: "The inference quote has expired.",
  request_not_found: "The inference request was not found.",
  conflict: "The inference request conflicts with an existing operation.",
} as const

const unique = <T>(values: readonly T[]): boolean => new Set(values).size === values.length
const boundedUnique = <T>(schema: z.ZodType<T>, maximum: number) => z.array(schema).min(1).max(maximum).refine(unique)

export const inferenceCreditKeySchema = z.object({
  keyId,
  status: z.enum(["active", "revoked"]),
  scopes: boundedUnique(inferenceCreditScopeSchema, 3),
  models: boundedUnique(canonicalModel, 32),
  requestCeilingCredits: positiveSafeInteger,
  budgetCredits: positiveSafeInteger,
  usedCredits: safeInteger,
  expiresAt: timestamp,
  createdAt: timestamp,
  revokedAt: timestamp.nullable(),
}).strict().superRefine((value, context) => {
  const revoked = value.status === "revoked"
  if (revoked !== (value.revokedAt !== null)) context.addIssue({ code: "custom", message: "status/revokedAt mismatch", path: ["revokedAt"] })
})

export const inferenceCreditKeyCreateRequestSchema = z.object({
  scopes: boundedUnique(inferenceCreditScopeSchema, 3),
  models: boundedUnique(canonicalModel, 32),
  requestCeilingCredits: positiveSafeInteger,
  budgetCredits: positiveSafeInteger,
  expiresAt: timestamp,
}).strict()

export const inferenceCreditKeyCreateResponseSchema = z.object({
  ok: z.literal(true),
  key: inferenceCreditKeySchema,
  credentialDelivery: z.literal("once"),
}).strict()

export const inferenceCreditKeyListResponseSchema = z.object({
  ok: z.literal(true),
  keys: z.object({ items: z.array(inferenceCreditKeySchema).max(100), nextCursor: cursor.nullable() }).strict(),
}).strict()

export const inferenceCreditKeyRevokeResponseSchema = z.object({ ok: z.literal(true), key: inferenceCreditKeySchema }).strict()

export const inferenceCreditQuoteRequestSchema = z.object({
  canonicalModel,
  capabilities: boundedUnique(inferenceCreditCapabilitySchema, 1),
}).strict()

export const inferenceCreditQuoteResponseSchema = z.object({
  ok: z.literal(true),
  quote: z.object({
    quoteId,
    canonicalModel,
    provider: providerSlug,
    capabilities: boundedUnique(inferenceCreditCapabilitySchema, 1),
    maximumDebitCredits: positiveSafeInteger,
    expiresAt: timestamp,
    createdAt: timestamp,
  }).strict(),
}).strict()

export const inferenceCreditRequestCreateSchema = z.object({ quoteId, idempotencyKey }).strict()
const usage = z.object({ inputTokens: safeInteger, outputTokens: safeInteger }).strict()

export const inferenceCreditRequestSchema = z.object({
  requestId,
  quoteId,
  canonicalModel,
  provider: providerSlug,
  status: inferenceCreditRequestStatusSchema,
  ceilingCredits: positiveSafeInteger,
  finalDebitCredits: safeInteger.nullable(),
  usage: usage.nullable(),
  createdAt: timestamp,
  finalizedAt: timestamp.nullable(),
}).strict().superRefine((value, context) => {
  switch (value.status) {
    case "final":
      if (value.finalDebitCredits === null || value.usage === null || value.finalizedAt === null) context.addIssue({ code: "custom", message: "finality mismatch" })
      return
    case "cancelled":
      if (value.finalDebitCredits !== 0 || value.usage !== null || value.finalizedAt === null) context.addIssue({ code: "custom", message: "cancellation mismatch" })
      return
    case "authorized":
    case "streaming":
    case "unknown":
      if (value.finalDebitCredits !== null || value.usage !== null || value.finalizedAt !== null) context.addIssue({ code: "custom", message: "pending finality mismatch" })
      return
  }
})

export const inferenceCreditRequestResponseSchema = z.object({ ok: z.literal(true), request: inferenceCreditRequestSchema }).strict()
export const inferenceCreditUsageResponseSchema = z.object({
  ok: z.literal(true),
  usage: z.object({ items: z.array(inferenceCreditRequestSchema).max(100), nextCursor: cursor.nullable() }).strict(),
}).strict()
export const inferenceCreditPrivacyHeadersSchema = z.object({
  cacheControl: z.literal("no-store"),
  pragma: z.literal("no-cache"),
  referrerPolicy: z.literal("no-referrer"),
  xRobotsTag: z.literal("noindex"),
}).strict()
export const inferenceCreditErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({ code: inferenceCreditErrorCodeSchema, message: z.string().min(1).max(1024), requestId: z.string().regex(/^req-[a-zA-Z0-9_-]+$/).max(128).optional() }).strict(),
}).strict().superRefine((value, context) => {
  if (value.error.message !== inferenceCreditErrorMessages[value.error.code]) {
    context.addIssue({ code: "custom", message: "error message mismatch", path: ["error", "message"] })
  }
})

export type InferenceCreditKey = z.infer<typeof inferenceCreditKeySchema>
export type InferenceCreditRequest = z.infer<typeof inferenceCreditRequestSchema>
export type InferenceCreditDocumentKind = "key-create-request" | "key-create" | "key-list" | "key-revoke" | "quote-request" | "quote" | "request" | "cancel" | "probe" | "usage" | "privacy" | "error"
export type InferenceCreditDocument =
  | z.infer<typeof inferenceCreditKeyCreateRequestSchema>
  | z.infer<typeof inferenceCreditKeyCreateResponseSchema>
  | z.infer<typeof inferenceCreditKeyListResponseSchema>
  | z.infer<typeof inferenceCreditKeyRevokeResponseSchema>
  | z.infer<typeof inferenceCreditQuoteRequestSchema>
  | z.infer<typeof inferenceCreditQuoteResponseSchema>
  | z.infer<typeof inferenceCreditRequestCreateSchema>
  | z.infer<typeof inferenceCreditRequestResponseSchema>
  | z.infer<typeof inferenceCreditUsageResponseSchema>
  | z.infer<typeof inferenceCreditPrivacyHeadersSchema>
  | z.infer<typeof inferenceCreditErrorSchema>
