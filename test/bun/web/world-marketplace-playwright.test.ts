import { afterAll, afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import type { Locator, Page, Response } from "playwright"

import {
  closeWorldUiBrowser,
  startWorldUiHarness,
  type WorldUiHarness,
  type WorldUiMockMode,
} from "./world-marketplace-playwright.fixture"

// System Chrome startup and shutdown are part of this browser boundary, not a test retry.
setDefaultTimeout(30_000)

const refundWorld = "world/refund-unit"
const desktop = { height: 900, width: 1440 } as const
const mobile = { height: 844, width: 390 } as const

let harness: WorldUiHarness | undefined

afterEach(async () => {
  if (harness !== undefined) await harness.close()
  harness = undefined
})

afterAll(async () => {
  await closeWorldUiBrowser()
})

const registryUrl = (active: WorldUiHarness): string => encodeURIComponent(active.registryUrl)

const visit = async (
  page: Page,
  active: WorldUiHarness,
  path: string,
): Promise<Response> => {
  const detail = path.includes("detail.html")
  const worldResponse = active.waitForWorldResponse(page, detail)
  const separator = path.includes("?") ? "&" : "?"
  await page.goto(`${active.appUrl}${path}${separator}registry=${registryUrl(active)}`, { waitUntil: "domcontentloaded" })
  return worldResponse
}

const openWorld = async (
  mode: WorldUiMockMode,
  viewport: Readonly<{ readonly height: number; readonly width: number }>,
  path: string,
): Promise<Readonly<{ readonly page: Page; readonly response: Promise<Response> }>> => {
  harness = await startWorldUiHarness(mode)
  const page = await harness.newPage(viewport)
  const response = visit(page, harness, path)
  return { page, response }
}

const attribute = async (locator: Locator, name: string): Promise<string | null> => locator.getAttribute(name)
const text = async (locator: Locator): Promise<string> => (await locator.textContent())?.trim() ?? ""
const visible = async (locator: Locator): Promise<boolean> => locator.isVisible()
const count = async (locator: Locator): Promise<number> => locator.count()

const contrastRatio = async (page: Page): Promise<number> => page.locator("[data-testid='world-marketplace']").evaluate((element) => {
  const rgb = (value: string): readonly number[] => value.match(/\d+/g)?.map(Number) ?? []
  const relativeLuminance = (values: readonly number[]): number => {
    const channels = values.map((value) => {
      const normalized = value / 255
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0)
  }
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  if (style === undefined) throw new Error("World landmark has no document view")
  const foreground = relativeLuminance(rgb(style.color))
  const background = relativeLuminance(rgb(style.backgroundColor))
  return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
})

describe("Todo26 World marketplace browser contract", () => {
  test("renders fixture-exact World list and detail at desktop and mobile screenshots", async () => {
    // Given
    const active = await startWorldUiHarness("ready")
    harness = active
    const configs = [
      { name: "world-list-1440x900.png", path: "/", viewport: desktop },
      { name: "world-list-390x844.png", path: "/", viewport: mobile },
      { name: "world-detail-1440x900.png", path: `/detail.html?id=${encodeURIComponent(refundWorld)}`, viewport: desktop },
      { name: "world-detail-390x844.png", path: `/detail.html?id=${encodeURIComponent(refundWorld)}`, viewport: mobile },
    ] as const
    const pages = await Promise.all(configs.map(async (config) => {
      const page = await active.newPage(config.viewport)
      const response = await visit(page, active, config.path)
      await page.screenshot({ fullPage: true, path: active.screenshotPath(config.name) })
      return { page, response }
    }))

    // When
    const responses = await Promise.all(pages.map(({ response }) => response))

    // Then
    for (const response of responses) expect(response.status()).toBe(200)
    const list = pages[0]?.page
    const detail = pages[2]?.page
    if (list === undefined || detail === undefined) throw new Error("missing World browser page")
    expect(await attribute(list.getByRole("main", { name: "World marketplace" }), "data-testid")).toBe("world-marketplace")
    expect(await attribute(list.locator("link[rel='preconnect']"), "href")).toBe("https://fonts.googleapis.com")
    expect(await attribute(list.locator("link[rel='stylesheet'][href*='fonts.googleapis.com']"), "href")).toBe("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap")
    expect(await attribute(detail.locator("link[rel='preconnect']"), "href")).toBe("https://fonts.googleapis.com")
    expect(await attribute(detail.locator("link[rel='stylesheet'][href*='fonts.googleapis.com']"), "href")).toBe("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap")
    expect(await count(list.locator("[data-testid='world-loading']"))).toBe(0)
    const card = list.locator(`[data-testid='world-card'][data-world-id='${refundWorld}']`)
    expect(await attribute(card, "data-availability")).toBe("both")
    expect(await text(card.locator("[data-testid='world-conformance-status']"))).toBe("passed")
    expect(await attribute(card.getByRole("link", { name: "View world/refund-unit" }), "data-testid")).toBe("world-detail-link")
    expect(await attribute(detail.locator("[data-testid='world-detail']"), "data-world-id")).toBe(refundWorld)
    expect(await attribute(detail.locator("[data-testid='world-version-history']"), "data-world-version")).toBe("fixture/unit")
    expect(await attribute(detail.locator("[data-testid='world-workflow']"), "data-slice-id")).toBe("slice/refund")
    expect(await attribute(detail.locator("[data-testid='world-workflow']"), "data-scenario-id")).toBe("scenario/refund")
    expect(await attribute(detail.locator("[data-testid='world-capability']"), "data-capability-id")).toBe("payments.refund")
    expect(await text(detail.locator("[data-testid='world-availability']"))).toBe("Both hosted and on-prem")
    expect((await text(detail.locator("[data-testid='world-pricing']"))).includes("—")).toBe(true)
    expect(await visible(detail.locator("[data-testid='world-hosted-cta']"))).toBe(true)
    expect(await visible(detail.locator("[data-testid='world-onprem-cta']"))).toBe(true)
  })

  test("renders conformance vector coverage and exclusions from exact detail fixture", async () => {
    // Given
    const opened = await openWorld("ready", desktop, `/detail.html?id=${encodeURIComponent(refundWorld)}`)

    // When
    const response = await opened.response

    // Then
    expect(response.status()).toBe(200)
    const conformance = opened.page.locator("[data-testid='world-conformance']")
    expect(await attribute(conformance, "data-vector-digest")).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
    expect(await attribute(conformance, "data-coverage-covered")).toBe("1")
    expect(await attribute(conformance, "data-coverage-total")).toBe("1")
    expect(await attribute(conformance.locator("[data-dimension='state_diff']"), "data-outcome")).toBe("passed")
    expect(await attribute(opened.page.locator("[data-testid='world-conformance-exclusions']"), "data-unsupported-count")).toBe("0")
    expect(await attribute(opened.page.locator("[data-testid='world-conformance-exclusions']"), "data-ambiguous-count")).toBe("0")
  })

  test("renders an explicit API failure state", async () => {
    // Given
    const opened = await openWorld("api500", desktop, "/")

    // When
    const response = await opened.response

    // Then
    expect(response.status()).toBe(500)
    expect(await attribute(opened.page.locator("[data-testid='world-error']"), "data-status")).toBe("500")
    expect((await text(opened.page.locator("[data-testid='world-error']"))).includes("500")).toBe(true)
  })

  test("renders empty and revoked World results without raw dataset fallback", async () => {
    // Given
    const empty = await openWorld("empty", mobile, "/")
    const emptyResponse = await empty.response
    expect(emptyResponse.status()).toBe(200)
    expect(await visible(empty.page.locator("[data-testid='world-empty']"))).toBe(true)
    const active = harness
    if (active === undefined) throw new Error("missing empty World UI harness")
    await active.close()
    harness = undefined
    const revoked = await openWorld("revoked", mobile, `/detail.html?id=${encodeURIComponent(refundWorld)}`)

    // When
    const revokedResponse = await revoked.response

    // Then
    expect(revokedResponse.status()).toBe(404)
    const revokedPanel = revoked.page.locator("[data-testid='world-revoked']")
    expect(await attribute(revokedPanel, "data-world-id")).toBe(refundWorld)
    expect((await attribute(revokedPanel, "class"))?.split(/\s+/)).toEqual(expect.arrayContaining(["wstatus", "danger"]))
    expect(await count(revoked.page.locator("[data-testid='world-hosted-cta'], [data-testid='world-onprem-cta']")).then((value) => value)).toBe(0)
  })

  test("renders partial conformance and retains unsupported behavior exclusions", async () => {
    // Given
    const opened = await openWorld("partial", desktop, `/detail.html?id=${encodeURIComponent(refundWorld)}`)

    // When
    const response = await opened.response

    // Then
    expect(response.status()).toBe(200)
    expect(await text(opened.page.locator("[data-testid='world-conformance-status']"))).toBe("partial")
    expect(await attribute(opened.page.locator("[data-testid='world-conformance-exclusions']"), "data-unsupported-count")).toBe("1")
    expect(await attribute(opened.page.locator("[data-testid='world-partial']"), "data-dimension")).toBe("state_diff")
  })

  test("provides named landmarks keyboard order contrast and mobile CJK overflow protection", async () => {
    // Given
    const opened = await openWorld("cjk", mobile, "/")

    // When
    const response = await opened.response

    // Then
    expect(response.status()).toBe(200)
    expect(await visible(opened.page.getByRole("main", { name: "World marketplace" }))).toBe(true)
    expect(await count(opened.page.getByRole("heading", { level: 1, name: "Worlds" }))).toBe(1)
    await opened.page.keyboard.press("Tab")
    expect(await attribute(opened.page.locator(":focus"), "data-testid")).toBe("world-skip-link")
    await opened.page.keyboard.press("Tab")
    expect(await attribute(opened.page.locator(":focus"), "data-testid")).toBe("world-detail-link")
    expect(await contrastRatio(opened.page)).toBeGreaterThanOrEqual(4.5)
    expect(await opened.page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    const cjkCard = opened.page.locator("[data-testid='world-card'][data-world-id='world/환불-처리-단위-장문-식별자']")
    expect(await cjkCard.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  })
})
