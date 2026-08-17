import { afterAll, afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
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

const authenticate = async (page: Page): Promise<void> => {
  const challengeRequest = page.waitForRequest((request) =>
    new URL(request.url()).pathname === "/v1/auth/login",
  )
  await page.locator("[data-auth-email]").fill("owner@example.test")
  await page.locator("[data-auth-request-submit]").click()
  const challenge = await challengeRequest
  expect(await challenge.postDataJSON()).toEqual({ email: "owner@example.test" })
  await page.locator("[data-auth-code]").waitFor({ state: "visible" })

  const verifyRequest = page.waitForRequest((request) =>
    new URL(request.url()).pathname === "/v1/auth/verify",
  )
  const statsResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/v1/marketplace/stats",
  )
  await page.locator("[data-auth-code]").fill("654321")
  await page.locator("[data-auth-verify-submit]").click()
  const verify = await verifyRequest
  expect(await verify.postDataJSON()).toEqual({ challengeId: "chal-0123456789abcdef", code: "654321" })
  await statsResponse
}

afterEach(async () => {
  if (harness !== undefined) await harness.close()
  harness = undefined
})

afterAll(async () => {
  await closeSessionUiBrowser()
})

describe("authenticated aggregate marketplace browser contract", () => {
  test("withholds aggregate supply and makes no marketplace request before login", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })

    expect(await page.locator("[data-auth-gate]").isVisible()).toBe(true)
    expect(await page.locator("[data-authenticated-content]:visible").count()).toBe(0)
    expect(await page.locator("[data-authenticated-nav]:visible").count()).toBe(0)
    expect(await page.locator("[data-session-count]:visible, [data-token-count]:visible").count()).toBe(0)
    expect(harness.registryRequests).toEqual([])
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
    expect(await page.getByTestId("aggregate-status").evaluate((element) =>
      element.classList.contains("is-live"),
    )).toBe(true)
    expect(await page.evaluate<number>("sessionStorage.length")).toBe(0)
    expect(await page.evaluate<boolean>(
      "document.activeElement?.id === 'main-content'",
    )).toBe(true)
    expect(await page.locator("[data-authenticated-nav]:visible").count()).toBe(1)
    expect(harness.registryRequests).toContainEqual({
      authorization: "Bearer marketplace-browser-session-token",
      body: undefined,
      method: "GET",
      path: "/v1/marketplace/stats",
    })
  })

  test("sends the signup contract before OTP verification", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await page.locator("[data-auth-mode=signup]").click()
    await page.locator("[data-auth-email]").fill("OWNER@example.test")
    await page.locator("[data-auth-accept-terms]").check()
    const request = page.waitForRequest((candidate) =>
      new URL(candidate.url()).pathname === "/v1/auth/signup",
    )
    const response = page.waitForResponse((candidate) =>
      new URL(candidate.url()).pathname === "/v1/auth/signup",
    )
    await page.locator("[data-auth-request-submit]").click()
    const signup = await request
    await response

    expect(await signup.postDataJSON()).toEqual({ acceptTerms: true, email: "owner@example.test" })
    expect(await page.locator("[data-auth-code]").isVisible()).toBe(true)
    expect(harness.registryRequests.some((entry) => entry.path === "/v1/marketplace/stats")).toBe(false)
  })

  test("clears an unauthorized session and permits a new login", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)
    let statsAttempts = 0
    await page.route("https://gateway.getatm.io/v1/marketplace/stats", async (route) => {
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
      new URL(request.url()).pathname === "/v1/auth/logout",
    )
    const logoutResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/v1/auth/logout",
    )
    await page.getByTestId("auth-logout-button").click()
    const logout = await logoutRequest
    await logoutResponse

    expect(logout.headers().authorization).toBe("Bearer marketplace-browser-session-token")
    expect(await page.locator("[data-auth-gate]").isVisible()).toBe(true)
    expect(await page.locator("[data-authenticated-content]:visible").count()).toBe(0)
  })

  test("keeps the user signed in when remote logout revocation fails", async () => {
    harness = await startSessionUiHarness()
    harness.setLogoutStatus(503)
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)
    const logoutResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/v1/auth/logout",
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

    expect(await page.locator("[data-auth-gate]").isVisible()).toBe(true)
    expect(await page.locator("[data-authenticated-content]:visible").count()).toBe(0)
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
    await page.route("https://gateway.getatm.io/v1/auth/login", async (route) => {
      await route.fulfill({
        headers: { location: "https://evil.example/otp" },
        status: 307,
      })
    })

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await page.locator("[data-auth-email]").fill("owner@example.test")
    await page.locator("[data-auth-request-submit]").click()
    await page.waitForFunction(
      "document.querySelector('[data-auth-request-submit]')?.disabled === false",
    )

    expect(redirectedRequests).toEqual([])
    expect(await page.locator("[data-auth-gate]").isVisible()).toBe(true)
    expect(await page.locator("[data-auth-verify-form]:visible").count()).toBe(0)
  })

  test("ignores a verification response after the user restarts login", async () => {
    harness = await startSessionUiHarness()
    const releaseVerify = harness.holdVerify()
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await page.locator("[data-auth-email]").fill("owner@example.test")
    await page.locator("[data-auth-request-submit]").click()
    await page.locator("[data-auth-code]").waitFor({ state: "visible" })
    await page.locator("[data-auth-code]").fill("654321")
    const verifyRequest = page.waitForRequest((request) =>
      new URL(request.url()).pathname === "/v1/auth/verify",
    )
    const verifyResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/v1/auth/verify",
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

  test("keeps mobile supply labels below the fixed navigation", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(mobile)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await authenticate(page)
    await page.locator('a.signal-button[href="#supply"]').click()
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

  test("retired detail URLs keep users at the sign-in gate", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)

    await page.goto(`${harness.appUrl}/detail.html?id=sub_14m3r01jp1wd7a3rm2j719p9vv`, { waitUntil: "networkidle" })

    expect(new URL(page.url()).pathname).toBe("/index.html")
    expect(await page.locator("[data-auth-gate]").isVisible()).toBe(true)
    expect(harness.registryRequests).toEqual([])
  })

  test("keeps the sign-in gate usable without horizontal overflow on mobile", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(mobile)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await page.keyboard.press("Tab")

    expect(await page.locator(":focus").getAttribute("data-testid")).toBe("session-skip-link")
    expect(await page.locator("[data-auth-gate]").isVisible()).toBe(true)
    expect(await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false)
  })

  test("does not expose supply when JavaScript is unavailable", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(mobile, { javaScriptEnabled: false })

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })

    expect(await page.locator("[data-auth-gate]").isVisible()).toBe(true)
    expect(await page.locator("[data-authenticated-content]:visible").count()).toBe(0)
    expect(harness.registryRequests).toEqual([])
  })
})
