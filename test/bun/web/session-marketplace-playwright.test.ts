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

const openMemberSignIn = async (page: Page): Promise<void> => {
  if (!await page.locator("[data-auth-gate]").isVisible()) {
    await page.getByTestId("request-access-button").click()
  }
  await page.locator("[data-auth-mode=login]").click()
}

const authenticate = async (page: Page): Promise<void> => {
  await openMemberSignIn(page)
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
  test("shows public token volume while withholding member aggregates", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })

    expect(await page.locator("#top").isVisible()).toBe(true)
    expect(await page.locator("[data-auth-gate]").isVisible()).toBe(false)
    expect(await page.locator("[data-supply-locked]").isVisible()).toBe(true)
    expect(await page.getByTestId("public-token-count").count()).toBe(1)
    expect(await page.getByTestId("public-token-count").innerText()).toBe("39,048,328")
    expect(await page.getByTestId("public-token-count").evaluate((element) => {
      const range = element.ownerDocument.createRange()
      range.selectNodeContents(element)
      return range.getClientRects().length
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

  test("copies the exact installer from the simplified seller hero", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop, {
      permissions: ["clipboard-read", "clipboard-write"],
    })

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })

    const command =
      "curl -fsSL https://github.com/effortprogrammer/agent-trajectory-marketplace/releases/latest/download/install-agent.sh | bash -s -- --dir atm"
    expect(await page.locator(".corpus-console").count()).toBe(0)
    expect(await page.locator("#publish").count()).toBe(0)
    expect(await page.locator("#top .signal-button").getAttribute("href")).toBe(
      "#install-command",
    )
    expect(await page.locator("#install-command").innerText()).toBe(command)
    await page.locator('[data-copy-target="install-command"]').click()
    expect(await page.evaluate<string>("navigator.clipboard.readText()")).toBe(command)
    expect(await page.locator("[data-copy-status]").innerText()).toBe(
      "Command copied to clipboard",
    )
  })

  test("separates buyer access from approval-free seller onboarding", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })

    expect(await page.getByTestId("request-access-button").innerText()).toBe(
      "Request buyer access",
    )
    expect(await page.getByTestId("seller-onboarding-note").innerText()).toContain(
      "No approval required",
    )
    await page.getByTestId("request-access-button").click()
    expect(await page.locator("[data-auth-mode=waitlist]").innerText()).toBe(
      "Buyer access",
    )
    expect(await page.locator("[data-auth-description]").innerText()).toContain(
      "license agent-session datasets",
    )
    expect(await page.locator("[data-auth-mode=login]").innerText()).toBe(
      "Member sign in",
    )
    await page.locator("[data-auth-mode=login]").click()
    expect(await page.locator("[data-auth-console-path]").innerText()).toBe(
      "ATM / member-sign-in",
    )
    expect(await page.locator("[data-auth-kicker]").innerText()).toBe(
      "Existing member",
    )
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
    expect(await page.getByTestId("aggregate-status").evaluate((element) =>
      element.classList.contains("is-live"),
    )).toBe(true)
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

  test("posts a waitlist request, preserves its acknowledgment, and keeps member login available", async () => {
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
    await page.locator("[data-auth-mode=login]").click()
    expect(await page.locator("[data-auth-request-form]").isVisible()).toBe(true)
    expect(await page.locator("[data-auth-accept-contact]").isVisible()).toBe(false)
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
    expect(await page.locator("#top").isVisible()).toBe(true)
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
    await page.route("https://gateway.getatm.io/v1/auth/login", async (route) => {
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
})
