const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stages = new Set(["not_listed", "listed", "sold", "cleared", "paid", "withdrawn"]);
const exceptions = new Set([null, "clearance_failed", "refunded", "charged_back"]);
const eventTypes = new Set(["sale", "clearance", "payout", "withdrawal", "relisting", "clearance_failed", "refund", "chargeback"]);
const intervals = new Set(["day", "week", "month"]);

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
const timestamp = (value, label) => {
  text(value, label);
  if (!Number.isFinite(Date.parse(value))) fail(`Invalid ${label}`);
};
const date = (value, label) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))) fail(`Invalid ${label}`);
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
    keys(session, ["sessionId", "datasetId", "listedAt", "askCredits", "earnedCredits", "soldAt", "saleStatus"], "session");
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
  }
  return value;
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
