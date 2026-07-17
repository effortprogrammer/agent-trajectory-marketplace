const originalEnvironment = {
  HTMLElement: globalThis.HTMLElement,
  document: globalThis.document,
  fetch: globalThis.fetch,
  localStorage: globalThis.localStorage,
  URL: globalThis.URL,
  window: globalThis.window,
}

class FakeNode {
  children = []
  textContent = ""

  append(...children) {
    this.children.push(...children)
  }

  replaceChildren(...children) {
    this.children = [...children]
    this.textContent = ""
  }
}

class FakeText extends FakeNode {
  constructor(value) {
    super()
    this.textContent = value
  }
}

class FakeStyle {
  values = new Map()

  setProperty(name, value) {
    this.values.set(name, value)
  }
}

class FakeElement extends FakeNode {
  attributes = new Map()
  className = ""
  hidden = false
  id = ""
  style = new FakeStyle()
  type = ""
  value = ""
  listeners = new Map()

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  click() {
    this.dispatchEvent("click", { preventDefault() {} })
  }

  dispatchEvent(type, event) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }

  removeAttribute(name) {
    this.attributes.delete(name)
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
  }
}

class FakeDocument {
  elements = new Map()

  constructor(ids) {
    for (const id of ids) {
      const element = new FakeElement()
      element.id = id
      this.elements.set(`#${id}`, element)
    }
  }

  createElement() {
    return new FakeElement()
  }

  createTextNode(value) {
    return new FakeText(String(value))
  }

  querySelector(selector) {
    return this.elements.get(selector) ?? null
  }
}

class FakeStorage {
  values = new Map()

  getItem(key) {
    return this.values.get(key) ?? null
  }

  removeItem(key) {
    this.values.delete(key)
  }

  setItem(key, value) {
    this.values.set(key, value)
  }
}

const requiredIds = `
  account-auth-backdrop account-auth-close account-auth-dialog account-auth-note account-auth-open
  account-auth-submit account-change-email account-code account-code-form account-code-submit
  account-email account-form account-logout account-note account-resend
  admin-nav device-approval-form device-approve device-deny device-user-code
  my-data-access-tab my-data-downloads-tab my-data-access-content my-data-downloads-content
  buyer-onboarding-form buyer-onboarding-contact buyer-onboarding-use detail-panel-content
  catalog-view record-view record-back record-breadcrumb-title
  listing-grid nav-marketplace nav-my-data nav-operator nav-requests nav-seller-publish
  open-requests-view refresh-listings registry-state operator-actions-content
  requests-actions-content requests-view-content listing-search seller-actions-content seller-onboarding-form
  seller-onboarding-contact seller-onboarding-id seller-onboarding-use signal-access
  signal-events signal-files signal-listings summary-strip view-marketplace
  view-my-data view-operator view-requests view-seller
`
  .trim()
  .split(/\s+/)

export const wantedRecord = {
  wantedId: "wanted-1111111111111111",
  state: "wanted",
  title: "Multi-repo refactor sessions wanted",
  description: "Demand signal for refactor trajectories with source-attested test outcomes.",
  domain: "software-engineering",
  harness: "claude-code",
  desiredEventCount: 40000,
  budgetDisplay: "Indicative budget: non-binding",
  requesterLabel: "buyer-f7c46663",
  interestCount: 2,
  createdAt: "2026-07-05T00:00:00.000Z",
  updatedAt: "2026-07-05T00:00:00.000Z",
}

const proofBody = () => ({
  sample: {
    summary: "Median session: 62 events, 11 tool calls, 3 verification runs.",
    eventCount: 29760,
    eventKinds: ["task", "tool_call", "verification"],
    events: [
      { kind: "task", name: "refactor-session-start" },
      { kind: "tool_call", name: "edit_file src/auth/session.ts" },
      { kind: "tool_call", name: "run_tests auth" },
      { kind: "verification", name: "test-suite-green" },
    ],
  },
  quality: "Every session ends in a verified green test suite.",
  safety: "Redaction scanner reports 0 findings.",
  provenance: "Self-generated agent logs from our own harness runs.",
  terms: "Evaluation allowed; resale prohibited.",
  hashes: [
    { label: "sessions-index", sha256: "5".repeat(64) },
    { label: "trace-bundle-01", sha256: "a".repeat(64) },
  ],
})

export const evidenceBody = (overrides = {}) => ({
  availability: "partial",
  normalizerVersion: "atf-observation-v1",
  metricSetVersion: "trajectory-metrics-v1",
  summary: {
    artifactCount: 480,
    observationCount: 29760,
    atfVersionCounts: { v1: 0, v2: 480 },
  },
  metrics: {
    eventCount: { status: "available", count: 29760 },
    eventKindDistribution: {
      status: "available",
      distribution: [
        { eventClass: "step", count: 12480 },
        { eventClass: "llm", count: 4560 },
        { eventClass: "tool_call", count: 5280 },
        { eventClass: "tool_result", count: 5160 },
        { eventClass: "verification", count: 2280 },
      ],
    },
    toolCallCount: { status: "available", count: 5280 },
    matchedToolResultCount: { status: "available", count: 5160 },
    unmatchedToolResultCount: { status: "available", count: 120 },
    toolErrorCount: { status: "partial", count: 42 },
    maximumFunctionDepth: { status: "unavailable" },
    verificationLabelCount: { status: "available", count: 2280 },
    verificationPassedCount: { status: "partial", count: 2160 },
    verificationFailedCount: { status: "partial", count: 120 },
  },
  claims: {
    integrity: { authority: "marketplace_authoritative", status: "satisfied" },
    provenance: { authority: "marketplace_authoritative", status: "satisfied" },
    verificationLabel: { authority: "source_attested", status: "attested" },
    verificationPassed: { authority: "adapter_or_seller_attested", status: "partial" },
  },
  redaction: { authority: "marketplace_authoritative", status: "satisfied" },
  commitment: "sha256:0123456789abcdef",
  ...overrides,
})

export const candidateRecord = {
  supplyId: "supply-2222222222222222",
  state: "candidate",
  sellerLabel: "agent-local",
  title: "480 refactor trajectories",
  description: "Proven-but-unbound supply claim with bounded proof.",
  proof: proofBody(),
  evidence: evidenceBody(),
  indicativeTerms: {
    priceDisplay: "Indicative: request quote",
    licenseName: "Closed Alpha Evaluation",
  },
  interestCount: 1,
  createdAt: "2026-07-05T00:00:00.000Z",
  updatedAt: "2026-07-05T00:00:00.000Z",
}

export const commitmentTerms = () => ({
  reservePrice: { amountMinorUnits: 450000, currency: "USD", display: "$4,500 reserve" },
  deliverySlaHours: 168,
  proofProfile: {
    description: "Delivered bundle must match the candidate proof profile.",
    mustMatchProofHashes: true,
    expectedEventCount: 29760,
  },
  failureConsequences: ["commitment_strike", "listing_suspension"],
})

export const committedRecord = {
  supplyId: "supply-3333333333333333",
  state: "committed",
  sellerLabel: "agent-local",
  title: "Committed refactor trajectory bundle",
  description: "Committed supply with binding reserve, SLA, and consequences.",
  proof: proofBody(),
  evidence: evidenceBody(),
  interestCount: 3,
  commitmentId: "commitment-3333333333333333",
  terms: commitmentTerms(),
  committedAt: "2026-07-06T00:00:00.000Z",
  createdAt: "2026-07-05T00:00:00.000Z",
  updatedAt: "2026-07-06T00:00:00.000Z",
}

export const disputedRecord = {
  supplyId: "supply-4444444444444444",
  state: "disputed",
  sellerLabel: "agent-local",
  title: "Disputed delivery bundle",
  proof: proofBody(),
  evidence: evidenceBody(),
  interestCount: 0,
  commitmentId: "commitment-4444444444444444",
  terms: commitmentTerms(),
  committedAt: "2026-07-06T00:00:00.000Z",
  stateReason: "validation mismatch: delivered event count below the committed profile",
  createdAt: "2026-07-05T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
}

export const auctionBody = (overrides = {}) => ({
  commitmentId: committedRecord.commitmentId,
  supplyId: committedRecord.supplyId,
  state: "open",
  deadline: "2026-08-01T00:00:00.000Z",
  reserveMet: false,
  bidCount: 1,
  highestBid: {
    bidId: "bid-1111111111111111",
    commitmentId: committedRecord.commitmentId,
    amountMinorUnits: 400000,
    currency: "USD",
    bidderPseudonym: "bidder-0a1b2c3d",
    placedAt: "2026-07-06T12:00:00.000Z",
  },
  ...overrides,
})

export const supplyListBody = (overrides = {}) => ({
  ok: true,
  supply: [candidateRecord, committedRecord],
  wanted: [wantedRecord],
  ...overrides,
})

export const jsonResponse = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  })

export const elementText = (node) =>
  [node.textContent, ...node.children.map((child) => elementText(child))].join("")

export const elementsByClass = (node, className) => {
  const direct =
    node instanceof FakeElement && node.className.split(" ").includes(className) ? [node] : []
  return direct.concat(node.children.flatMap((child) => elementsByClass(child, className)))
}

export const waitFor = async (predicate) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error("condition was not met")
}

const signedOutAuthBody = () => ({
  ok: true,
  account: null,
  access: { approved: false, roles: [], entitlements: [] },
})

// The app re-reads /v1/auth/me after login (the login response predates the
// session cookie), so the default mock keeps one session's auth body here.
let currentAuthBody = signedOutAuthBody()

export const setMockedAuthSession = (body) => {
  currentAuthBody = body
}

const signedInAuthBody = () => ({
  ok: true,
  account: {
    accountId: "account-1111111111111111",
    email: "buyer@example.test",
    displayName: "Buyer Example",
  },
  access: { approved: false, roles: [], entitlements: [] },
})

export const operatorAuthBody = () => ({
  ok: true,
  account: {
    accountId: "account-operator-1111111111",
    email: "operator@example.test",
    displayName: "Operator Example",
  },
  access: { approved: true, roles: ["operator"], entitlements: [] },
})

export const defaultMarketplaceFetch = async (input, _init) => {
  const path = String(input)
  if (path === "/ready") {
    return new Response("", { status: 200 })
  }
  if (path === "/v1/auth/me") {
    return jsonResponse(currentAuthBody)
  }
  if (path === "/v1/auth/signup") {
    return jsonResponse({ ok: true, state: "code_sent" }, 202)
  }
  if (path === "/v1/auth/login") {
    currentAuthBody = signedInAuthBody()
    return jsonResponse(currentAuthBody, 200, { "x-atm-csrf": "csrf-test" })
  }
  if (path === "/v1/auth/logout") {
    currentAuthBody = signedOutAuthBody()
    return jsonResponse(currentAuthBody)
  }
  if (path === "/v1/auth/device/approve") {
    return jsonResponse({ ok: true, state: "approved" })
  }
  if (path === "/v1/supply") {
    return jsonResponse(supplyListBody())
  }
  if (path === "/v1/supply/fulfillments") {
    return jsonResponse({ ok: true, fulfillments: [] })
  }
  if (path === `/v1/supply/${wantedRecord.wantedId}`) {
    return jsonResponse({ ok: true, wanted: wantedRecord })
  }
  if (path === `/v1/supply/${candidateRecord.supplyId}`) {
    return jsonResponse({ ok: true, supply: candidateRecord })
  }
  if (path === `/v1/supply/${committedRecord.supplyId}`) {
    return jsonResponse({ ok: true, supply: committedRecord })
  }
  if (path === `/v1/supply/${disputedRecord.supplyId}`) {
    return jsonResponse({ ok: true, supply: disputedRecord })
  }
  if (path === `/v1/supply/commitments/${committedRecord.commitmentId}/auction`) {
    return jsonResponse({ ok: true, auction: auctionBody() })
  }
  return jsonResponse(
    {
      ok: false,
      error: {
        code: "not_found",
        message: `not_found: unsupported route ${path}`,
        requestId: "req-test",
      },
    },
    404,
  )
}

export const installMarketplaceHarness = (fetchHandler = defaultMarketplaceFetch) => {
  currentAuthBody = signedOutAuthBody()
  const document = new FakeDocument(requiredIds)
  const objectUrls = []
  const storage = new FakeStorage()
  const window = { localStorage: storage }
  const url = Object.create(globalThis.URL ?? {})
  url.createObjectURL = (blob) => {
    objectUrls.push(blob)
    return `blob:marketplace-test-${objectUrls.length}`
  }
  url.revokeObjectURL = () => {}
  globalThis.HTMLElement = FakeElement
  globalThis.document = document
  globalThis.window = window
  globalThis.localStorage = storage
  globalThis.fetch = fetchHandler
  globalThis.URL = url
  return { document, objectUrls }
}

export const restoreMarketplaceHarness = () => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      delete globalThis[key]
      continue
    }
    globalThis[key] = value
  }
}
