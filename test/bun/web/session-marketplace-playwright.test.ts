import { afterAll, afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import type { Page, Route } from "playwright"
import {
  closeSessionUiBrowser,
  startSessionUiHarness,
  type SessionUiHarness,
} from "./session-marketplace-playwright.fixture"

// allow: SIZE_OK - one serial browser contract shares Chromium to avoid CI contention.
setDefaultTimeout(30_000)

const desktop = { height: 900, width: 1_280 } as const
const mobile = { height: 844, width: 390 } as const
let harness: SessionUiHarness | undefined

const openMemberSignIn = async (page: Page): Promise<void> => {
  const gate = page.locator("[data-auth-gate]")
  if (await gate.isVisible()) {
    if (await page.locator("body").getAttribute("data-auth-state") === "login") return
    await page.getByTestId("auth-close-button").click()
    await gate.waitFor({ state: "hidden" })
  }
  const signIn = page.getByTestId("sign-in-button")
  if (!await signIn.isVisible()) {
    const menuToggle = page.locator("[data-nav-menu-toggle]")
    if (await menuToggle.isVisible()) await menuToggle.click()
    await signIn.waitFor({ state: "visible" })
  }
  await signIn.click()
}

const authenticate = async (page: Page): Promise<void> => {
  await openMemberSignIn(page)
  const challengeRequest = page.waitForRequest((request) =>
    new URL(request.url()).pathname === "/api/registry/v1/auth/login",
  )
  await page.locator("[data-auth-email]").fill("owner@example.test")
  await page.locator("[data-auth-request-submit]").click()
  const challenge = await challengeRequest
  expect(await challenge.postDataJSON()).toEqual({ email: "owner@example.test" })
  await page.locator("[data-auth-code]").waitFor({ state: "visible" })

  const verifyRequest = page.waitForRequest((request) =>
    new URL(request.url()).pathname === "/api/registry/v1/auth/verify",
  )
  const statsResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/registry/v1/marketplace/stats",
  )
  await page.locator("[data-auth-code]").fill("654321")
  await page.locator("[data-auth-verify-submit]").click()
  const verify = await verifyRequest
  expect(await verify.postDataJSON()).toEqual({ challengeId: "chal-0123456789abcdef", code: "654321" })
  await statsResponse
}

const payoutRequest = {
  amountMinor: 15_000,
  approvedAt: null,
  externalReference: null,
  paidAt: null,
  rejectedReason: null,
  requestId: "44444444-4444-4444-8444-444444444444",
  requestedAt: "2026-08-29T00:00:00Z",
  status: "requested",
}

const payoutSuccess = (
  request: unknown,
  availableMinor = 0,
  heldMinor = 15_000,
) => ({
  ok: true,
  payoutRequest: {
    availableMinor,
    currency: "USD",
    heldMinor,
    request,
    thresholdMinor: 10_000,
  },
})

const payoutError = (code: string, message: string) => ({
  error: { code, message },
  ok: false,
})

const pricingSessions = {
  asOf: "2026-08-31T00:00:00Z",
  ok: true,
  page: { nextCursor: null },
  sessions: [{
    acceptedTokens: null,
    accruedCents: null,
    askCredits: null,
    datasetId: "seller-dataset-mixed",
    earnedCredits: null,
    listedAt: "2026-08-31T00:00:00Z",
    model: null,
    modelTokenPricing: [{
      acceptedTokens: 1_000_000,
      accruedCents: 200,
      model: "claude-fable-5",
      rateCentsPerMillion: 200,
      status: "verified",
    }, {
      acceptedTokens: 2_000_000,
      accruedCents: 300,
      model: "gpt-5.6-sol",
      rateCentsPerMillion: 150,
      status: "pending",
    }],
    rateCentsPerMillion: null,
    saleStatus: {
      changedAt: "2026-08-31T00:00:00Z",
      exception: null,
      listingCycleId: "22222222-2222-4222-8222-222222222222",
      stage: "listed",
    },
    sessionId: "11111111-1111-4111-8111-111111111111",
    soldAt: null,
  }],
}

const openSellerConsole = async (page: Page): Promise<void> => {
  await page.getByTestId("seller-console-link").click()
  await page.locator("[data-console-sessions] li").first().waitFor()
}

const openPayoutDialog = async (page: Page): Promise<void> => {
  await page.locator("[data-payout-open]").click()
  await page.locator("[data-payout-dialog]").waitFor({ state: "visible" })
  await page.waitForFunction(
    "document.querySelector('[data-console-payout]')?.dataset.payoutState !== 'loading'",
  )
}

afterEach(async () => {
  if (harness !== undefined) await harness.close()
  harness = undefined
})

afterAll(async () => {
  await closeSessionUiBrowser()
})

describe("authenticated aggregate marketplace browser contract", () => {
  test("shows public token volume while withholding member aggregates", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })

    expect(await page.locator("#top").isVisible()).toBe(true)
    expect(await page.locator("[data-auth-gate]").isVisible()).toBe(false)
    expect(await page.locator("[data-supply-locked]").isVisible()).toBe(true)
    expect(await page.getByTestId("public-token-count").count()).toBe(1)
    expect(await page.getByTestId("public-token-count").innerText()).toBe("39,048,328")
    expect(await page.locator("[data-public-token-note]").isVisible()).toBe(true)
    expect(await page.getByTestId("public-token-count").evaluate((element) => {
      const view = element.ownerDocument.defaultView
      if (view === null) throw new Error("Public token value has no browser view")
      const lineHeight = Number.parseFloat(view.getComputedStyle(element).lineHeight)
      return Math.round(element.getBoundingClientRect().height / lineHeight)
    })).toBe(1)
    expect(await page.locator("[data-public-token-region]").getAttribute("aria-live")).toBe("polite")
    expect(await page.locator("[data-authenticated-content]:visible").count()).toBe(0)
    expect(await page.getByTestId("aggregate-status").isVisible()).toBe(false)
    expect(await page.locator("[data-session-count]:visible, [data-token-count]:visible").count()).toBe(0)
    expect(harness.registryRequests).toEqual([{
      authorization: null,
      body: undefined,
      method: "GET",
      path: "/v1/marketplace/public-stats",
    }])
  })

  test("renders exact large public token totals without horizontal overflow", async () => {
    harness = await startSessionUiHarness()
    harness.setPublicTokenTotal("9007199254740993")
    const page = await harness.newPage({ height: 844, width: 375 })

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })

    expect(await page.getByTestId("public-token-count").innerText()).toBe(
      "9,007,199,254,740,993",
    )
    expect(
      await page.locator("html").evaluate((element) =>
        element.scrollWidth <= element.clientWidth
      ),
    ).toBe(true)
  })

  test("hides the acceptance note when public token stats are unavailable", async () => {
    harness = await startSessionUiHarness()
    harness.setPublicTokenTotal("invalid")
    const page = await harness.newPage(mobile)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })

    expect(await page.getByTestId("public-token-count").innerText()).toBe(
      "Unavailable",
    )
    expect(
      await page.locator("[data-public-token-note]").isVisible(),
    ).toBe(false)
  })

  test("keeps seller sales requests and navigation unavailable to anonymous visitors", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })

    expect(await page.getByTestId("seller-console-link").isVisible()).toBe(false)
    expect(harness.registryRequests.filter((request) => request.path.includes("/seller/sales/"))).toEqual([])
  })

  test("renders the authenticated seller console with bearer-authorized sales data", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)
    const salesResponses = Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/sales/sessions")),
      page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/sales/earnings")),
    ])
    await page.getByTestId("seller-console-link").click()
    await salesResponses

    await page.locator("[data-console-chart] svg").waitFor({ state: "visible" })
    expect(await page.locator("[data-console-sessions] li").count()).toBeGreaterThan(0)
    expect(await page.locator("[data-console-ledger]").count()).toBe(0)
    expect(await page.locator("[data-console-seller]").count()).toBe(0)
    expect(await page.locator("[data-console-view]").innerText()).not.toContain(
      "acct-0123456789abcdef",
    )
    expect(await page.locator("[data-console-sessions] .seller-status-pill[data-stage=sold]").count()).toBe(1)
    expect(harness.registryRequests.filter((request) => request.path.includes("/seller/sales/"))).toEqual(expect.arrayContaining([
      expect.objectContaining({ authorization: "Bearer marketplace-browser-session-token", body: undefined, method: "GET", path: "/v2/marketplace/seller/sales/sessions" }),
    ]))
    expect(harness.registryRequests.filter((request) => request.path.endsWith("/sales/ledger"))).toEqual([])
  })

  test("shows both rolling limits without desktop or mobile overflow", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)
    await openSellerConsole(page)
    await page.locator('[data-weekly-limits][data-state="ready"]').waitFor()

    const observe = async (): Promise<{
      readonly overflowFree: boolean
      readonly payout: string
      readonly sessionValue: string
    }> => ({
      overflowFree: await page.locator("html").evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
      payout: await page.locator("[data-weekly-payout-remaining]").innerText(),
      sessionValue: await page.locator(
        "[data-weekly-session-value-remaining]",
      ).innerText(),
    })

    const desktopObservation = await observe()
    await page.setViewportSize({ height: 844, width: 375 })
    const mobileObservation = await observe()
    const mobileHeading = await page
      .locator("[data-weekly-limits] .seller-panel-heading")
      .evaluate((heading) => {
        const title = heading.children.item(0)
        const context = heading.children.item(1)
        const view = heading.ownerDocument.defaultView
        if (title === null || context === null || view === null) {
          throw new TypeError("weekly limit heading is incomplete")
        }
        const titleLineHeight = Number.parseFloat(
          view.getComputedStyle(title).lineHeight,
        )
        const contextLineHeight = Number.parseFloat(
          view.getComputedStyle(context).lineHeight,
        )
        return {
          contextLines: Math.round(
            context.getBoundingClientRect().height / contextLineHeight,
          ),
          direction: view.getComputedStyle(heading).flexDirection,
          titleLines: Math.round(
            title.getBoundingClientRect().height / titleLineHeight,
          ),
        }
      })

    expect([desktopObservation, mobileObservation]).toEqual([
      {
        overflowFree: true,
        payout: "$120.00 remaining",
        sessionValue: "$50.00 remaining",
      },
      {
        overflowFree: true,
        payout: "$120.00 remaining",
        sessionValue: "$50.00 remaining",
      },
    ])
    expect(harness.registryRequests).toContainEqual({
      authorization: "Bearer marketplace-browser-session-token",
      body: undefined,
      method: "GET",
      path: "/v1/marketplace/seller/weekly-limits",
    })
    expect(mobileHeading).toEqual({
      contextLines: 1,
      direction: "column",
      titleLines: 1,
    })
    expect(
      await page.locator(".seller-weekly-limit-context:visible").count(),
    ).toBe(2)
  })

  test("shows a bounded weekly-limit loading state before exact values arrive", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)
    const arrived = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    await page.route(
      "**/api/registry/v1/marketplace/seller/weekly-limits",
      async (route) => {
        arrived.resolve()
        await release.promise
        await route.continue()
      },
    )

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)
    await page.getByTestId("seller-console-link").click()
    await arrived.promise

    const panel = page.locator("[data-weekly-limits]")
    expect({
      ariaBusy: await panel.getAttribute("aria-busy"),
      skeletons: await panel.locator(
        ".seller-weekly-limit-skeleton:visible",
      ).count(),
      state: await panel.getAttribute("data-state"),
      values: await panel.locator(
        "[data-weekly-payout-remaining]:visible, "
        + "[data-weekly-session-value-remaining]:visible",
      ).count(),
      visible: await panel.isVisible(),
    }).toEqual({
      ariaBusy: "true",
      skeletons: 2,
      state: "loading",
      values: 0,
      visible: true,
    })

    release.resolve()
    await page.locator('[data-weekly-limits][data-state="ready"]').waitFor()
    expect({
      ariaBusy: await panel.getAttribute("aria-busy"),
      skeletons: await panel.locator(
        ".seller-weekly-limit-skeleton:visible",
      ).count(),
      values: await panel.locator(
        "[data-weekly-payout-remaining]:visible, "
        + "[data-weekly-session-value-remaining]:visible",
      ).count(),
    }).toEqual({
      ariaBusy: "false",
      skeletons: 0,
      values: 2,
    })
  })

  test("keeps seller sales visible when weekly limits are unavailable", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)
    await page.route(
      "**/api/registry/v1/marketplace/seller/weekly-limits",
      async (route) => {
        await route.fulfill({
          body: JSON.stringify({ error: { code: "unavailable" }, ok: false }),
          contentType: "application/json",
          status: 503,
        })
      },
    )

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)
    await openSellerConsole(page)

    const panel = page.locator(
      '[data-weekly-limits][data-state="unavailable"]',
    )
    await panel.waitFor({ state: "visible" })
    expect({
      ariaBusy: await panel.getAttribute("aria-busy"),
      chart: await page.locator("[data-console-chart] svg").count(),
      skeletons: await panel.locator(
        ".seller-weekly-limit-skeleton:visible",
      ).count(),
      values: await panel.locator(
        "[data-weekly-payout-remaining]:visible, "
        + "[data-weekly-session-value-remaining]:visible",
      ).count(),
    }).toEqual({
      ariaBusy: "false",
      chart: 1,
      skeletons: 0,
      values: 2,
    })
  })

  test("renders every accepted model-token pricing fact at desktop and mobile widths", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text())
    })
    page.on("pageerror", (error) => pageErrors.push(error.message))
    await page.route(
      "**/api/registry/v2/marketplace/seller/sales/sessions",
      async (route) => {
        await route.fulfill({
          body: JSON.stringify(pricingSessions),
          contentType: "application/json",
          status: 200,
        })
      },
    )
    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)
    const sessionsResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith(
        "/v2/marketplace/seller/sales/sessions",
      )
    )
    await page.getByTestId("seller-console-link").click()
    await sessionsResponse
    await page.locator(
      "[data-console-sessions] .seller-pricing-facts",
    ).first().waitFor()

    const expectedText = [
      "Claude Fable 5",
      "1.0M accepted tokens",
      "$2.00 / 1M",
      "$2.00 earned",
      "GPT-5.6 Sol",
      "2.0M accepted tokens",
      "$1.50 / 1M",
      "$3.00 pending review",
    ] as const
    const observations: Array<{
      readonly overflowFree: boolean
      readonly textCounts: readonly number[]
    }> = []
    for (const viewport of [desktop, mobile]) {
      await page.setViewportSize(viewport)
      observations.push({
        overflowFree: await page.locator("html").evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
        textCounts: await Promise.all(
          expectedText.map((text) =>
            page.getByText(text, { exact: true }).count()
          ),
        ),
      })
    }

    expect(observations).toEqual([
      { overflowFree: true, textCounts: expectedText.map(() => 1) },
      { overflowFree: true, textCounts: expectedText.map(() => 1) },
    ])
    expect(consoleErrors).toEqual([])
    expect(pageErrors).toEqual([])
  })

  test("falls back to frozen v1 sessions while Registry v2 rolls out", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)
    await page.route(
      "**/api/registry/v2/marketplace/seller/sales/sessions",
      async (route) => {
        await route.fulfill({
          body: JSON.stringify({
            error: { code: "not_found", message: "Not found." },
            ok: false,
          }),
          contentType: "application/json",
          status: 404,
        })
      },
    )
    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)
    await openSellerConsole(page)

    expect(await page.locator("[data-console-sessions] li").count()).toBe(1)
    expect(
      await page.locator("[data-console-sessions] .seller-pricing-facts").count(),
    ).toBe(0)
    expect(
      harness.registryRequests.some((request) =>
        request.path === "/v1/marketplace/seller/sales/sessions"
      ),
    ).toBe(true)
  })

  test("falls back to frozen v1 sessions while Registry v2 rolls out", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)
    await page.route(
      "**/api/registry/v2/marketplace/seller/sales/sessions",
      async (route) => {
        await route.fulfill({
          body: JSON.stringify({
            error: { code: "not_found", message: "Not found." },
            ok: false,
          }),
          contentType: "application/json",
          status: 404,
        })
      },
    )
    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)
    await openSellerConsole(page)

    expect(await page.locator("[data-console-sessions] li").count()).toBe(1)
    expect(
      await page.locator("[data-console-sessions] .seller-pricing-facts").count(),
    ).toBe(0)
    expect(
      harness.registryRequests.some((request) =>
        request.path === "/v1/marketplace/seller/sales/sessions"
      ),
    ).toBe(true)
  })

  test("opens payout from the seller header and restores trigger focus", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)
    await openSellerConsole(page)

    const launcher = page.locator("[data-payout-open]")
    const dialog = page.locator("[data-payout-dialog]")
    expect(await launcher.count()).toBe(1)
    expect(await page.locator(".seller-payout-panel").count()).toBe(0)
    expect(await launcher.evaluate((element) => {
      const launcherRect = element.getBoundingClientRect()
      const shellRect = element.closest(".seller-console-shell")
        ?.getBoundingClientRect()
      const chartTop = element.ownerDocument
        .querySelector(".seller-chart-panel")
        ?.getBoundingClientRect()
        .top
      return shellRect !== undefined
        && chartTop !== undefined
        && Math.abs(shellRect.right - launcherRect.right) <= 1
        && launcherRect.top < chartTop
    })).toBe(true)

    await launcher.click()
    await dialog.waitFor({ state: "visible" })
    expect(await page.locator("[data-payout-request]").isVisible()).toBe(true)
    expect(await page.locator(".seller-payout-dialog-body").evaluate((element) =>
      Number.parseFloat(
        element.ownerDocument.defaultView
          ?.getComputedStyle(element)
          .paddingInlineStart ?? "0",
      ),
    )).toBeGreaterThan(0)
    await page.locator("[data-payout-close]").click()
    await dialog.waitFor({ state: "hidden" })
    expect(await launcher.evaluate((element) =>
      element.ownerDocument.activeElement === element
    )).toBe(true)

    await launcher.click()
    await dialog.waitFor({ state: "visible" })
    await page.keyboard.press("Escape")
    await dialog.waitFor({ state: "hidden" })
    expect(await launcher.evaluate((element) =>
      element.ownerDocument.activeElement === element
    )).toBe(true)
  })

  test("keeps the legacy Seller Console module call shape compatible", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)
    await page.goto(harness.appUrl, { waitUntil: "networkidle" })

    const result = await page.evaluate<{
      readonly error: string | null
      readonly seller: string | null
    }>(`(async () => {
      const module = await import("/console.js")
      try {
        await module.mountSellerConsole({
          requestJson: async (path) => {
            if (path === "/v1/auth/me") {
              return {
                account: {
                  accountId: "acct-legacy0123456789",
                  email: "legacy@example.test",
                },
                ok: true,
              }
            }
            if (path === "/v2/marketplace/seller/sales/sessions") {
              return {
                asOf: "2026-08-20T12:00:00Z",
                ok: true,
                page: { nextCursor: null },
                sessions: [],
              }
            }
            return {
              asOf: "2026-08-20T12:00:00Z",
              currency: "USD",
              interval: "day",
              ok: true,
              openingCumulativeCredits: 0,
              points: [],
              window: { from: "2026-07-21", to: "2026-08-20" },
            }
          },
          session: { accessToken: "legacy-session-token" },
          showLogin: () => {
            throw new Error("legacy session unexpectedly rejected")
          },
        })
        return {
          error: null,
          seller: document.querySelector("[data-console-seller]")?.textContent ?? null,
        }
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
          seller: null,
        }
      }
    })()`)

    expect(result).toEqual({
      error: null,
      seller: null,
    })
  })

  test("ignores seller console responses from a previous account session", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)
    const firstToken = "marketplace-browser-session-token"
    const secondToken = "second-marketplace-session-token"
    const firstAccount = "acct-aaaaaaaaaaaaaaaa"
    const secondAccount = "acct-bbbbbbbbbbbbbbbb"
    const emptySessions = {
      asOf: "2026-08-20T12:00:00Z",
      ok: true,
      page: { nextCursor: null },
      sessions: [],
    }
    const emptyEarnings = {
      asOf: "2026-08-20T12:00:00Z",
      currency: "USD",
      interval: "day",
      ok: true,
      openingCumulativeCredits: 0,
      points: [],
      window: { from: "2026-07-21", to: "2026-08-20" },
    }
    let releaseFirstRequests = (): void => {
      throw new Error("first seller requests were not held")
    }
    const firstRequestGate = new Promise<void>((resolve) => {
      releaseFirstRequests = resolve
    })
    let verificationCount = 0

    await page.route("**/api/registry/v1/auth/verify", async (route) => {
      verificationCount += 1
      const second = verificationCount === 2
      await route.fulfill({
        body: JSON.stringify({
          accessToken: second ? secondToken : firstToken,
          accountId: second ? secondAccount : firstAccount,
          expiresAt: "2099-08-20T12:00:00Z",
          ok: true,
          tokenType: "Bearer",
        }),
        contentType: "application/json",
        status: 200,
      })
    })
    await page.route("**/api/registry/v1/marketplace/stats", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          activeRuntimes: 1,
          paidOutCredits: null,
          totalSessions: 2,
          tradeableTokens: 940_635,
        }),
        contentType: "application/json",
        status: 200,
      })
    })
    const fulfillConsoleRequest = async (route: Route): Promise<void> => {
      const request = route.request()
      const pathname = new URL(request.url()).pathname
      const first = request.headers().authorization === `Bearer ${firstToken}`
      if (first) await firstRequestGate
      const accountId = first ? firstAccount : secondAccount
      const body = pathname.endsWith("/auth/me")
        ? { account: { accountId, email: `${accountId}@example.test` }, ok: true }
        : pathname.endsWith("/sessions") ? emptySessions
          : pathname.endsWith("/earnings") ? emptyEarnings
            : pathname.endsWith("/weekly-limits") ? {
              ok: true,
              weeklyLimits: {
                currency: "USD",
                limitMinor: 20_000,
                payoutRemainingMinor: 20_000,
                sessionValueRemainingMinor: 20_000,
                windowSeconds: 604_800,
              },
            }
            : payoutSuccess(null, first ? 9_999 : 15_000, 0)
      await route.fulfill({
        body: JSON.stringify(body),
        contentType: "application/json",
        status: 200,
      })
    }
    await page.route("**/api/registry/v1/auth/me", fulfillConsoleRequest)
    await page.route(
      "**/api/registry/*/marketplace/seller/sales/**",
      fulfillConsoleRequest,
    )
    await page.route(
      "**/api/registry/v1/marketplace/seller/payout-request",
      fulfillConsoleRequest,
    )
    await page.route(
      "**/api/registry/v1/marketplace/seller/weekly-limits",
      fulfillConsoleRequest,
    )

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)
    expect(await page.locator("[data-console-payout]").count()).toBe(1)
    const firstRequestsStarted = Promise.all([
      page.waitForRequest((request) =>
        request.headers().authorization === `Bearer ${firstToken}`
        && new URL(request.url()).pathname.endsWith("/sales/sessions"),
      ),
      page.waitForRequest((request) =>
        request.headers().authorization === `Bearer ${firstToken}`
        && new URL(request.url()).pathname.endsWith("/sales/earnings"),
      ),
    ])
    await page.getByTestId("seller-console-link").click()
    await firstRequestsStarted
    const logoutResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/auth/logout"),
    )
    await page.getByTestId("auth-logout-button").evaluate((element) => element.click())
    await logoutResponse
    await page.locator("[data-auth-gate]").waitFor({ state: "visible" })
    await page.locator("[data-auth-email]").fill("second@example.test")
    await page.locator("[data-auth-request-submit]").click()
    await page.locator("[data-auth-code]").waitFor({ state: "visible" })
    await page.locator("[data-auth-code]").fill("654321")
    const secondConsoleRendered = page
      .locator('[data-console-payout][data-payout-state="eligible"]')
      .waitFor({ state: "attached" })
    await page.locator("[data-auth-verify-submit]").click()
    await secondConsoleRendered

    const staleResponses = Promise.all([
      page.waitForResponse((response) =>
        response.request().headers().authorization === `Bearer ${firstToken}`
        && new URL(response.url()).pathname.endsWith("/auth/me"),
      ),
      page.waitForResponse((response) =>
        response.request().headers().authorization === `Bearer ${firstToken}`
        && new URL(response.url()).pathname.endsWith("/sales/sessions"),
      ),
      page.waitForResponse((response) =>
        response.request().headers().authorization === `Bearer ${firstToken}`
        && new URL(response.url()).pathname.endsWith("/sales/earnings"),
      ),
    ])
    releaseFirstRequests()
    await staleResponses

    expect(await page.locator("body").getAttribute("data-auth-state")).toBe(
      "authenticated",
    )
    expect(await page.locator("[data-console-seller]").count()).toBe(0)
    expect(await page.locator("[data-console-view]:visible").count()).toBe(1)
    expect(await page.locator("[data-console-payout]").getAttribute("data-payout-state")).toBe(
      "eligible",
    )
  })

  test("shows empty seller sales states when the account has no sales activity", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)
    const emptySessions = { asOf: "2026-08-20T12:00:00Z", ok: true, page: { nextCursor: null }, sessions: [] }
    const emptyEarnings = { asOf: "2026-08-20T12:00:00Z", currency: "USD", interval: "day", ok: true, openingCumulativeCredits: 0, points: [], window: { from: "2026-07-21", to: "2026-08-20" } }
    await page.route("**/api/registry/*/marketplace/seller/sales/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname
      await route.fulfill({
        body: JSON.stringify(pathname.endsWith("sessions") ? emptySessions : emptyEarnings),
        contentType: "application/json",
        status: 200,
      })
    })
    await page.route("**/api/registry/v1/marketplace/seller/payout-request", async (route) => {
      await route.fulfill({
        body: JSON.stringify(payoutSuccess(null, 0, 0)),
        contentType: "application/json",
        status: 200,
      })
    })

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)
    await page.getByTestId("seller-console-link").click()
    await page.getByText("No seller sessions yet.").waitFor({ state: "visible" })

    expect(await page.getByText("No earnings recorded in this window.").isVisible()).toBe(true)
    expect(await page.locator("[data-console-total]").isHidden()).toBe(true)
    expect(await page.locator(".seller-payout-panel").count()).toBe(0)
    await openPayoutDialog(page)
    expect(await page.locator("[data-payout-balance]").innerText()).toBe(
      "$0.00 available",
    )
    expect(await page.locator("[data-console-payout]").isHidden()).toBe(true)
    expect(await page.locator("[data-console-view]").innerText()).not.toContain(
      "Reach $100.00 to request payout.",
    )
    expect(await page.locator("[data-console-ledger]").count()).toBe(0)
  })

  test("returns to the sign-in gate when a seller sales endpoint rejects the session", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)
    await page.route("**/api/registry/v2/marketplace/seller/sales/sessions", async (route) => {
      await route.fulfill({ body: JSON.stringify({ error: { code: "unauthorized" }, ok: false }), contentType: "application/json", status: 401 })
    })

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)
    await page.getByTestId("seller-console-link").click()
    await page.locator("[data-auth-gate]").waitFor({ state: "visible" })

    expect(await page.locator("[data-console-view]:visible").count()).toBe(0)
    expect(await page.locator("[data-console-sessions] li").count()).toBe(0)
  })

  test("keeps the seller console usable without horizontal overflow at 375 pixels", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage({ height: 844, width: 375 })

    expect(await page.evaluate<boolean>(
      "window.matchMedia('(prefers-reduced-motion: reduce)').matches",
    )).toBe(true)
    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)
    const menuButton = page.locator("[data-nav-menu-toggle]")
    const sellerConsoleLink = page.getByTestId("seller-console-link")
    const sellerConsoleLinkVisible = sellerConsoleLink.waitFor({ state: "visible" })
    await menuButton.click()
    await sellerConsoleLinkVisible
    const navigationHidden = page.locator(".nav-links").waitFor({ state: "hidden" })
    await sellerConsoleLink.click()
    await Promise.all([
      navigationHidden,
      page.locator("[data-console-chart] svg").waitFor({ state: "visible" }),
    ])

    expect(await menuButton.getAttribute("aria-expanded")).toBe("false")
    expect(await page.locator("body").evaluate((element) =>
      element.classList.contains("is-nav-open"),
    )).toBe(false)
    expect(await page.locator("html").evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(false)
    await openPayoutDialog(page)
    expect(await page.locator("[data-payout-dialog]").evaluate((dialog) => {
      const rect = dialog.getBoundingClientRect()
      return rect.left >= 0
        && rect.right <= dialog.ownerDocument.documentElement.clientWidth
        && rect.top >= 0
        && rect.bottom <= dialog.ownerDocument.defaultView.innerHeight
    })).toBe(true)
    expect(await page.locator("html").evaluate(
      (node) => node.scrollWidth > node.clientWidth,
    )).toBe(false)
  })

  test("copies a short handoff to the downloadable onboarding guide", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop, {
      permissions: ["clipboard-read", "clipboard-write"],
    })

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })

    const guideResponse = await page.request.get(
      `${harness.appUrl}/agent-onboarding.md`,
    )
    expect(guideResponse.status()).toBe(200)
    const guide = await guideResponse.text()
    expect(await page.locator(".corpus-console").count()).toBe(0)
    expect(await page.locator("#publish").count()).toBe(0)
    expect(await page.locator("#top .signal-button").getAttribute("href")).toBe(
      "#install-command",
    )
    const button = page.locator('[data-copy-target="install-command"]')
    const handoff = await page.locator("#install-command").innerText()
    expect(handoff).not.toBe(guide)
    expect(await button.getAttribute("data-copy-source")).toBeNull()
    await button.evaluate((element) => {
      const Observer = element.ownerDocument.defaultView.MutationObserver
      Reflect.set(element, "__atmCopySettled", new Promise<void>((resolve) => {
        const observer = new Observer(() => {
          if (element.dataset.copyState === "idle") return
          observer.disconnect()
          resolve()
        })
        observer.observe(element, {
          attributeFilter: ["data-copy-state"],
          attributes: true,
        })
      }))
    })
    await button.click()
    await button.evaluate(async (element) => {
      const settled = Reflect.get(element, "__atmCopySettled")
      if (!(settled instanceof Promise)) {
        throw new Error("copy observer unavailable")
      }
      await settled
      Reflect.deleteProperty(element, "__atmCopySettled")
    })
    expect(await page.evaluate<string>("navigator.clipboard.readText()")).toBe(handoff)
    expect(await button.getAttribute("data-copy-state")).toBe("copied")
    expect(await page.locator("[data-copy-status]").innerText()).not.toBe("")
    await button.evaluate((element) => element.blur())
    expect(await button.getAttribute("data-copy-state")).toBe("idle")
    expect(await page.locator("[data-copy-status]").innerText()).toBe("")
  })

  test("keeps the onboarding control free of a secondary arrow action", async () => {
    // Given: the seller landing page at a desktop viewport.
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)

    // When: the real landing page finishes loading.
    await page.goto(harness.appUrl, { waitUntil: "networkidle" })

    // Then: Copy is the only action inside the onboarding control.
    expect(await page.locator(".hero-install .copy-button").count()).toBe(1)
    expect(await page.locator(".hero-tool-run").count()).toBe(0)
    expect(await page.locator(".hero-tool-footer").count()).toBe(0)
  })

  test("keeps buyer access and member sign-in as separate entry points", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })

    await page.getByTestId("request-access-button").click()
    expect(await page.locator("body").getAttribute("data-auth-state")).toBe("waitlist")
    expect(await page.locator("[data-auth-mode]").count()).toBe(0)
    expect(await page.locator("[data-auth-accept-contact]").isVisible()).toBe(true)

    await page.getByTestId("auth-close-button").click()
    await page.getByTestId("sign-in-button").click()
    expect(await page.locator("body").getAttribute("data-auth-state")).toBe("login")
    expect(await page.locator("[data-auth-mode]").count()).toBe(0)
    expect(await page.locator("[data-auth-accept-contact]").isVisible()).toBe(false)
  })

  test("member sign-in entry supports account signup", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await openMemberSignIn(page)

    const signup = page.locator("[data-auth-mode-signup]")
    await signup.waitFor({ state: "visible", timeout: 1_000 })
    expect(await page.locator("body").getAttribute("data-auth-state")).toBe("login")
    expect(await signup.innerText()).toBe("New member? Sign up")
    await signup.click()

    expect(await page.locator("body").getAttribute("data-auth-state")).toBe("signup")
    expect(await page.locator("[data-auth-console-path]").innerText()).toBe("ATM / member-sign-up")
    expect(await page.locator("[data-auth-kicker]").innerText()).toBe("New member")
    expect(await page.locator("[data-auth-title-prefix]").innerText()).toBe("Create your")
    expect(await page.locator("[data-auth-title-accent]").innerText()).toBe("ATM account.")
    expect(await page.locator("[data-auth-description]").innerText()).toBe(
      "Enter your email to receive a six-digit code. No password and no browser-stored session.",
    )
    expect(await page.locator("[data-auth-request-label]").innerText()).toBe("Create account")
    expect(await page.locator("[data-auth-signup-terms]").isVisible()).toBe(true)
    expect(await page.locator("[data-auth-accept-terms]").isChecked()).toBe(false)
    expect(await page.locator("[data-auth-mode-login]").innerText()).toBe("Already a member? Sign in")

    await page.locator("[data-auth-email]").fill("NEW-MEMBER@getatm.io")
    await page.locator("[data-auth-request-submit]").click()
    expect(await page.locator("[data-auth-feedback]").getAttribute("data-error-code")).toBe("terms_required")
    expect(await page.locator("[data-auth-accept-terms]").evaluate((element) =>
      element.ownerDocument.activeElement === element,
    )).toBe(true)
    expect(harness.registryRequests.filter((request) =>
      request.path === "/v1/auth/signup",
    )).toEqual([])

    await page.locator("[data-auth-accept-terms]").check()
    const signupRequest = page.waitForRequest((request) =>
      new URL(request.url()).pathname === "/api/registry/v1/auth/signup",
    )
    await page.locator("[data-auth-request-submit]").click()
    const signupRequestValue = await signupRequest
    expect(new URL(signupRequestValue.url()).origin).toBe(harness.appUrl)
    expect(await signupRequestValue.postDataJSON()).toEqual({
      acceptTerms: true,
      email: "new-member@getatm.io",
    })
    await page.locator("[data-auth-code]").waitFor({ state: "visible" })
    const verifyRequest = page.waitForRequest((request) =>
      new URL(request.url()).pathname === "/api/registry/v1/auth/verify",
    )
    const statsResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/registry/v1/marketplace/stats",
    )
    await page.locator("[data-auth-code]").fill("654321")
    await page.locator("[data-auth-verify-submit]").click()
    expect(await (await verifyRequest).postDataJSON()).toEqual({
      challengeId: "chal-fedcba9876543210",
      code: "654321",
    })
    await statsResponse
    expect(await page.locator("body").getAttribute("data-auth-state")).toBe("authenticated")
    expect(await page.evaluate<number>("sessionStorage.length")).toBe(0)
    expect(await page.context().cookies()).toEqual([])
    expect(new URL(page.url()).search).toBe("")
  })

  test("member sign-in keeps existing-member login behavior", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await openMemberSignIn(page)
    const challengeRequest = page.waitForRequest((request) => {
      const pathname = new URL(request.url()).pathname
      return pathname === "/api/registry/v1/auth/login" || pathname === "/api/registry/v1/auth/signup"
    })
    await page.locator("[data-auth-email]").fill("EXISTING-MEMBER@getatm.io")
    await page.locator("[data-auth-request-submit]").click()
    const challenge = await challengeRequest

    expect({
      body: await challenge.postDataJSON(),
      pathname: new URL(challenge.url()).pathname,
    }).toEqual({
      body: { email: "existing-member@getatm.io" },
      pathname: "/api/registry/v1/auth/login",
    })
    expect(await page.locator("[data-auth-signup-terms]:visible").count()).toBe(0)
    await page.locator("[data-auth-code]").waitFor({ state: "visible" })
    const verifyRequest = page.waitForRequest((request) =>
      new URL(request.url()).pathname === "/api/registry/v1/auth/verify",
    )
    const statsResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/registry/v1/marketplace/stats",
    )
    await page.locator("[data-auth-code]").fill("654321")
    await page.locator("[data-auth-verify-submit]").click()

    expect(await (await verifyRequest).postDataJSON()).toEqual({
      challengeId: "chal-0123456789abcdef",
      code: "654321",
    })
    await statsResponse
    expect(await page.locator("body").getAttribute("data-auth-state")).toBe("authenticated")
  })

  test("member signup rejects invalid email without a request", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await openMemberSignIn(page)
    const signup = page.locator("[data-auth-mode-signup]")
    await signup.waitFor({ state: "visible", timeout: 1_000 })
    await signup.click()
    await page.locator("[data-auth-email]").fill("not-an-email")
    await page.locator("[data-auth-request-submit]").click()

    expect(await page.locator("[data-auth-feedback]").getAttribute("data-error-code")).toBe("invalid_email")
    expect(await page.locator("[data-auth-email]").evaluate((element) =>
      element.ownerDocument.activeElement === element,
    )).toBe(true)
    expect(harness.registryRequests.filter((request) =>
      request.path === "/v1/auth/login" || request.path === "/v1/auth/signup",
    )).toEqual([])
  })

  test("member signup dialog is keyboard reachable and mobile safe", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(mobile, {
      hasTouch: true,
      isMobile: true,
    })

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await openMemberSignIn(page)
    const signup = page.locator("[data-auth-mode-signup]")
    await signup.waitFor({ state: "visible", timeout: 1_000 })
    await signup.focus()
    await page.keyboard.press("Enter")

    expect(await page.locator("body").getAttribute("data-auth-state")).toBe("signup")
    expect(await page.locator("[data-auth-accept-terms]").isVisible()).toBe(true)
    expect(await page.locator("[data-auth-accept-terms]").evaluate((element) =>
      element.closest(".auth-terms")?.getBoundingClientRect().height ?? 0,
    )).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate<boolean>(`
      (() => {
        const dialog = document.querySelector("[data-auth-gate]")?.getBoundingClientRect()
        const title = document.querySelector("#auth-title")?.getBoundingClientRect()
        return dialog !== undefined && title !== undefined &&
          dialog.top >= 0 && dialog.bottom <= window.innerHeight &&
          title.top >= dialog.top && title.bottom <= dialog.bottom
      })()
    `)).toBe(true)
    expect(await page.locator("html").evaluate((element) =>
      element.scrollWidth <= element.clientWidth,
    )).toBe(true)

    const email = page.locator("[data-auth-email]")
    const terms = page.locator("[data-auth-accept-terms]")
    const termsPolicy = page.locator(
      'a[href="/legal/account-terms/2026-08-28"]',
    )
    const privacyPolicy = page.locator(
      'a[href="/legal/account-privacy/2026-08-28"]',
    )
    const createAccount = page.locator("[data-auth-request-submit]")
    const signIn = page.locator("[data-auth-mode-login]")
    const close = page.getByTestId("auth-close-button")
    await email.focus()
    await page.keyboard.press("Tab")
    expect(await terms.evaluate((element) => element.ownerDocument.activeElement === element)).toBe(true)
    await page.keyboard.press("Tab")
    expect(await termsPolicy.evaluate(
      (element) => element.ownerDocument.activeElement === element,
    )).toBe(true)
    await page.keyboard.press("Tab")
    expect(await privacyPolicy.evaluate(
      (element) => element.ownerDocument.activeElement === element,
    )).toBe(true)
    await page.keyboard.press("Tab")
    expect(await createAccount.evaluate((element) => element.ownerDocument.activeElement === element)).toBe(true)
    await page.keyboard.press("Tab")
    expect(await signIn.evaluate((element) => element.ownerDocument.activeElement === element)).toBe(true)
    await page.keyboard.press("Tab")
    expect(await page.locator("[data-auth-gate]").evaluate((element) =>
      element.contains(element.ownerDocument.activeElement),
    )).toBe(true)
    expect(await close.evaluate((element) => element.ownerDocument.activeElement === element)).toBe(true)
    await page.keyboard.press("Shift+Tab")
    expect(await signIn.evaluate((element) => element.ownerDocument.activeElement === element)).toBe(true)

    const dialogClosed = page.locator("[data-auth-gate]").evaluate((dialog) =>
      new Promise<void>((resolve) => {
        dialog.addEventListener("close", () => resolve(), { once: true })
      })
    )
    await close.click()
    await dialogClosed
    expect(await page.evaluate<boolean>(
      "document.activeElement?.matches('[data-nav-menu-toggle]') === true",
    )).toBe(true)
  })

  test("member mode switch ignores stale challenge responses", async () => {
    harness = await startSessionUiHarness()
    const releaseChallenge = harness.holdChallenge()
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await openMemberSignIn(page)
    await page.locator("[data-auth-email]").fill("existing-member@getatm.io")
    const challengeRequest = page.waitForRequest((request) =>
      new URL(request.url()).pathname === "/api/registry/v1/auth/login",
    )
    await page.locator("[data-auth-request-submit]").click()
    await challengeRequest
    const signup = page.locator("[data-auth-mode-signup]")
    await signup.waitFor({ state: "visible", timeout: 1_000 })
    await signup.click()
    const challengeResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/registry/v1/auth/login",
    )
    releaseChallenge()
    await challengeResponse

    expect(await page.locator("body").getAttribute("data-auth-state")).toBe("signup")
    expect(await page.locator("[data-auth-request-form]").isVisible()).toBe(true)
    expect(await page.locator("[data-auth-verify-form]:visible").count()).toBe(0)
    expect(await page.locator("[data-authenticated-content]:visible").count()).toBe(0)
    expect(harness.registryRequests.filter((request) =>
      request.path === "/v1/marketplace/stats",
    )).toEqual([])
  })

  test("routes local member sign-in through the same-origin preview proxy", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await openMemberSignIn(page)
    const challengeRequest = page.waitForRequest((request) =>
      new URL(request.url()).pathname.endsWith("/v1/auth/login"),
    )
    await page.locator("[data-auth-email]").fill("owner@example.test")
    await page.locator("[data-auth-request-submit]").click()
    const challenge = await challengeRequest

    expect(new URL(challenge.url()).origin).toBe(harness.appUrl)
    expect(new URL(challenge.url()).pathname).toBe("/api/registry/v1/auth/login")
    expect(await challenge.postDataJSON()).toEqual({ email: "owner@example.test" })
  })

  test("opens a dismissible auth dialog only after an explicit supply action", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    const supplyButton = page.getByTestId("supply-request-access-button")
    await supplyButton.click()

    expect(await page.getByRole("dialog").isVisible()).toBe(true)
    expect(await page.locator("body").evaluate((element) =>
      element.classList.contains("is-auth-open"),
    )).toBe(true)
    expect(await page.evaluate<boolean>(
      "document.activeElement?.id === 'auth-email'",
    )).toBe(true)
    expect(await page.locator("#top").isVisible()).toBe(true)
    expect(await page.locator(".auth-assurances").count()).toBe(0)
    const closeButton = page.getByTestId("auth-close-button")
    expect(await closeButton.isVisible()).toBe(true)
    await closeButton.click()
    expect(await page.getByRole("dialog").isVisible()).toBe(false)
    expect(await page.evaluate<boolean>(
      "document.activeElement?.dataset.testid === 'supply-request-access-button'",
    )).toBe(true)

    const navigationButton = page.getByTestId("request-access-button")
    await navigationButton.click()
    await page.keyboard.press("Escape")
    expect(await page.getByRole("dialog").isVisible()).toBe(false)
    expect(await page.evaluate<boolean>(
      "document.activeElement?.dataset.testid === 'request-access-button'",
    )).toBe(true)
  })

  test("verifies an OTP and loads aggregate supply with bearer session auth", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)
    await page.getByTestId("aggregate-session-count").waitFor({ state: "visible" })

    expect(await page.getByTestId("aggregate-session-count").innerText()).toBe("2")
    expect(await page.getByTestId("aggregate-token-count").innerText()).toBe("940.6K")
    expect(await page.getByTestId("aggregate-runtime-count").innerText()).toBe("1")
    expect(await page.getByTestId("aggregate-status").isVisible()).toBe(false)
    expect(await page.evaluate<number>("sessionStorage.length")).toBe(0)
    expect(await page.evaluate<boolean>(
      "document.activeElement?.id === 'main-content'",
    )).toBe(true)
    expect(await page.locator(".nav-links:visible").count()).toBe(1)
    expect(harness.registryRequests).toContainEqual({
      authorization: "Bearer marketplace-browser-session-token",
      body: undefined,
      method: "GET",
      path: "/v1/marketplace/stats",
    })
  })

  test("centers the authenticated Seller console control", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)

    expect(await page.getByTestId("seller-console-link").evaluate((element) => {
      const view = element.ownerDocument.defaultView
      if (view === null) throw new Error("Seller console control has no browser view")
      const style = view.getComputedStyle(element)
      return {
        alignItems: style.alignItems,
        display: style.display,
        height: element.getBoundingClientRect().height,
        justifyContent: style.justifyContent,
      }
    })).toEqual({
      alignItems: "center",
      display: "flex",
      height: 42,
      justifyContent: "center",
    })
  })

  test("posts a waitlist request and keeps sign-in independently available", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)
    await page.route("**/api/waitlist", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ ok: true, status: "accepted" }),
        contentType: "application/json",
        status: 202,
      })
    })

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await page.getByTestId("request-access-button").click()
    await page.locator("[data-auth-email]").fill("OWNER@example.test")
    await page.locator("[data-auth-accept-contact]").check()
    const request = page.waitForRequest((candidate) =>
      new URL(candidate.url()).pathname === "/api/waitlist",
    )
    const response = page.waitForResponse((candidate) =>
      new URL(candidate.url()).pathname === "/api/waitlist",
    )
    await page.locator("[data-auth-request-submit]").click()

    expect(await (await request).postDataJSON()).toEqual({
      acceptContact: true,
      email: "owner@example.test",
    })
    expect((await response).status()).toBe(202)
    expect(await page.locator("[data-auth-request-form]:visible").count()).toBe(0)
    expect(await page.locator("[data-auth-waitlist-success]").isVisible()).toBe(true)
    expect(await page.evaluate(
      (key) => sessionStorage.getItem(key),
      "atm.marketplace.waitlist-ack-v1",
    )).toBe("1")

    await page.reload({ waitUntil: "networkidle" })
    await page.getByTestId("request-access-button").click()
    expect(await page.locator("[data-auth-waitlist-success]").isVisible()).toBe(true)
    await page.getByTestId("auth-close-button").click()
    await page.getByTestId("sign-in-button").click()
    expect(await page.locator("[data-auth-request-form]").isVisible()).toBe(true)
    expect(await page.locator("[data-auth-accept-contact]").isVisible()).toBe(false)
  })

  test("clears an unauthorized session and permits a new login", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)
    let statsAttempts = 0
    await page.route("**/api/registry/v1/marketplace/stats", async (route) => {
      statsAttempts += 1
      if (statsAttempts === 1) {
        await route.fulfill({
          body: JSON.stringify({ error: { code: "unauthorized" }, ok: false }),
          contentType: "application/json",
          status: 401,
        })
        return
      }
      await route.fulfill({
        body: JSON.stringify({ activeRuntimes: 1, totalSessions: 2, tradeableTokens: 940_635 }),
        contentType: "application/json",
        status: 200,
      })
    })

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)

    expect(await page.locator("[data-auth-gate]").isVisible()).toBe(true)
    expect(await page.locator("[data-authenticated-content]:visible").count()).toBe(0)
    expect(await page.locator("#top").isVisible()).toBe(true)
    expect(await page.evaluate("sessionStorage.getItem('atm.marketplace.session.v1')")).toBeNull()

    await authenticate(page)
    await page.getByTestId("aggregate-session-count").waitFor({ state: "visible" })
    await page.locator("[data-auth-gate]").waitFor({ state: "hidden" })

    expect(statsAttempts).toBe(2)
  })

  test("revokes with bearer auth and clears local session on logout", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)
    const logoutRequest = page.waitForRequest((request) =>
      new URL(request.url()).pathname === "/api/registry/v1/auth/logout",
    )
    const logoutResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/registry/v1/auth/logout",
    )
    await page.getByTestId("auth-logout-button").click()
    const logout = await logoutRequest
    await logoutResponse

    expect(logout.headers().authorization).toBe("Bearer marketplace-browser-session-token")
    expect(await page.locator("[data-auth-gate]").isVisible()).toBe(true)
    expect(await page.locator("[data-authenticated-content]:visible").count()).toBe(0)
    expect(await page.locator("#top").isVisible()).toBe(true)
  })

  test("keeps the user signed in when remote logout revocation fails", async () => {
    harness = await startSessionUiHarness()
    harness.setLogoutStatus(503)
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)
    const logoutResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/registry/v1/auth/logout",
    )
    await page.getByTestId("auth-logout-button").click()
    expect((await logoutResponse).status()).toBe(503)

    expect(await page.locator("[data-auth-gate]:visible").count()).toBe(0)
    expect(await page.locator("[data-authenticated-content]:visible").count()).toBeGreaterThan(0)
    expect(await page.getByTestId("aggregate-status").evaluate((element) =>
      element.classList.contains("is-unavailable"),
    )).toBe(true)
  })

  test("requires a new OTP login after a page reload", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)
    const statsBeforeReload = harness.registryRequests.filter(
      (request) => request.path === "/v1/marketplace/stats",
    ).length
    await page.reload({ waitUntil: "networkidle" })

    expect(await page.locator("[data-auth-gate]").isVisible()).toBe(false)
    expect(await page.locator("[data-authenticated-content]:visible").count()).toBe(0)
    expect(await page.locator("#top").isVisible()).toBe(true)
    expect(harness.registryRequests.filter(
      (request) => request.path === "/v1/marketplace/stats",
    ).length).toBe(statsBeforeReload)
  })

  test("rejects cross-origin redirects for OTP requests", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)
    const redirectedRequests: string[] = []
    page.on("request", (request) => {
      if (new URL(request.url()).hostname === "evil.example") {
        redirectedRequests.push(request.url())
      }
    })
    await page.route("**/api/registry/v1/auth/login", async (route) => {
      await route.fulfill({
        headers: { location: "https://evil.example/otp" },
        status: 307,
      })
    })

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await openMemberSignIn(page)
    await page.locator("[data-auth-email]").fill("owner@example.test")
    await page.locator("[data-auth-request-submit]").click()
    await page.locator("[data-auth-request-submit]:not([disabled])").waitFor({
      state: "visible",
    })

    expect(redirectedRequests).toEqual([])
    expect(await page.locator("[data-auth-gate]").isVisible()).toBe(true)
    expect(await page.locator("[data-auth-verify-form]:visible").count()).toBe(0)
  })

  test("explains when a verified mailbox has no member account", async () => {
    harness = await startSessionUiHarness()
    harness.setVerifyAccountRequired()
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await openMemberSignIn(page)
    await page.locator("[data-auth-email]").fill("owner@example.test")
    await page.locator("[data-auth-request-submit]").click()
    await page.locator("[data-auth-code]").waitFor({ state: "visible" })
    await page.locator("[data-auth-code]").fill("654321")
    const verifyResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/registry/v1/auth/verify",
    )
    await page.locator("[data-auth-verify-submit]").click()

    expect((await verifyResponse).status()).toBe(401)
    expect(await page.locator("[data-auth-feedback]").getAttribute("data-error-code"))
      .toBe("account_required")
    expect((await page.locator("[data-auth-feedback]").innerText()).length).toBeGreaterThan(0)
    expect(await page.locator("[data-auth-code]").isVisible()).toBe(true)
    expect(harness.registryRequests.filter((request) =>
      request.path === "/v1/auth/signup",
    )).toEqual([])

    const signup = page.locator("[data-auth-mode-signup]")
    await signup.waitFor({ state: "visible", timeout: 1_000 })
    await signup.click()

    expect(await page.locator("body").getAttribute("data-auth-state")).toBe("signup")
    expect(await page.locator("[data-auth-email]").inputValue()).toBe("owner@example.test")
    expect(await page.locator("[data-auth-accept-terms]").isChecked()).toBe(false)
    expect(harness.registryRequests.filter((request) =>
      request.path === "/v1/auth/signup",
    )).toEqual([])
  })

  test("ignores a verification response after the user restarts login", async () => {
    harness = await startSessionUiHarness()
    const releaseVerify = harness.holdVerify()
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await openMemberSignIn(page)
    await page.locator("[data-auth-email]").fill("owner@example.test")
    await page.locator("[data-auth-request-submit]").click()
    await page.locator("[data-auth-code]").waitFor({ state: "visible" })
    await page.locator("[data-auth-code]").fill("654321")
    const verifyRequest = page.waitForRequest((request) =>
      new URL(request.url()).pathname === "/api/registry/v1/auth/verify",
    )
    const verifyResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/registry/v1/auth/verify",
    )
    await page.locator("[data-auth-verify-submit]").click()
    await verifyRequest
    await page.locator("[data-auth-restart]").click()
    releaseVerify()
    await verifyResponse

    expect(await page.locator("[data-auth-request-form]").isVisible()).toBe(true)
    expect(await page.locator("[data-authenticated-content]:visible").count()).toBe(0)
    expect(harness.registryRequests.filter(
      (request) => request.path === "/v1/marketplace/stats",
    )).toEqual([])
  })

  for (const dismissal of ["close-button", "escape"] as const) {
    test(`ignores verification responses after ${dismissal} dismissal`, async () => {
      harness = await startSessionUiHarness()
      const page = await harness.newPage(desktop)
      const releaseVerify = harness.holdVerify()
      await page.goto(harness.appUrl, { waitUntil: "networkidle" })
      await openMemberSignIn(page)
      await page.locator("[data-auth-email]").fill("owner@example.test")
      await page.locator("[data-auth-request-submit]").click()
      await page.locator("[data-auth-code]").waitFor({ state: "visible" })
      await page.locator("[data-auth-code]").fill("654321")
      const verifyRequest = page.waitForRequest((request) =>
        new URL(request.url()).pathname === "/api/registry/v1/auth/verify",
      )
      const verifyResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/registry/v1/auth/verify",
      )
      await page.locator("[data-auth-verify-submit]").click()
      await verifyRequest

      if (dismissal === "close-button") {
        await page.getByTestId("auth-close-button").click()
      } else {
        await page.keyboard.press("Escape")
      }
      await page.locator("[data-auth-gate]").waitFor({ state: "hidden" })
      releaseVerify()
      await verifyResponse

      expect(await page.locator("body").getAttribute("data-auth-state"))
        .not.toBe("authenticated")
      expect(await page.locator("[data-authenticated-content]:visible").count()).toBe(0)
      expect(harness.registryRequests.filter(
        (request) => request.path === "/v1/marketplace/stats",
      )).toEqual([])
    })
  }

  test("keeps mobile supply labels below the fixed navigation", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(mobile)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)
    await page.locator('a.text-action[href="#supply"]').click()
    await page.waitForFunction(
      "document.querySelector('#supply')?.getBoundingClientRect().top >= "
      + "document.querySelector('[data-marketplace-nav]')?.getBoundingClientRect().height",
    )

    const navBottom = await page.locator("[data-marketplace-nav]").evaluate(
      (element) => element.getBoundingClientRect().bottom,
    )
    const labelTop = await page.locator("[data-token-count]").evaluate(
      (element) => element.closest(".metric-card")?.getBoundingClientRect().top ?? -1,
    )
    expect(labelTop).toBeGreaterThanOrEqual(navBottom)
    expect(await page.locator("html").evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    )).toBe(false)
  })

  test("opens and closes the mobile navigation without hiding buyer access", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(mobile)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })

    const menuButton = page.locator("[data-nav-menu-toggle]")
    const navLinks = page.locator(".nav-links")
    const requestAccess = page.getByTestId("request-access-button")
    const signIn = page.getByTestId("sign-in-button")
    expect(await menuButton.isVisible()).toBe(true)
    expect(await menuButton.getAttribute("aria-expanded")).toBe("false")

    const navLinksVisible = navLinks.waitFor({ state: "visible" })
    const requestAccessVisible = requestAccess.waitFor({ state: "visible" })
    const signInVisible = signIn.waitFor({ state: "visible" })
    await menuButton.click()
    await Promise.all([navLinksVisible, requestAccessVisible, signInVisible])
    expect(await menuButton.getAttribute("aria-expanded")).toBe("true")
    expect(await page.locator("body").evaluate((element) =>
      element.classList.contains("is-nav-open"),
    )).toBe(true)

    await page.keyboard.press("Escape")
    expect(await menuButton.getAttribute("aria-expanded")).toBe("false")
    expect(await page.evaluate<boolean>(
      "document.activeElement?.dataset.navMenuToggle !== undefined",
    )).toBe(true)

    await menuButton.click()
    await requestAccess.click()
    expect(await page.getByRole("dialog").isVisible()).toBe(true)
    expect(await page.locator("body").evaluate((element) =>
      element.classList.contains("is-nav-open"),
    )).toBe(false)
  })

  test("retired detail URLs keep users on the public landing", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)

    await page.goto(`${harness.appUrl}/detail.html?id=sub_14m3r01jp1wd7a3rm2j719p9vv`, { waitUntil: "networkidle" })

    expect(new URL(page.url()).pathname).toBe("/index.html")
    expect(await page.locator("[data-auth-gate]").isVisible()).toBe(false)
    expect(await page.locator("#top").isVisible()).toBe(true)
    expect(harness.registryRequests).toEqual([{
      authorization: null,
      body: undefined,
      method: "GET",
      path: "/v1/marketplace/public-stats",
    }])
  })

  test("keeps the public landing and explicit sign-in usable on mobile", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(mobile)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await page.keyboard.press("Tab")

    expect(await page.locator(":focus").getAttribute("data-testid")).toBe("session-skip-link")
    expect(await page.locator("#top").isVisible()).toBe(true)
    expect(await page.locator("[data-auth-gate]").isVisible()).toBe(false)
    await page.getByTestId("supply-request-access-button").click()
    expect(await page.getByRole("dialog").isVisible()).toBe(true)
    expect(await page.evaluate<boolean>(`
      (() => {
        const dialog = document.querySelector("[data-auth-gate]")?.getBoundingClientRect()
        const title = document.querySelector("#auth-title")?.getBoundingClientRect()
        return dialog !== undefined && title !== undefined &&
          dialog.top >= 0 && dialog.bottom <= window.innerHeight &&
          title.top >= dialog.top && title.bottom <= dialog.bottom
      })()
    `)).toBe(true)
    expect(await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false)
  })

  test("does not expose supply when JavaScript is unavailable", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(mobile, { javaScriptEnabled: false })

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })

    expect(await page.locator("[data-auth-gate]").isVisible()).toBe(false)
    expect(await page.locator("#top").isVisible()).toBe(true)
    expect(await page.locator("[data-supply-locked]:visible").count()).toBe(0)
    expect(await page.locator("[data-auth-open]:visible").count()).toBe(0)
    expect(await page.locator("[data-authenticated-content]:visible").count()).toBe(0)
    expect(harness.registryRequests).toEqual([])
  })

  const payoutStates = [
    {
      expected: "below-threshold",
      response: payoutSuccess(null, 9_999, 0),
    },
    {
      expected: "eligible",
      response: payoutSuccess(null, 15_000, 0),
    },
    {
      expected: "requested",
      response: payoutSuccess(payoutRequest),
    },
    {
      expected: "pending",
      response: payoutSuccess({ ...payoutRequest, status: "pending" }),
    },
    {
      expected: "rejected",
      response: payoutSuccess({
        ...payoutRequest,
        rejectedReason: "Destination needs review.",
        status: "rejected",
      }, 15_000, 0),
    },
    {
      expected: "approved",
      response: payoutSuccess({
        ...payoutRequest,
        approvedAt: "2026-08-29T01:00:00Z",
        status: "approved",
      }),
    },
    {
      expected: "processing",
      response: payoutSuccess({
        ...payoutRequest,
        approvedAt: "2026-08-29T01:00:00Z",
        status: "processing",
      }),
    },
    {
      expected: "cancelled",
      response: payoutSuccess({ ...payoutRequest, status: "cancelled" }, 15_000, 0),
    },
    {
      expected: "paid",
      response: payoutSuccess({
        ...payoutRequest,
        approvedAt: "2026-08-29T01:00:00Z",
        externalReference: "manual-ach-42",
        paidAt: "2026-08-29T02:00:00Z",
        status: "paid",
      }, 0, 0),
    },
  ] as const

  for (const scenario of payoutStates) {
    test(`renders the ${scenario.expected} payout state without hiding seller sales`, async () => {
      harness = await startSessionUiHarness()
      harness.setPayoutResponses({ body: scenario.response, status: 200 })
      const page = await harness.newPage(desktop)
      await page.goto(harness.appUrl, { waitUntil: "networkidle" })
      await authenticate(page)
      await openSellerConsole(page)
      await openPayoutDialog(page)

      const payout = page.locator("[data-console-payout]")
      expect(await payout.count()).toBe(1)
      expect(await payout.getAttribute("data-payout-state")).toBe(scenario.expected)
      expect(await page.locator("[data-console-sessions] li").count()).toBeGreaterThan(0)
      expect(await page.locator("[data-console-chart] svg").count()).toBe(1)
      expect(await payout.locator("button").evaluateAll((buttons) =>
        buttons.every((button) => button.getBoundingClientRect().height >= 44)
      )).toBe(true)
    })
  }

  test("suppresses duplicate payout clicks while retaining one operation UUID", async () => {
    harness = await startSessionUiHarness()
    harness.setPayoutResponses(
      { body: payoutSuccess(null, 15_000, 0), status: 200 },
      { body: payoutSuccess(payoutRequest), status: 201 },
    )
    const page = await harness.newPage(desktop)
    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)
    await openSellerConsole(page)
    await openPayoutDialog(page)

    expect(await page.locator("[data-payout-request]").count()).toBe(1)
    const release = harness.holdPayout()
    const button = page.locator("[data-payout-request]")
    await button.dblclick()
    await page.locator("[data-console-payout][data-payout-state=submitting]").waitFor()
    const posts = harness.registryRequests.filter((request) =>
      request.method === "POST"
      && request.path === "/v1/marketplace/seller/payout-request"
    )
    expect(posts).toHaveLength(1)
    expect(posts[0]?.body).toEqual({})
    expect(posts[0]?.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    release()
  })

  test("renders creation-disabled as refresh-only and never repeats POST", async () => {
    harness = await startSessionUiHarness()
    harness.setPayoutResponses(
      { body: payoutSuccess(null, 15_000, 0), status: 200 },
      {
        body: payoutError(
          "payout_request_creation_disabled",
          "Payout requests are temporarily unavailable.",
        ),
        status: 503,
      },
      { body: payoutSuccess(null, 15_000, 0), status: 200 },
    )
    const page = await harness.newPage(desktop)
    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)
    await openSellerConsole(page)
    await openPayoutDialog(page)

    expect(await page.locator("[data-console-payout]").count()).toBe(1)
    await page.locator("[data-payout-request]").click()
    await page.getByText("Payout requests are temporarily unavailable.", { exact: true }).waitFor()
    const refreshResponse = page.waitForResponse((response) =>
      response.request().method() === "GET"
      && new URL(response.url()).pathname.endsWith("/seller/payout-request")
    )
    await page.locator("[data-payout-refresh]").click()
    await refreshResponse
    expect(harness.registryRequests.filter((request) =>
      request.path === "/v1/marketplace/seller/payout-request"
    ).map((request) => request.method)).toEqual(["GET", "POST", "GET"])
  })

  test("renders weekly payout cap as a policy-specific refresh state", async () => {
    harness = await startSessionUiHarness()
    harness.setPayoutResponses(
      { body: payoutSuccess(null, 15_000, 0), status: 200 },
      {
        body: payoutError(
          "weekly_payout_limit_reached",
          "The rolling weekly payout limit has been reached.",
        ),
        retryAfter: "3600",
        status: 429,
      },
    )
    const page = await harness.newPage(desktop)
    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)
    await openSellerConsole(page)
    await openPayoutDialog(page)

    await page.locator("[data-payout-request]").click()
    const payout = page.locator(
      '[data-console-payout][data-payout-state="weekly-limit-reached"]',
    )
    await payout.waitFor({ state: "visible" })
    expect(await payout.locator("[data-payout-refresh]").count()).toBe(1)
    expect(await payout.locator("[data-payout-request]").count()).toBe(0)
  })

  test("renders missing payout service as a GET-only refresh state", async () => {
    harness = await startSessionUiHarness()
    harness.setPayoutResponses({
      body: payoutError(
        "payout_request_service_unavailable",
        "Payout request service is unavailable.",
      ),
      status: 503,
    })
    const page = await harness.newPage(desktop)
    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)
    await openSellerConsole(page)
    await openPayoutDialog(page)

    expect(await page.locator("[data-console-payout]").count()).toBe(1)
    await page.getByText("Payout request service is unavailable.", { exact: true }).waitFor()
    const refreshResponse = page.waitForResponse((response) =>
      response.request().method() === "GET"
      && new URL(response.url()).pathname.endsWith("/seller/payout-request")
    )
    await page.locator("[data-payout-refresh]").click()
    await refreshResponse
    expect(harness.registryRequests.filter((request) =>
      request.path.includes("/payout-request")
    ).every((request) => request.method === "GET")).toBe(true)
    expect(await page.locator("[data-payout-request], [data-payout-cancel]").count()).toBe(0)
  })
})
