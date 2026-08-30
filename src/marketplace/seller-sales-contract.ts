import { z } from "zod";

const maximumSafeInteger = Number.MAX_SAFE_INTEGER;
const cursorSchema = z.string().min(1).max(1024).regex(
  /^(?:[A-Za-z0-9_-]+={0,2}|[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/,
).brand("SellerCursor");
const creditsSchema = z.number().int().nonnegative().max(maximumSafeInteger);
const signedCreditsSchema = z.number().int().min(-maximumSafeInteger).max(maximumSafeInteger);
const dateSchema = z.string().date();
const timestampSchema = z.string().datetime({ offset: true });
const uuidSchema = z.string().uuid();

const pageSchema = z.object({ nextCursor: cursorSchema.nullable() }).strict();
const sellerSessionSchema = z.object({
  askCredits: creditsSchema.nullable(),
  datasetId: z.string().min(1),
  earnedCredits: creditsSchema.nullable(),
  listedAt: timestampSchema.nullable(),
  saleStatus: z.object({
    changedAt: timestampSchema,
    exception: z.enum(["clearance_failed", "refunded", "charged_back"]).nullable(),
    listingCycleId: uuidSchema.nullable(),
    stage: z.enum(["not_listed", "listed", "sold", "cleared", "paid", "withdrawn"]),
  }).strict(),
  sessionId: uuidSchema,
  soldAt: timestampSchema.nullable(),
}).strict();
const candidateSchema = z.object({
  archiveByteCount: z.number().int().positive().max(maximumSafeInteger),
  archiveSha256: z.string().regex(/^[0-9a-f]{64}$/),
  artifactCount: z.number().int().positive().max(maximumSafeInteger),
  bundleId: z.string().regex(/^bundle-[0-9a-f]{64}$/),
  manifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
  protocolVersion: z.literal(1),
}).strict();

export const sellerCandidatesResponseSchema = z.object({
  nextCursor: cursorSchema.nullable(),
  protocolVersion: z.literal(1),
  rows: z.array(z.object({
    candidate: candidateSchema,
    protocolVersion: z.literal(1),
    status: z.enum(["accepted", "processing", "completed", "rejected"]),
    submissionId: z.string().regex(/^sub_[0-9a-hjkmnp-tv-z]{26}$/),
  }).strict()),
}).strict();
export const sellerSessionsResponseSchema = z.object({
  asOf: timestampSchema,
  ok: z.literal(true),
  page: pageSchema,
  sessions: z.array(sellerSessionSchema),
}).strict();
export const sellerEarningsResponseSchema = z.object({
  asOf: timestampSchema,
  currency: z.literal("USD"),
  interval: z.enum(["day", "week", "month"]),
  ok: z.literal(true),
  openingCumulativeCredits: creditsSchema,
  points: z.array(z.object({
    cumulativeNetCredits: signedCreditsSchema,
    periodStart: timestampSchema,
  }).strict()),
  window: z.object({ from: dateSchema, to: dateSchema }).strict(),
}).strict();
export const sellerLedgerResponseSchema = z.object({
  asOf: timestampSchema,
  events: z.array(z.object({
    amountCredits: creditsSchema.nullable(),
    eventId: uuidSchema,
    occurredAt: timestampSchema,
    relatedSessionCount: creditsSchema.nullable(),
    sessionId: uuidSchema.nullable(),
    type: z.enum(["sale", "clearance", "payout", "withdrawal", "relisting", "clearance_failed", "refund", "chargeback"]),
  }).strict()),
  ok: z.literal(true),
  page: pageSchema,
}).strict();

export class SellerSalesContractError extends Error {
  readonly name = "SellerSalesContractError";

  constructor() {
    super("invalid_response");
  }
}

export type SellerCursor = z.infer<typeof cursorSchema>;
export type SellerCandidatesResponse = z.infer<typeof sellerCandidatesResponseSchema>;
export type SellerSessionsResponse = z.infer<typeof sellerSessionsResponseSchema>;
export type SellerEarningsResponse = z.infer<typeof sellerEarningsResponseSchema>;
export type SellerLedgerResponse = z.infer<typeof sellerLedgerResponseSchema>;
export type SellerResponse = SellerCandidatesResponse | SellerSessionsResponse | SellerEarningsResponse | SellerLedgerResponse;
export type SellerSalesResource = "candidates" | "sales-sessions" | "sales-earnings" | "sales-ledger";

export type SellerOptions = Readonly<{
  readonly cursor?: z.infer<typeof cursorSchema>;
  readonly from?: string;
  readonly interval?: "day" | "week" | "month";
  readonly limit?: number;
  readonly status?: "not_listed" | "listed" | "sold" | "cleared" | "paid" | "withdrawn";
  readonly to?: string;
  readonly type?: "sale" | "clearance" | "payout" | "withdrawal" | "relisting" | "clearance_failed" | "refund" | "chargeback";
}>;

const optionSchemas = {
  candidates: z.object({ cursor: cursorSchema.optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).strict(),
  "sales-sessions": z.object({
    cursor: cursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    status: z.enum(["not_listed", "listed", "sold", "cleared", "paid", "withdrawn"]).optional(),
  }).strict(),
  "sales-earnings": z.object({
    from: dateSchema.optional(),
    interval: z.enum(["day", "week", "month"]).optional(),
    to: dateSchema.optional(),
  }).strict().refine(
    (options) => Object.keys(options).length === 0
      || (options.from !== undefined && options.interval !== undefined && options.to !== undefined),
  ),
  "sales-ledger": z.object({
    cursor: cursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    type: z.enum(["sale", "clearance", "payout", "withdrawal", "relisting", "clearance_failed", "refund", "chargeback"]).optional(),
  }).strict(),
} as const;

const validWindow = (options: SellerOptions): boolean =>
  options.from === undefined || options.to === undefined || options.from <= options.to;

export const parseSellerOptions = (resource: SellerSalesResource, argumentsList: readonly string[]): SellerOptions | undefined => {
  if (argumentsList.length % 2 !== 0) return undefined;
  const values: Record<string, string> = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (flag === undefined || value === undefined || !flag.startsWith("--") || value.startsWith("--")) return undefined;
    const key = flag.slice(2);
    if (key in values) return undefined;
    values[key] = value;
  }
  const parsed = optionSchemas[resource].safeParse(values);
  return parsed.success && validWindow(parsed.data) ? parsed.data : undefined;
};

const parseStrict = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new SellerSalesContractError();
  return parsed.data;
};

export const parseSellerCandidatesResponse = (value: unknown): SellerCandidatesResponse =>
  parseStrict(sellerCandidatesResponseSchema, value);
export const parseSellerSessionsResponse = (value: unknown): SellerSessionsResponse =>
  parseStrict(sellerSessionsResponseSchema, value);
export const parseSellerEarningsResponse = (value: unknown): SellerEarningsResponse =>
  parseStrict(sellerEarningsResponseSchema, value);
export const parseSellerLedgerResponse = (value: unknown): SellerLedgerResponse =>
  parseStrict(sellerLedgerResponseSchema, value);

export const parseSellerResponse = (resource: SellerSalesResource, value: unknown): SellerResponse => {
  switch (resource) {
    case "candidates":
      return parseSellerCandidatesResponse(value);
    case "sales-sessions":
      return parseSellerSessionsResponse(value);
    case "sales-earnings":
      return parseSellerEarningsResponse(value);
    case "sales-ledger":
      return parseSellerLedgerResponse(value);
  }
};
