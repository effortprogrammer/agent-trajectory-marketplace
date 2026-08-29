import { expect, test } from "bun:test"
import { resolve } from "node:path"

import {
  createTestHandler,
  publicRoot,
  testRevision,
} from "./marketplace-handler-test-support"

const assetDigest = async (file: string): Promise<string> =>
  new Bun.CryptoHasher("sha256")
    .update(await Bun.file(resolve(publicRoot, "web", file)).arrayBuffer())
    .digest("hex")

const fingerprintedAssetPath = async (file: string): Promise<string> => {
  const extensionOffset = file.lastIndexOf(".")
  if (extensionOffset <= 0) throw new Error(`asset has no extension: ${file}`)
  const digest = await assetDigest(file)
  return `${file.slice(0, extensionOffset)}.${digest}${file.slice(extensionOffset)}`
}

test("binds every public asset URL to fingerprinted paths so releases cannot reuse stale code", async () => {
  const html = await Bun.file(resolve(publicRoot, "web/index.html")).text()
  const marketplaceScript = await Bun.file(
    resolve(publicRoot, "web/marketplace.js"),
  ).text()
  const consoleScript = await Bun.file(resolve(publicRoot, "web/console.js")).text()
  const marketplaceStylesheet = await fingerprintedAssetPath("marketplace.css")
  const consoleStylesheet = await fingerprintedAssetPath("console.css")
  const marketplaceScriptPath = await fingerprintedAssetPath("marketplace.js")
  const consoleScriptPath = await fingerprintedAssetPath("console.js")
  const consoleContractPath = await fingerprintedAssetPath("console-contract.js")

  expect(html).toContain(`href="${marketplaceStylesheet}"`)
  expect(html).toContain(`href="${consoleStylesheet}"`)
  expect(html).toContain(`src="${marketplaceScriptPath}"`)
  expect(marketplaceScript).toContain(
    `import { mountSellerConsole } from "./${consoleScriptPath}";`,
  )
  expect(marketplaceScript).not.toContain(`import("./${consoleScriptPath}")`)
  expect(consoleScript).toContain(`from "./${consoleContractPath}"`)
})

test("serves immutable versioned account policy documents linked from signup", async () => {
  const version = "2026-08-28"
  const termsPath = `/legal/account-terms/${version}`
  const privacyPath = `/legal/account-privacy/${version}`
  const stylesheetPath = `/legal/assets/${version}.css`
  const handler = await createTestHandler()

  const [index, terms, privacy, stylesheet] = await Promise.all([
    handler(new Request("https://getatm.io/")),
    handler(new Request(`https://getatm.io${termsPath}`)),
    handler(new Request(`https://getatm.io${privacyPath}`)),
    handler(new Request(`https://getatm.io${stylesheetPath}`)),
  ])
  const indexHtml = await index.text()
  const termsHtml = await terms.text()
  const privacyHtml = await privacy.text()

  expect(indexHtml).toContain(`href="${termsPath}"`)
  expect(indexHtml).toContain(`href="${privacyPath}"`)
  for (const response of [terms, privacy, stylesheet]) {
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    )
  }
  expect(terms.headers.get("content-type")).toBe("text/html; charset=utf-8")
  expect(privacy.headers.get("content-type")).toBe("text/html; charset=utf-8")
  expect(stylesheet.headers.get("content-type")).toBe("text/css; charset=utf-8")
  expect(termsHtml).toContain(
    `<meta name="atm-policy-kind" content="account-terms">`,
  )
  expect(termsHtml).toContain(
    `<meta name="atm-policy-version" content="${version}">`,
  )
  expect(privacyHtml).toContain(
    `<meta name="atm-policy-kind" content="account-privacy">`,
  )
  expect(privacyHtml).toContain(
    `<meta name="atm-policy-version" content="${version}">`,
  )
})

test("rejects a Railway-native source revision", async () => {
  const handler = await createTestHandler({ revision: null })

  const response = await handler(
    new Request("https://getatm.io/.well-known/atm-origin-revision"),
  )

  expect(response.status).toBe(503)
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(response.headers.get("x-atm-origin-revision")).toBeNull()
})

test("prefers the explicit CLI deployment revision", async () => {
  const cliRevision = "fedcba9876543210fedcba9876543210fedcba98"
  const handler = await createTestHandler({ revision: cliRevision })

  const response = await handler(
    new Request("https://getatm.io/.well-known/atm-origin-revision"),
  )

  expect(response.status).toBe(200)
  expect(response.headers.get("x-atm-origin-revision")).toBe(cliRevision)
  expect(await response.json()).toEqual({ revision: cliRevision })
  expect(cliRevision).not.toBe(testRevision)
})
