import { z } from "zod"

export const worldContractPolicy = { maxResponseBytes: 64 * 1024 } as const

export const worldDigestSchema = z.string().regex(/^[0-9a-f]{64}$/)
const dateTimeSchema = z.string().datetime({ offset: true })
export const worldUuidSchema = z.uuid()
export const worldIdentifierSchema = z.string().min(1).max(512)
export const worldHostedCreateBodySchema = z.record(z.string(), z.unknown())
const nonnegativeIntegerSchema = z.number().int().nonnegative()

export const worldCatalogSummarySchema = z.object({
  worldId: worldIdentifierSchema,
  worldVersion: worldIdentifierSchema,
  packDigest: worldDigestSchema,
  familyKey: worldIdentifierSchema,
  availability: z.enum(["hosted", "on_prem", "both"]),
  scenarioCount: nonnegativeIntegerSchema,
  capabilityIds: z.array(worldIdentifierSchema),
  backendTypes: z.array(worldIdentifierSchema),
  conformanceStatus: worldIdentifierSchema,
  conformanceReceiptDigest: worldDigestSchema,
  hostedPriceCredits: nonnegativeIntegerSchema.nullable(),
  onPremPriceCredits: nonnegativeIntegerSchema.nullable(),
  listedAt: dateTimeSchema,
}).strict()

export const worldCatalogListResponseSchema = z.object({
  worlds: z.array(worldCatalogSummarySchema).readonly(),
}).strict().readonly()

const worldWorkflowSummarySchema = z.object({
  sliceId: worldIdentifierSchema,
  scenarioIds: z.array(worldIdentifierSchema),
}).strict()
const worldCapabilitySummarySchema = z.object({
  capabilityId: worldIdentifierSchema,
  effects: z.array(worldIdentifierSchema),
}).strict()
const worldBackendSummarySchema = z.object({
  backendId: worldIdentifierSchema,
  kind: worldIdentifierSchema,
  runtimeAbi: worldIdentifierSchema,
  capabilities: z.array(worldIdentifierSchema),
}).strict()
const worldDimensionCoverageSchema = z.object({
  dimension: worldIdentifierSchema,
  matches: nonnegativeIntegerSchema,
  mismatches: nonnegativeIntegerSchema,
  ambiguous: nonnegativeIntegerSchema,
  unsupported: nonnegativeIntegerSchema,
  denominator: nonnegativeIntegerSchema,
  outcome: worldIdentifierSchema,
}).strict()
const worldConformanceSchema = z.object({
  status: worldIdentifierSchema,
  reportDigest: worldDigestSchema,
  vectorDigest: worldDigestSchema,
  receiptDigest: worldDigestSchema,
  vector: z.array(worldDimensionCoverageSchema),
  coverageCovered: nonnegativeIntegerSchema,
  coverageTotal: nonnegativeIntegerSchema,
  unsupportedCount: nonnegativeIntegerSchema,
  ambiguousCount: nonnegativeIntegerSchema,
}).strict()

export const worldCatalogDetailResponseSchema = worldCatalogSummarySchema.extend({
  workflows: z.array(worldWorkflowSummarySchema).readonly(),
  capabilities: z.array(worldCapabilitySummarySchema).readonly(),
  backends: z.array(worldBackendSummarySchema).readonly(),
  conformance: worldConformanceSchema,
}).strict().readonly()

const worldDeliveryScopeSchema = z.enum(["hosted_execute", "on_prem_download"])
const worldModeSchema = z.enum(["hosted", "on_prem"])
const worldSignatureSchema = z.object({
  formatVersion: z.literal(1),
  keyId: worldIdentifierSchema,
  keyVersion: worldIdentifierSchema,
  algorithm: z.literal("ECDSA_SHA_256"),
  signature: z.string().min(1),
}).strict()
const worldSourceMetadataSchema = z.object({
  sourceKinds: z.array(z.enum(["openapi", "mcp", "graphql", "documentation"])),
  licenseReferences: z.array(worldIdentifierSchema),
}).strict()
const worldDeliveryEnvelopeSchema = z.object({
  formatVersion: z.literal(1),
  contractId: worldUuidSchema,
  buyerAccountId: worldUuidSchema,
  worldId: worldIdentifierSchema,
  packVersionId: worldUuidSchema,
  packDigest: worldDigestSchema,
  mode: worldModeSchema,
  scope: worldDeliveryScopeSchema,
  usePolicy: z.enum(["reusable", "one_time"]),
  issuedAt: dateTimeSchema,
  sourceMetadata: worldSourceMetadataSchema,
  signature: worldSignatureSchema,
}).strict().superRefine((value, context) => {
  const expectedScope = value.mode === "hosted" ? "hosted_execute" : "on_prem_download"
  if (value.scope !== expectedScope) {
    context.addIssue({ code: "custom", path: ["scope"], message: "scope_mode_mismatch" })
  }
})

export const worldDeliveryGrantSchema = z.object({
  entitlementId: worldUuidSchema,
  scope: worldDeliveryScopeSchema,
  envelope: worldDeliveryEnvelopeSchema,
  downloadUrl: z.string().regex(/^\/v1\/marketplace\/buyer\/world-entitlements\/[0-9a-f-]{36}\/download$/).nullable(),
}).strict().superRefine((value, context) => {
  if (value.scope !== value.envelope.scope) {
    context.addIssue({ code: "custom", path: ["scope"], message: "grant_scope_mismatch" })
  }
  const shouldHaveDownload = value.scope === "on_prem_download"
  if (shouldHaveDownload !== (value.downloadUrl !== null)) {
    context.addIssue({ code: "custom", path: ["downloadUrl"], message: "download_scope_mismatch" })
  }
}).readonly()

export const worldHostedRuntimeErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum([
      "not_found", "idempotency_conflict", "stale_revision", "operation_outcome_unknown",
      "quota_exceeded", "invalid_request", "runtime_rejected", "response_too_large",
    ]),
    message: z.literal("request rejected"),
  }).strict(),
}).strict()

export const worldHostedRuntimeResponseSchema = z.union([
  z.object({ ok: z.literal(true), result: z.record(z.string(), z.unknown()).readonly() }).strict().readonly(),
  worldHostedRuntimeErrorSchema,
])
export const worldCatalogNotFoundResponseSchema = z.object({ error: z.literal("not_found") }).strict().readonly()

export type WorldCatalogSummary = Readonly<z.infer<typeof worldCatalogSummarySchema>>
export type WorldCatalogListResponse = Readonly<z.infer<typeof worldCatalogListResponseSchema>>
export type WorldCatalogDetailResponse = Readonly<z.infer<typeof worldCatalogDetailResponseSchema>>
export type WorldDeliveryGrant = Readonly<z.infer<typeof worldDeliveryGrantSchema>>
export type WorldHostedRuntimeResponse = Readonly<z.infer<typeof worldHostedRuntimeResponseSchema>>
export type WorldDeliveryScope = z.infer<typeof worldDeliveryScopeSchema>
export type WorldHostedCreateBody = Readonly<z.infer<typeof worldHostedCreateBodySchema>>
export type WorldEndpoint = "catalog" | "world" | "issue_entitlement" | "redeem_download" | "hosted_create" | "hosted_status"
export type WorldResponse = WorldCatalogListResponse | WorldCatalogDetailResponse | WorldDeliveryGrant | WorldHostedRuntimeResponse | Readonly<{ error: "not_found" }>

export class WorldContractError extends Error {
  readonly name = "WorldContractError"
  constructor() { super("invalid_response") }
}

const parseJson = (bytes: Uint8Array): unknown => {
  if (bytes.byteLength > worldContractPolicy.maxResponseBytes) throw new WorldContractError()
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch {
    throw new WorldContractError()
  }
}

const parseEmptyDeliveryError = (status: number, bytes: Uint8Array): Readonly<{ error: "not_found" }> => {
  if (bytes.byteLength !== 0 || ![400, 401, 404, 409, 410, 422].includes(status)) {
    throw new WorldContractError()
  }
  return { error: "not_found" }
}

const parseHostedError = (status: number, bytes: Uint8Array): WorldResponse => {
  if ([401, 410, 422].includes(status)) return parseEmptyDeliveryError(status, bytes)
  const parsed = worldHostedRuntimeErrorSchema.safeParse(parseJson(bytes))
  if (!parsed.success || ![400, 404, 409, 429, 500].includes(status)) throw new WorldContractError()
  const codes = status === 400 ? ["invalid_request", "runtime_rejected"] : status === 404 ? ["not_found"] : status === 409
    ? ["idempotency_conflict", "stale_revision", "operation_outcome_unknown"] : status === 429 ? ["quota_exceeded"] : ["response_too_large"]
  if (!codes.includes(parsed.data.error.code)) throw new WorldContractError()
  return parsed.data
}

export const parseWorldResponse = (endpoint: WorldEndpoint, status: number, bytes: Uint8Array): WorldResponse => {
  if (endpoint === "catalog" && status === 200) {
    const parsed = worldCatalogListResponseSchema.safeParse(parseJson(bytes))
    if (parsed.success) return parsed.data
    throw new WorldContractError()
  }
  if (endpoint === "world") {
    if (status === 404) {
      const parsed = worldCatalogNotFoundResponseSchema.safeParse(parseJson(bytes))
      if (parsed.success) return parsed.data
      throw new WorldContractError()
    }
    if (status === 200) {
      const parsed = worldCatalogDetailResponseSchema.safeParse(parseJson(bytes))
      if (parsed.success) return parsed.data
    }
    throw new WorldContractError()
  }
  if (endpoint === "issue_entitlement" || endpoint === "redeem_download") {
    if (status !== 200) return parseEmptyDeliveryError(status, bytes)
    const parsed = worldDeliveryGrantSchema.safeParse(parseJson(bytes))
    if (parsed.success) return parsed.data
    throw new WorldContractError()
  }
  if (status === 200) {
    const parsed = worldHostedRuntimeResponseSchema.safeParse(parseJson(bytes))
    if (parsed.success && parsed.data.ok) return parsed.data
    throw new WorldContractError()
  }
  return parseHostedError(status, bytes)
}
