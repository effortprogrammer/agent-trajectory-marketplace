import { afterAll, afterEach, describe, expect, test } from "bun:test"
import {
  closeSessionUiBrowser,
  startSessionUiHarness,
  type SessionUiHarness,
} from "./session-marketplace-playwright.fixture"

let harness: SessionUiHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})
afterAll(closeSessionUiBrowser)

describe("client update asset integrity", () => {
  test.each(["missing", "wrong-bytes", "wrong-type", "redirect"] as const)(
    "withholds Reload when a well-shaped candidate asset is %s",
    async (scenario) => {
      // Given a valid-looking fingerprint whose asset cannot safely load.
      harness = await startSessionUiHarness()
      const page = await harness.newPage({ width: 1280, height: 900 })
      const html = await (await page.request.get(`${harness.appUrl}/index.html`)).text()
      const entry = html.match(/src="(marketplace\.[a-f0-9]{64}\.js)"/)?.[1]
      if (entry === undefined) throw new Error("Missing fixture entry")
      let nextEntry = `marketplace.${"0".repeat(64)}.js`
      let nextHtml = html.replace(entry, nextEntry)
      switch (scenario) {
        case "missing": break
        case "wrong-bytes":
          await page.route(`**/${nextEntry}`, (route) => route.fulfill({
            body: "/* bytes do not match the advertised digest */",
            contentType: "text/javascript",
          }))
          break
        case "wrong-type": {
          const body = "<html>not a module</html>"
          const digest = new Bun.CryptoHasher("sha256").update(body).digest("hex")
          nextEntry = `marketplace.${digest}.js`
          nextHtml = html.replace(entry, nextEntry)
          await page.route(`**/${nextEntry}`, (route) => route.fulfill({
            body,
            contentType: "text/html",
          }))
          break
        }
        case "redirect": {
          const stylesheet = html.match(/href="(console\.[a-f0-9]{64}\.css)"/)?.[1]
          if (stylesheet === undefined) throw new Error("Missing fixture stylesheet")
          nextEntry = stylesheet.replace("console.", "client-extra.")
          nextHtml = html.replace("</head>", `<link rel="stylesheet" href="${nextEntry}"></head>`)
          await page.route(`**/${nextEntry}`, (route) => route.fulfill({
            status: 302,
            headers: { location: `/${stylesheet}` },
          }))
          break
        }
        default: {
          const unreachable: never = scenario
          throw new Error(`Unexpected asset scenario: ${unreachable}`)
        }
      }
      await page.route("**/index.html", (route) => route.fulfill({
        body: nextHtml,
        contentType: "text/html",
      }))
      let navigations = 0
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) navigations += 1
      })

      // When the loaded client checks the candidate document.
      await page.goto(harness.appUrl, { waitUntil: "domcontentloaded" })
      const outcome = page.locator(
        '[data-client-update][data-update-state="available"], '
        + '[data-client-update][data-update-state="unavailable"]',
      )
      await outcome.waitFor({ state: "attached" })

      // Then a broken client is never offered as an update.
      expect(await outcome.getAttribute("data-update-state")).toBe("unavailable")
      expect(await outcome.isVisible()).toBe(false)
      expect(navigations).toBe(1)
    },
    15_000,
  )

  test("keeps one credential-free operation pending through asset verification", async () => {
    // Given a valid new stylesheet whose response is explicitly held.
    harness = await startSessionUiHarness()
    const page = await harness.newPage({ width: 1280, height: 900 })
    const html = await (await page.request.get(`${harness.appUrl}/index.html`)).text()
    const css = "/* verified update stylesheet */"
    const digest = new Bun.CryptoHasher("sha256").update(css).digest("hex")
    const asset = `client-extra.${digest}.css`
    const nextHtml = html.replace("</head>", `<link rel="stylesheet" href="${asset}"></head>`)
    await page.addInitScript((target) => {
      const nativeFetch = globalThis.fetch.bind(globalThis)
      Object.defineProperty(globalThis, "fetch", {
        value: (input: string | URL | Request, options?: RequestInit) => {
          if (typeof input === "string" && input.endsWith(target)) {
            Object.defineProperty(globalThis, "qaAssetCache", {
              configurable: true,
              value: options?.cache,
            })
          }
          return nativeFetch(input, options)
        },
      })
    }, asset)
    await page.context().addCookies([{
      name: "qa-cookie",
      value: "must-not-be-sent",
      url: harness.appUrl,
    }])
    const release = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    let checks = 0
    let assetReads = 0
    const credentials: Readonly<{ cookie: string | null; authorization: string | null }>[] = []
    await page.route("**/index.html", async (route) => {
      checks += 1
      credentials.push({
        cookie: await route.request().headerValue("cookie"),
        authorization: await route.request().headerValue("authorization"),
      })
      await route.fulfill({ body: nextHtml, contentType: "text/html" })
    })
    await page.route(`**/${asset}`, async (route) => {
      assetReads += 1
      credentials.push({
        cookie: await route.request().headerValue("cookie"),
        authorization: await route.request().headerValue("authorization"),
      })
      started.resolve()
      await release.promise
      await route.fulfill({ body: css, contentType: "text/css" })
    })
    try {
      // When additional return events arrive during verification.
      await page.goto(harness.appUrl, { waitUntil: "domcontentloaded" })
      await Promise.race([
        started.promise,
        page.locator('[data-client-update][data-update-state="available"]')
          .waitFor({ state: "attached" }),
      ])
      expect(await page.locator("[data-client-update]").getAttribute("data-update-state")).toBe("checking")
      await page.locator("body").evaluate((node) => {
        const view = node.ownerDocument.defaultView
        if (view === null) throw new Error("Missing fixture window")
        for (const name of ["focus", "pageshow", "focus"]) view.dispatchEvent(new Event(name))
      })

      // Then the operation remains single-flight until verified bytes arrive.
      expect(checks).toBe(1)
      expect(assetReads).toBe(1)
      expect(credentials).toEqual([
        { cookie: null, authorization: null },
        { cookie: null, authorization: null },
      ])
      expect(await page.evaluate(() => {
        const mode: unknown = Reflect.get(globalThis, "qaAssetCache")
        return typeof mode === "string" ? mode : null
      })).toBe("no-store")
      expect(await page.locator("[data-client-update]").isVisible()).toBe(false)
      release.resolve()
      await page.locator('[data-client-update][data-update-state="available"]').waitFor()
    } finally {
      release.resolve()
      await page.unrouteAll({ behavior: "wait" })
    }
  }, 15_000)

  test("hides a previously verified Reload while a later candidate is unverified", async () => {
    // Given an already visible notice backed by a valid candidate.
    harness = await startSessionUiHarness()
    const page = await harness.newPage({ width: 1280, height: 900 })
    const html = await (await page.request.get(`${harness.appUrl}/index.html`)).text()
    const css = "/* first verified candidate */"
    const digest = new Bun.CryptoHasher("sha256").update(css).digest("hex")
    const validAsset = `client-first.${digest}.css`
    const missingAsset = `client-next.${"0".repeat(64)}.css`
    let latest = html.replace("</head>", `<link rel="stylesheet" href="${validAsset}"></head>`)
    await page.route("**/index.html", (route) => route.fulfill({
      body: latest,
      contentType: "text/html",
    }))
    await page.route(`**/${validAsset}`, (route) => route.fulfill({
      body: css,
      contentType: "text/css",
    }))
    const release = Promise.withResolvers<void>()
    await page.route(`**/${missingAsset}`, async (route) => {
      await release.promise
      await route.fulfill({ status: 404, body: "Not found", contentType: "text/plain" })
    })
    try {
      await page.goto(harness.appUrl, { waitUntil: "domcontentloaded" })
      await page.locator('[data-client-update][data-update-state="available"]').waitFor()

      // When a different, invalid candidate is checked with its response held.
      latest = html.replace("</head>", `<link rel="stylesheet" href="${missingAsset}"></head>`)
      const pending = page.waitForRequest((request) => request.url().endsWith(missingAsset))
      await page.locator("body").evaluate((node) => {
        node.ownerDocument.defaultView?.dispatchEvent(new Event("focus"))
      })
      await pending

      // Then no previously verified Reload remains actionable during the check.
      expect(await page.locator("[data-client-update]").getAttribute("data-update-state")).toBe("checking")
      expect(await page.locator("[data-client-update]").isVisible()).toBe(false)
      expect(await page.locator("[data-client-reload]:visible").count()).toBe(0)
      expect(await page.locator("body").evaluate((node) => node.classList.contains("has-client-update"))).toBe(false)
      release.resolve()
      await page.locator('[data-client-update][data-update-state="unavailable"]').waitFor({ state: "attached" })
      expect(await page.locator("[data-client-update]").isVisible()).toBe(false)
    } finally {
      release.resolve()
      await page.unrouteAll({ behavior: "wait" })
    }
  }, 15_000)
})
