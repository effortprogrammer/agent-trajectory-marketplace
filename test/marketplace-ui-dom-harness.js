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
  account-email account-form account-login account-logout account-note account-password admin-nav
  account-signup device-approval-form device-approve device-deny device-user-code
  my-data-access-tab my-data-downloads-tab my-data-access-content my-data-downloads-content
  buyer-onboarding-form buyer-onboarding-contact buyer-onboarding-use detail-panel-content
  listing-grid nav-marketplace nav-my-data nav-operator nav-requests nav-seller-publish
  open-requests-view refresh-listings registry-state operator-actions-content
  requests-actions-content requests-view-content listing-search seller-actions-content seller-onboarding-form
  seller-onboarding-contact seller-onboarding-id seller-onboarding-use signal-access
  signal-events signal-files signal-listings summary-strip view-marketplace
  view-my-data view-operator view-requests view-seller
`
  .trim()
  .split(/\s+/)

export const listing = {
  listingId: "listing-1111111111111111",
  packageId: "package-local",
  datasetId: "dataset-local",
  sellerId: "agent-local",
  title: "Closed Alpha Launch Trajectory",
  runtime: "codex",
  status: "ready",
  eventCount: 6,
  eventKinds: ["tool", "message"],
  traceSha256: "a".repeat(64),
  createdAt: "2026-07-05T00:00:00.000Z",
  metadata: {
    schemaVersion: 1,
    price: { mode: "request_access", display: "Request access" },
    license: { name: "Closed Alpha Evaluation", url: "https://example.test/license" },
    usageTerms: {
      allowed: ["evaluation", "benchmarking"],
      prohibited: ["resale", "model training without written approval"],
    },
    sellerProfile: {
      displayName: "Agent Local",
      supportUrl: "https://example.test/support",
    },
    sample: {
      summary: "Sanitized Hermes workflow sample",
      maxPreviewEvents: 3,
    },
    accessPolicy: "request_required",
  },
  accessState: {
    accessPolicy: "request_required",
    downloadAllowed: false,
  },
  commerceState: {
    provider: "manual",
    checkoutState: "disabled",
    purchaseState: "manual_review",
    entitlementState: "not_granted",
    receiptState: "unavailable",
    invoiceState: "unavailable",
    refundState: "unavailable",
  },
  files: [
    {
      fileName: "manifest.json",
      sha256: "b".repeat(64),
      urlPath: "/v1/listings/listing-1111111111111111/files/manifest.json",
    },
  ],
}

export const jsonResponse = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  })

export const detailBody = () => ({
  ok: true,
  listing,
  preview: {
    runtime: listing.runtime,
    status: listing.status,
    eventCount: listing.eventCount,
    eventKinds: listing.eventKinds,
    sample: listing.metadata.sample,
  },
  redactionReport: { redactionClean: true, redactedFindingCount: 0 },
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
    return jsonResponse(signedOutAuthBody())
  }
  if (path === "/v1/auth/signup" || path === "/v1/auth/login") {
    return jsonResponse(signedInAuthBody(), 200, { "x-atm-csrf": "csrf-test" })
  }
  if (path === "/v1/auth/logout") {
    return jsonResponse(signedOutAuthBody())
  }
  if (path === "/v1/auth/device/approve") {
    return jsonResponse({ ok: true, state: "approved" })
  }
  if (path === "/v1/listings") {
    return jsonResponse({ ok: true, listings: [listing] })
  }
  if (path === "/v1/listings/listing-1111111111111111") {
    return jsonResponse(detailBody())
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
