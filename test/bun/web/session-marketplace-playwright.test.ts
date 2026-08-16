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

afterEach(async () => {
  if (harness !== undefined) await harness.close()
  harness = undefined
})

afterAll(async () => {
  await closeSessionUiBrowser()
})

const trackErrors = (page: Page): string[] => {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  return errors
}

describe("Aggregate marketplace browser contract", () => {
  test("renders aggregate corpus supply without dataset listings", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)
    const consoleErrors = trackErrors(page)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await page.getByTestId("aggregate-session-count").waitFor({ state: "visible" })

    expect(await page.title()).toBe("ATM — Agent Trajectory Marketplace")
    expect(await page.getByTestId("aggregate-session-count").innerText()).toBe("2")
    expect(await page.getByTestId("aggregate-token-count").innerText()).toBe("940.6K")
    expect(await page.getByTestId("aggregate-runtime-count").innerText()).toBe("1")
    expect(await page.getByTestId("aggregate-status").evaluate((element) =>
      element.classList.contains("is-live")
    )).toBe(true)
    expect(await page.locator("[data-metric-skeleton]:visible").count()).toBe(0)
    expect(await page.locator(".catalog, .entry, a[href*='detail.html']").count()).toBe(0)
    expect(await page.getByText("Acquire", { exact: true }).count()).toBe(0)
    expect(harness.registryRequests).toEqual(["/v1/marketplace/stats"])
    expect(await page.locator('[id*="world" i], [data-world]').count()).toBe(0)
    expect((await page.locator("body").innerText()).toLowerCase()).not.toContain("world pack")
    expect(consoleErrors).toEqual([])
  })

  test("redirects retired dataset and World URLs to aggregate supply", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)
    const retiredUrls = [
      "/detail.html?id=sub_14m3r01jp1wd7a3rm2j719p9vv",
      "/detail.html?view=world&id=world%2Frefund-unit",
      "/index.html?view=world",
      "/?view=world",
    ]

    for (const path of retiredUrls) {
      await page.goto(`${harness.appUrl}${path}`, { waitUntil: "networkidle" })
      const expectedPath = path.startsWith("/detail.html")
        ? "/index.html"
        : new URL(path, harness.appUrl).pathname
      expect(new URL(page.url()).pathname).toBe(expectedPath)
      expect(new URL(page.url()).search).toBe("")
      expect(await page.getByTestId("aggregate-token-count").innerText()).toBe("940.6K")
      expect(await page.locator('[id*="world" i], [data-world]').count()).toBe(0)
    }
  })

  test("keeps keyboard order and aggregate metrics usable on mobile", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(mobile)

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })
    await page.getByTestId("aggregate-session-count").waitFor({ state: "visible" })
    await page.keyboard.press("Tab")

    expect(await page.locator(":focus").getAttribute("data-testid")).toBe("session-skip-link")
    expect(await page.getByTestId("aggregate-session-count").isVisible()).toBe(true)
    expect(await page.getByTestId("aggregate-token-count").isVisible()).toBe(true)
    expect(await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false)
    expect(await page.locator("header").count()).toBe(1)
    expect(await page.locator("main").count()).toBe(1)
    expect(await page.locator("footer").count()).toBe(1)
  })

  test("shows a completed unavailable state when Registry stats fail", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)
    await page.route("https://gateway.getatm.io/v1/marketplace/stats", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ error: "unavailable" }),
        contentType: "application/json",
        status: 503,
      })
    })

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })

    expect(await page.getByTestId("aggregate-status").innerText()).toBe("Registry unavailable")
    expect(await page.locator("[data-supply-region]").getAttribute("aria-busy")).toBe("false")
    expect(await page.getByTestId("aggregate-session-count").innerText()).toBe("—")
    expect(await page.getByTestId("aggregate-token-count").innerText()).toBe("—")
    expect(await page.getByTestId("aggregate-runtime-count").innerText()).toBe("—")
  })

  test("rejects malformed aggregate stats as unavailable", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)
    await page.route("https://gateway.getatm.io/v1/marketplace/stats", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          activeRuntimes: 1,
          totalSessions: null,
          tradeableTokens: "many",
        }),
        contentType: "application/json",
        status: 200,
      })
    })

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })

    expect(await page.getByTestId("aggregate-status").innerText()).toBe("Registry unavailable")
    expect(await page.locator("[data-supply-region]").getAttribute("aria-busy")).toBe("false")
    expect(await page.getByTestId("aggregate-session-count").innerText()).toBe("—")
    expect(await page.getByTestId("aggregate-token-count").innerText()).toBe("—")
    expect(await page.getByTestId("aggregate-runtime-count").innerText()).toBe("—")
  })

  test("copies the candidate publish command", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(desktop)
    await page.context().grantPermissions(
      ["clipboard-read", "clipboard-write"],
      { origin: harness.appUrl },
    )
    await page.goto(harness.appUrl, { waitUntil: "networkidle" })

    await page.getByRole("button", { name: "Copy" }).click()
    await page.getByRole("button", { name: "Copied" }).waitFor()

    expect(await page.getByRole("button", { name: "Copied" }).count()).toBe(1)
    expect(await page.locator("[data-copy-status]").innerText()).toBe(
      "Command copied to clipboard",
    )
  })

  test("shows a static supply fallback without JavaScript", async () => {
    harness = await startSessionUiHarness()
    const page = await harness.newPage(mobile, { javaScriptEnabled: false })

    await page.goto(harness.appUrl, { waitUntil: "networkidle" })

    expect(await page.locator(".noscript-supply").isVisible()).toBe(true)
    expect(await page.locator("[data-supply-region]").isVisible()).toBe(false)
    expect(await page.locator("[data-registry-status]").isVisible()).toBe(false)
    expect(await page.locator("[data-metric-skeleton]:visible").count()).toBe(0)
    expect(await page.locator("[data-reveal]:not([data-supply-region]):visible").count()).toBe(
      await page.locator("[data-reveal]:not([data-supply-region])").count(),
    )
  })
})
