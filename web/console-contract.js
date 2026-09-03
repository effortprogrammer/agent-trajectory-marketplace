const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stages = new Set(["not_listed", "listed", "sold", "cleared", "paid", "withdrawn"]);
const exceptions = new Set([null, "clearance_failed", "refunded", "charged_back"]);
const eventTypes = new Set(["sale", "clearance", "payout", "withdrawal", "relisting", "clearance_failed", "refund", "chargeback"]);
const intervals = new Set(["day", "week", "month"]);
const payoutStatuses = new Set(["requested", "pending", "approved", "processing", "cancelled", "rejected", "paid"]);
const pricingStatuses = new Set(["pending", "verified"]);
const payoutUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sessionFields = [
  "acceptedTokens",
  "accruedCents",
  "askCredits",
  "datasetId",
  "earnedCredits",
  "listedAt",
  "model",
  "modelTokenPricing",
  "rateCentsPerMillion",
  "saleStatus",
  "sessionId",
  "soldAt",
];
const legacySessionFields = [
  "askCredits",
  "datasetId",
  "earnedCredits",
  "listedAt",
  "saleStatus",
  "sessionId",
  "soldAt",
];
const utcTimestamp = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;
const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/;

export class SellerSalesContractError extends TypeError {}

const fail = (message) => { throw new SellerSalesContractError(message); };
const object = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`Invalid ${label}`);
  return value;
};
const keys = (value, expected, label) => {
  const actual = Object.keys(object(value, label)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail(`Invalid ${label}`);
};
const text = (value, label) => {
  if (typeof value !== "string" || value.length === 0) fail(`Invalid ${label}`);
};
const validUtcComponents = (year, month, day, hour = 0, minute = 0, second = 0) => {
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return Number.isFinite(parsed.getTime())
    && parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
    && parsed.getUTCHours() === hour
    && parsed.getUTCMinutes() === minute
    && parsed.getUTCSeconds() === second;
};
const timestamp = (value, label) => {
  text(value, label);
  const components = utcTimestamp.exec(value);
  if (components === null || !Number.isFinite(Date.parse(value)) || !validUtcComponents(...components.slice(1).map(Number))) fail(`Invalid ${label}`);
};
const date = (value, label) => {
  if (typeof value !== "string") fail(`Invalid ${label}`);
  const components = isoDate.exec(value);
  if (components === null || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || !validUtcComponents(...components.slice(1).map(Number))) fail(`Invalid ${label}`);
};
const identifier = (value, label) => {
  if (typeof value !== "string" || !uuid.test(value)) fail(`Invalid ${label}`);
};
const nullable = (value, validator, label) => {
  if (value !== null) validator(value, label);
};
const credits = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) fail(`Invalid ${label}`);
};
const page = (value) => {
  keys(value, ["nextCursor"], "page");
  nullable(value.nextCursor, text, "nextCursor");
};

export const parseSessionsResponse = (value) => {
  keys(value, ["ok", "asOf", "sessions", "page"], "sessions response");
  if (value.ok !== true || !Array.isArray(value.sessions)) fail("Invalid sessions response");
  timestamp(value.asOf, "asOf");
  page(value.page);
  for (const session of value.sessions) {
    keys(session, sessionFields, "session");
    identifier(session.sessionId, "sessionId");
    text(session.datasetId, "datasetId");
    nullable(session.listedAt, timestamp, "listedAt");
    nullable(session.askCredits, credits, "askCredits");
    nullable(session.earnedCredits, credits, "earnedCredits");
    nullable(session.soldAt, timestamp, "soldAt");
    const pricing = [session.model, session.acceptedTokens, session.rateCentsPerMillion, session.accruedCents];
    const nullCount = pricing.filter((field) => field === null).length;
    if (nullCount !== 0 && nullCount !== pricing.length) fail("Invalid model-token pricing");
    nullable(session.model, text, "model");
    nullable(session.acceptedTokens, credits, "acceptedTokens");
    nullable(session.rateCentsPerMillion, credits, "rateCentsPerMillion");
    nullable(session.accruedCents, credits, "accruedCents");
    if (!Array.isArray(session.modelTokenPricing)) fail("Invalid model-token pricing");
    for (const detail of session.modelTokenPricing) {
      keys(detail, ["acceptedTokens", "accruedCents", "model", "rateCentsPerMillion", "status"], "model-token pricing");
      text(detail.model, "modelTokenPricing.model");
      if (detail.model.length > 256) fail("Invalid modelTokenPricing.model");
      credits(detail.acceptedTokens, "modelTokenPricing.acceptedTokens");
      credits(detail.rateCentsPerMillion, "modelTokenPricing.rateCentsPerMillion");
      credits(detail.accruedCents, "modelTokenPricing.accruedCents");
      if (!pricingStatuses.has(detail.status)) fail("Invalid modelTokenPricing.status");
    }
    if (session.modelTokenPricing.length === 1) {
      const [detail] = session.modelTokenPricing;
      if (detail === undefined
        || session.model !== detail.model
        || session.acceptedTokens !== detail.acceptedTokens
        || session.rateCentsPerMillion !== detail.rateCentsPerMillion
        || session.accruedCents !== detail.accruedCents) fail("Invalid model-token pricing summary");
    } else if (nullCount !== pricing.length) fail("Invalid model-token pricing summary");
    keys(session.saleStatus, ["listingCycleId", "stage", "exception", "changedAt"], "saleStatus");
    nullable(session.saleStatus.listingCycleId, identifier, "listingCycleId");
    if (!stages.has(session.saleStatus.stage) || !exceptions.has(session.saleStatus.exception)) fail("Invalid saleStatus");
    timestamp(session.saleStatus.changedAt, "changedAt");
  }
  return value;
};

export const parseLegacySessionsResponse = (value) => {
  keys(value, ["ok", "asOf", "sessions", "page"], "legacy sessions response");
  if (value.ok !== true || !Array.isArray(value.sessions)) fail("Invalid legacy sessions response");
  timestamp(value.asOf, "asOf");
  page(value.page);
  const sessions = value.sessions.map((session) => {
    keys(session, legacySessionFields, "legacy session");
    identifier(session.sessionId, "sessionId");
    text(session.datasetId, "datasetId");
    nullable(session.listedAt, timestamp, "listedAt");
    nullable(session.askCredits, credits, "askCredits");
    nullable(session.earnedCredits, credits, "earnedCredits");
    nullable(session.soldAt, timestamp, "soldAt");
    keys(session.saleStatus, ["listingCycleId", "stage", "exception", "changedAt"], "saleStatus");
    nullable(session.saleStatus.listingCycleId, identifier, "listingCycleId");
    if (!stages.has(session.saleStatus.stage) || !exceptions.has(session.saleStatus.exception)) fail("Invalid saleStatus");
    timestamp(session.saleStatus.changedAt, "changedAt");
    return {
      ...session,
      acceptedTokens: null,
      accruedCents: null,
      model: null,
      modelTokenPricing: [],
      rateCentsPerMillion: null,
    };
  });
  return { ...value, sessions };
};

export const parseEarningsResponse = (value) => {
  keys(value, ["ok", "asOf", "currency", "interval", "window", "openingCumulativeCredits", "points"], "earnings response");
  if (value.ok !== true || value.currency !== "USD" || !intervals.has(value.interval) || !Array.isArray(value.points)) fail("Invalid earnings response");
  timestamp(value.asOf, "asOf");
  credits(value.openingCumulativeCredits, "openingCumulativeCredits");
  keys(value.window, ["from", "to"], "window");
  date(value.window.from, "window.from");
  date(value.window.to, "window.to");
  for (const point of value.points) {
    keys(point, ["periodStart", "cumulativeNetCredits"], "earnings point");
    timestamp(point.periodStart, "periodStart");
    credits(point.cumulativeNetCredits, "cumulativeNetCredits");
  }
  return value;
};

export const parseLedgerResponse = (value) => {
  keys(value, ["ok", "asOf", "events", "page"], "ledger response");
  if (value.ok !== true || !Array.isArray(value.events)) fail("Invalid ledger response");
  timestamp(value.asOf, "asOf");
  page(value.page);
  for (const event of value.events) {
    keys(event, ["eventId", "type", "occurredAt", "sessionId", "amountCredits", "relatedSessionCount"], "ledger event");
    identifier(event.eventId, "eventId");
    if (!eventTypes.has(event.type)) fail("Invalid ledger event type");
    timestamp(event.occurredAt, "occurredAt");
    nullable(event.sessionId, identifier, "sessionId");
    nullable(event.amountCredits, credits, "amountCredits");
    if (event.relatedSessionCount !== null && (!Number.isSafeInteger(event.relatedSessionCount) || event.relatedSessionCount < 0)) fail("Invalid relatedSessionCount");
  }
  return value;
};

export const parsePayoutResponse = (value) => {
  keys(value, ["ok", "payoutRequest"], "payout response");
  if (value.ok !== true) fail("Invalid payout response");
  const payout = value.payoutRequest;
  keys(payout, ["availableMinor", "currency", "heldMinor", "request", "thresholdMinor"], "payout request summary");
  if (payout.currency !== "USD" || payout.thresholdMinor !== 10_000) fail("Invalid payout request summary");
  credits(payout.availableMinor, "availableMinor");
  credits(payout.heldMinor, "heldMinor");
  if (payout.request === null) return value;

  const request = payout.request;
  keys(request, [
    "amountMinor",
    "approvedAt",
    "externalReference",
    "paidAt",
    "rejectedReason",
    "requestId",
    "requestedAt",
    "status",
  ], "payout request");
  if (typeof request.requestId !== "string" || !payoutUuid.test(request.requestId)) fail("Invalid requestId");
  credits(request.amountMinor, "amountMinor");
  if (!payoutStatuses.has(request.status)) fail("Invalid payout status");
  timestamp(request.requestedAt, "requestedAt");
  nullable(request.approvedAt, timestamp, "approvedAt");
  nullable(request.rejectedReason, text, "rejectedReason");
  nullable(request.paidAt, timestamp, "paidAt");
  nullable(request.externalReference, text, "externalReference");
  const approved = request.status === "approved" || request.status === "processing" || request.status === "paid";
  if (approved !== (request.approvedAt !== null)) fail("Invalid approvedAt");
  if ((request.status === "rejected") !== (request.rejectedReason !== null)) fail("Invalid rejectedReason");
  if ((request.status === "paid") !== (request.paidAt !== null)) fail("Invalid paidAt");
  if ((request.status === "paid") !== (request.externalReference !== null)) fail("Invalid externalReference");
  return value;
};

export const parseWeeklyLimitsResponse = (value) => {
  keys(value, ["ok", "weeklyLimits"], "weekly limits response");
  if (value.ok !== true) fail("Invalid weekly limits response");
  const limits = value.weeklyLimits;
  keys(limits, [
    "currency",
    "limitMinor",
    "payoutRemainingMinor",
    "sessionValueRemainingMinor",
    "windowSeconds",
  ], "weekly limits");
  if (
    limits.currency !== "USD"
    || limits.limitMinor !== 100_000
    || limits.windowSeconds !== 604_800
  ) {
    fail("Invalid weekly limits");
  }
  credits(limits.payoutRemainingMinor, "payoutRemainingMinor");
  credits(limits.sessionValueRemainingMinor, "sessionValueRemainingMinor");
  if (
    limits.payoutRemainingMinor > limits.limitMinor
    || limits.sessionValueRemainingMinor > limits.limitMinor
  ) {
    fail("Invalid weekly limit capacity");
  }
  return value;
};

export const formatPayoutAmount = (minor) => {
  credits(minor, "minor");
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
    style: "currency",
  }).format(minor / 100);
};
