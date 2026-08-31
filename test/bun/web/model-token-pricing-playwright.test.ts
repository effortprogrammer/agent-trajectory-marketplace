import { afterAll, afterEach, expect, setDefaultTimeout, test } from "bun:test"
import type { Page } from "playwright"
import {
  closeSessionUiBrowser,
  startSessionUiHarness,
  type SessionUiHarness,
} from "./session-marketplace-playwright.fixture"

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
    await page.locator("[data-nav-menu-toggle]").click()
    await signIn.waitFor({ state: "visible" })
  }
  await signIn.click()
}

const authenticate = async (page: Page): Promise<void> => {
  await openMemberSignIn(page)
  const challengeRequest = page.waitForRequest((request) =>
    new URL(request.url()).pathname === "/api/registry/v1/auth/login"
  )
  await page.locator("[data-auth-email]").fill("owner@example.test")
  await page.locator("[data-auth-request-submit]").click()
  expect(await (await challengeRequest).postDataJSON()).toEqual({
    email: "owner@example.test",
  })
  await page.locator("[data-auth-code]").waitFor({ state: "visible" })

  const verifyRequest = page.waitForRequest((request) =>
    new URL(request.url()).pathname === "/api/registry/v1/auth/verify"
  )
  const statsResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/registry/v1/marketplace/stats"
  )
  await page.locator("[data-auth-code]").fill("654321")
  await page.locator("[data-auth-verify-submit]").click()
  expect(await (await verifyRequest).postDataJSON()).toEqual({
    challengeId: "chal-0123456789abcdef",
    code: "654321",
  })
  await statsResponse
}

const pricingSessions = {
  asOf: "2026-08-31T00:00:00Z",
  ok: true,
  page: { nextCursor: null },
  sessions: [{
    acceptedTokens: 1_000_000,
    accruedCents: 200,
    askCredits: null,
    datasetId: "seller-dataset-fable",
    earnedCredits: null,
    listedAt: "2026-08-31T00:00:00Z",
    model: "claude-fable-5",
    rateCentsPerMillion: 200,
    saleStatus: {
      changedAt: "2026-08-31T00:00:00Z",
      exception: null,
      listingCycleId: "22222222-2222-4222-8222-222222222222",
      stage: "listed",
    },
    sessionId: "11111111-1111-4111-8111-111111111111",
    soldAt: null,
  }, {
    acceptedTokens: 2_000_000,
    accruedCents: 300,
    askCredits: null,
    datasetId: "seller-dataset-sol",
    earnedCredits: null,
    listedAt: "2026-08-30T00:00:00Z",
    model: "gpt-5.6-sol",
    rateCentsPerMillion: 150,
    saleStatus: {
      changedAt: "2026-08-30T00:00:00Z",
      exception: null,
      listingCycleId: "33333333-3333-4333-8333-333333333333",
      stage: "listed",
    },
    sessionId: "33333333-3333-4333-8333-333333333333",
    soldAt: null,
  }],
}

afterEach(async () => {
  if (harness !== undefined) await harness.close()
  harness = undefined
})

afterAll(async () => {
  await closeSessionUiBrowser()
})

test("renders accepted model-token pricing at desktop and mobile widths", async () => {
  harness = await startSessionUiHarness()
  const page = await harness.newPage(desktop)
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  page.on("pageerror", (error) => pageErrors.push(error.message))
  await page.route(
    "**/api/registry/v1/marketplace/seller/sales/sessions",
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
    new URL(response.url()).pathname.endsWith("/seller/sales/sessions")
  )
  await page.getByTestId("seller-console-link").click()
  await sessionsResponse

  const expectedText = [
    "Claude Fable 5",
    "1.0M accepted tokens",
    "$2.00 / 1M",
    "$2.00 earned",
    "GPT-5.6 Sol",
    "2.0M accepted tokens",
    "$1.50 / 1M",
    "$3.00 earned",
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
        expectedText.map((text) => page.getByText(text, { exact: true }).count()),
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
