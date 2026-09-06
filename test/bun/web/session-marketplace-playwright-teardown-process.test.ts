import { expect, test } from "bun:test"

import {
  closeSessionUiBrowser,
  startSessionUiHarness,
} from "./session-marketplace-playwright.fixture"

test("Given an active context route When its harness closes Then teardown cancels the route", async () => {
  // Given: an active client-version route whose response is controlled by the test.
  const harness = await startSessionUiHarness()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let closing: Promise<void> | undefined

  try {
    const page = await harness.newPage({ height: 900, width: 1_280 })
    await page.context().route("**/index.html", async (route) => {
      entered.resolve()
      await release.promise
      await route.fulfill({ body: "", contentType: "text/html" })
    })

    // When: the route is active while harness teardown begins.
    await page.goto(harness.appUrl, { waitUntil: "domcontentloaded" })
    await entered.promise
    closing = harness.close()
    await closing

    // Then: teardown completes without requiring the active route to resolve.
    expect(page.isClosed()).toBe(true)
  } finally {
    release.resolve()
    try {
      await (closing ?? harness.close())
    } finally {
      await closeSessionUiBrowser()
    }
  }
})
