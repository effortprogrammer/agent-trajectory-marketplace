import { expect, setDefaultTimeout, test } from "bun:test"
import { connect } from "node:net"
import { resolve } from "node:path"

import { parsePayoutRequestResponse } from "../../../src/marketplace/payout-request-contract"

const publicRoot = resolve(import.meta.dir, "../../..")
const testRevision = "0123456789abcdef0123456789abcdef01234567"
const serverReadyTimeoutMs = 30_000
setDefaultTimeout(serverReadyTimeoutMs + 10_000)

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

const waitForReadyOutput = async (
  stream: ReadableStream<Uint8Array>,
): Promise<number> => {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const readyPattern = /marketplace ui: http:\/\/localhost:(\d+)\//
  let output = ""
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error("web server did not print a valid ready URL")),
      serverReadyTimeoutMs,
    )
  })
  try {
    let match = output.match(readyPattern)
    while (match === null) {
      const chunk = await Promise.race([reader.read(), deadline])
      if (chunk.done) throw new Error("web server exited before printing its ready URL")
      output += decoder.decode(chunk.value, { stream: true })
      match = output.match(readyPattern)
    }
    const port = Number.parseInt(match[1] ?? "", 10)
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error("web server printed an invalid ready port")
    }
    return port
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    reader.releaseLock()
  }
}

const rawHttpRequest = (port: number, path: string, host: string): Promise<string> =>
  new Promise((resolveResponse, reject) => {
    const socket = connect({ host: "127.0.0.1", port }, () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`)
    })
    let response = ""
    socket.setEncoding("utf8")
    socket.on("data", (chunk) => {
      response += chunk
    })
    socket.on("end", () => resolveResponse(response))
    socket.on("error", reject)
  })

test("binds every public asset URL to fingerprinted paths so releases cannot reuse stale code", async () => {
  const html = await Bun.file(resolve(publicRoot, "web/index.html")).text()
  const marketplaceScript = await Bun.file(resolve(publicRoot, "web/marketplace.js")).text()
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
  expect(consoleScript).toContain(
    `from "./${consoleContractPath}"`,
  )
})

test("serves immutable versioned account policy documents linked from signup", async () => {
  const version = "2026-08-28"
  const termsPath = `/legal/account-terms/${version}`
  const privacyPath = `/legal/account-privacy/${version}`
  const stylesheetPath = `/legal/assets/${version}.css`
  const server = Bun.spawn(["bun", "web/server.ts"], {
    cwd: publicRoot,
    env: { ...Bun.env, PORT: "0" },
    stderr: "pipe",
    stdout: "pipe",
  })
  try {
    const port = await waitForReadyOutput(server.stdout)

    const [index, terms, privacy, stylesheet] = await Promise.all([
      fetch(`http://127.0.0.1:${port}/`),
      fetch(`http://127.0.0.1:${port}${termsPath}`),
      fetch(`http://127.0.0.1:${port}${privacyPath}`),
      fetch(`http://127.0.0.1:${port}${stylesheetPath}`),
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
  } finally {
    server.kill()
    await server.exited
  }
})

test("proxies public stats for an explicitly configured local preview", async () => {
  const upstream = Bun.serve({
    fetch(request) {
      expect(new URL(request.url).pathname).toBe("/v1/marketplace/public-stats")
      return Response.json({ tradeableTokens: "39048328" })
    },
    hostname: "127.0.0.1",
    port: 0,
  })
  const server = Bun.spawn(["bun", "web/server.ts"], {
    cwd: publicRoot,
    env: {
      ...Bun.env,
      ATM_LOCAL_PUBLIC_STATS_URL:
        `http://127.0.0.1:${upstream.port}/v1/marketplace/public-stats`,
      ATM_ORIGIN_REVISION: testRevision,
      PORT: "0",
    },
    stderr: "pipe",
    stdout: "pipe",
  })
  try {
    const port = await waitForReadyOutput(server.stdout)

    const response = await fetch(`http://127.0.0.1:${port}/api/public-stats`)

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ tradeableTokens: "39048328" })
  } finally {
    server.kill()
    await server.exited
    upstream.stop(true)
  }
})

test("proxies approved Registry auth requests for an explicitly configured local preview", async () => {
  const received: Array<Readonly<{
    authorization: string | null
    body: unknown
    contentType: string | null
    method: string
    path: string
  }>> = []
  const upstream = Bun.serve({
    async fetch(request) {
      received.push({
        authorization: request.headers.get("authorization"),
        body: await request.json(),
        contentType: request.headers.get("content-type"),
        method: request.method,
        path: new URL(request.url).pathname,
      })
      return Response.json({
        challengeId: "chal-0123456789abcdef",
        expiresAt: "2030-01-01T00:00:00.000Z",
        ok: true,
      })
    },
    hostname: "127.0.0.1",
    port: 0,
  })
  const server = Bun.spawn(["bun", "web/server.ts"], {
    cwd: publicRoot,
    env: {
      ...Bun.env,
      ATM_LOCAL_REGISTRY_URL: `http://127.0.0.1:${upstream.port}`,
      ATM_ORIGIN_REVISION: testRevision,
      PORT: "0",
    },
    stderr: "pipe",
    stdout: "pipe",
  })
  try {
    const port = await waitForReadyOutput(server.stdout)

    const response = await fetch(
      `http://127.0.0.1:${port}/api/registry/v1/auth/login`,
      {
        body: JSON.stringify({ email: "owner@example.test" }),
        headers: { accept: "application/json", "content-type": "application/json" },
        method: "POST",
      },
    )
    const signup = await fetch(
      `http://127.0.0.1:${port}/api/registry/v1/auth/signup`,
      {
        body: JSON.stringify({ email: "owner@example.test", acceptTerms: true }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    )
    const rejected = await fetch(
      `http://127.0.0.1:${port}/api/registry/v1/auth/signup`,
      { method: "GET" },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({
      challengeId: "chal-0123456789abcdef",
      expiresAt: "2030-01-01T00:00:00.000Z",
      ok: true,
    })
    expect(signup.status).toBe(200)
    expect(signup.headers.get("cache-control")).toBe("no-store")
    expect(received).toEqual([
      {
        authorization: null,
        body: { email: "owner@example.test" },
        contentType: "application/json",
        method: "POST",
        path: "/v1/auth/login",
      },
      {
        authorization: null,
        body: { email: "owner@example.test", acceptTerms: true },
        contentType: "application/json",
        method: "POST",
        path: "/v1/auth/signup",
      },
    ])
    expect(rejected.status).toBe(404)
    expect(received).toHaveLength(2)
  } finally {
    server.kill()
    await server.exited
    upstream.stop(true)
  }
})

test("proxies approved payout request routes with exact idempotency forwarding", async () => {
  const received: Array<Readonly<{
    authorization: string | null
    body: string | null
    idempotencyKey: string | null
    method: string
    path: string
  }>> = []
  const upstream = Bun.serve({
    async fetch(request) {
      received.push({
        authorization: request.headers.get("authorization"),
        body: request.method === "GET" ? null : await request.text(),
        idempotencyKey: request.headers.get("idempotency-key"),
        method: request.method,
        path: new URL(request.url).pathname,
      })
      if (request.method === "GET") {
        return new Response(
          await Bun.file(resolve(publicRoot, "contract/payout-request/v1/get-empty-200.json")).text(),
          { headers: { "content-type": "application/json" }, status: 200 },
        )
      }
      if (new URL(request.url).pathname.endsWith("/withdraw")) {
        return new Response(
          await Bun.file(resolve(publicRoot, "contract/payout-request/v1/withdrawn-200.json")).text(),
          { headers: { "content-type": "application/json" }, status: 200 },
        )
      }
      return new Response(
        await Bun.file(resolve(publicRoot, "contract/payout-request/v1/requested-201.json")).text(),
        { headers: { "content-type": "application/json" }, status: 201 },
      )
    },
    hostname: "127.0.0.1",
    port: 0,
  })
  const server = Bun.spawn(["bun", "web/server.ts"], {
    cwd: publicRoot,
    env: {
      ...Bun.env,
      ATM_LOCAL_REGISTRY_URL: `http://127.0.0.1:${upstream.port}`,
      ATM_ORIGIN_REVISION: testRevision,
      PORT: "0",
    },
    stderr: "pipe",
    stdout: "pipe",
  })
  try {
    const port = await waitForReadyOutput(server.stdout)
    const operationId = "00000000-0000-4000-8000-000000000301"

    const read = await fetch(
      `http://127.0.0.1:${port}/api/registry/v1/marketplace/seller/payout-request`,
      { headers: { accept: "application/json", authorization: "Bearer session-sentinel" }, method: "GET" },
    )
    const create = await fetch(
      `http://127.0.0.1:${port}/api/registry/v1/marketplace/seller/payout-request`,
      {
        body: "{}",
        headers: {
          accept: "application/json",
          authorization: "Bearer session-sentinel",
          "content-type": "application/json",
          "idempotency-key": operationId,
        },
        method: "POST",
      },
    )
    const withdraw = await fetch(
      `http://127.0.0.1:${port}/api/registry/v1/marketplace/seller/payout-request/withdraw`,
      {
        body: "{}",
        headers: {
          accept: "application/json",
          authorization: "Bearer session-sentinel",
          "content-type": "application/json",
          "idempotency-key": operationId,
        },
        method: "POST",
      },
    )

    expect(received).toEqual([
      { authorization: "Bearer session-sentinel", body: null, idempotencyKey: null, method: "GET", path: "/v1/marketplace/seller/payout-request" },
      { authorization: "Bearer session-sentinel", body: "{}", idempotencyKey: operationId, method: "POST", path: "/v1/marketplace/seller/payout-request" },
      { authorization: "Bearer session-sentinel", body: "{}", idempotencyKey: operationId, method: "POST", path: "/v1/marketplace/seller/payout-request/withdraw" },
    ])
    expect(read.status).toBe(200)
    expect(create.status).toBe(201)
    expect(withdraw.status).toBe(200)
    for (const response of [read, create, withdraw]) {
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(response.headers.get("content-type")).toContain("application/json")
    }
    expect(await read.json()).toEqual({
      ok: true,
      payoutRequest: {
        currency: "USD", thresholdMinor: 10000, availableMinor: 15000, heldMinor: 0, request: null,
      },
    })
    const createdEnvelope = parsePayoutRequestResponse(201, Buffer.from(await create.text()))
    if (!createdEnvelope.ok) throw new Error("expected create envelope")
    expect(createdEnvelope.payoutRequest.request?.status).toBe("requested")
  } finally {
    server.kill()
    await server.exited
    upstream.stop(true)
  }
})

test("rejects wrong payout request methods locally without forwarding", async () => {
  let upstreamRequests = 0
  const upstream = Bun.serve({
    fetch() { upstreamRequests += 1; return new Response("{}", { status: 200 }) },
    hostname: "127.0.0.1",
    port: 0,
  })
  const server = Bun.spawn(["bun", "web/server.ts"], {
    cwd: publicRoot,
    env: {
      ...Bun.env,
      ATM_LOCAL_REGISTRY_URL: `http://127.0.0.1:${upstream.port}`,
      ATM_ORIGIN_REVISION: testRevision,
      PORT: "0",
    },
    stderr: "pipe",
    stdout: "pipe",
  })
  try {
    const port = await waitForReadyOutput(server.stdout)
    const base = `http://127.0.0.1:${port}/api/registry/v1/marketplace/seller/payout-request`

    const put = await fetch(base, { method: "PUT" })
    const deleted = await fetch(base, { method: "DELETE" })
    const withdrawGet = await fetch(`${base}/withdraw`, { method: "GET" })

    expect(put.status).toBe(405)
    expect(put.headers.get("allow")).toBe("GET, POST")
    expect(deleted.status).toBe(405)
    expect(withdrawGet.status).toBe(405)
    expect(withdrawGet.headers.get("allow")).toBe("POST")
    for (const response of [put, deleted, withdrawGet]) {
      expect(response.headers.get("cache-control")).toBe("no-store")
    }
    expect(upstreamRequests).toBe(0)
  } finally {
    server.kill()
    await server.exited
    upstream.stop(true)
  }
})

test("rejects malformed payout bodies, keys, and duplicate headers locally without forwarding", async () => {
  let upstreamRequests = 0
  const upstream = Bun.serve({
    fetch() { upstreamRequests += 1; return new Response("{}", { status: 200 }) },
    hostname: "127.0.0.1",
    port: 0,
  })
  const server = Bun.spawn(["bun", "web/server.ts"], {
    cwd: publicRoot,
    env: {
      ...Bun.env,
      ATM_LOCAL_REGISTRY_URL: `http://127.0.0.1:${upstream.port}`,
      ATM_ORIGIN_REVISION: testRevision,
      PORT: "0",
    },
    stderr: "pipe",
    stdout: "pipe",
  })
  try {
    const port = await waitForReadyOutput(server.stdout)
    const base = `http://127.0.0.1:${port}/api/registry/v1/marketplace/seller/payout-request`
    const operationId = "00000000-0000-4000-8000-000000000302"
    const canonicalHeaders = {
      authorization: "Bearer session-sentinel",
      "content-type": "application/json",
      "idempotency-key": operationId,
    }
    const duplicateAuthorization = new Headers()
    duplicateAuthorization.append("authorization", "Bearer one")
    duplicateAuthorization.append("authorization", "Bearer two")
    duplicateAuthorization.append("content-type", "application/json")
    duplicateAuthorization.append("idempotency-key", operationId)

    const nonEmptyBody = await fetch(base, {
      body: JSON.stringify({ amountMinor: 1 }),
      headers: canonicalHeaders,
      method: "POST",
    })
    const badKey = await fetch(base, {
      body: "{}",
      headers: { ...canonicalHeaders, "idempotency-key": "not-a-uuid" },
      method: "POST",
    })
    const missingKey = await fetch(base, {
      body: "{}",
      headers: { authorization: "Bearer session-sentinel", "content-type": "application/json" },
      method: "POST",
    })
    const wrongContentType = await fetch(base, {
      body: "{}",
      headers: { ...canonicalHeaders, "content-type": "text/plain" },
      method: "POST",
    })
    const duplicatedHeader = await fetch(base, {
      body: "{}",
      headers: duplicateAuthorization,
      method: "POST",
    })

    const expectedError = await Bun.file(
      resolve(publicRoot, "contract/payout-request/v1/error-400-invalid-request.json"),
    ).text()
    for (const response of [nonEmptyBody, badKey, missingKey, wrongContentType, duplicatedHeader]) {
      expect(response.status).toBe(400)
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(await response.text()).toBe(expectedError)
    }
    expect(upstreamRequests).toBe(0)
  } finally {
    server.kill()
    await server.exited
    upstream.stop(true)
  }
})

test("serves session-only public pages without World UI artifacts", async () => {
  const server = Bun.spawn(["bun", "web/server.ts"], {
    cwd: publicRoot,
    env: {
      ...Bun.env,
      ATM_ORIGIN_REVISION: testRevision,
      PORT: "0",
    },
    stderr: "pipe",
    stdout: "pipe",
  })
  try {
    const port = await waitForReadyOutput(server.stdout)
    const baseUrl = `http://127.0.0.1:${port}`

    const root = await fetch(baseUrl)
    const detail = await fetch(`${baseUrl}/detail.html?id=sub_14m3r01jp1wd7a3rm2j719p9vv`, {
      redirect: "manual",
    })
    const stylesheetPath = await fingerprintedAssetPath("marketplace.css")
    const scriptPath = await fingerprintedAssetPath("marketplace.js")
    const consoleStylesheetPath = await fingerprintedAssetPath("console.css")
    const consoleScriptPath = await fingerprintedAssetPath("console.js")
    const consoleContractPath = await fingerprintedAssetPath("console-contract.js")
    const stylesheet = await fetch(`${baseUrl}/${stylesheetPath}`)
    const script = await fetch(`${baseUrl}/${scriptPath}`)
    const consoleStylesheet = await fetch(`${baseUrl}/${consoleStylesheetPath}`)
    const consoleScript = await fetch(`${baseUrl}/${consoleScriptPath}`)
    const consoleContract = await fetch(`${baseUrl}/${consoleContractPath}`)
    const legacyConsoleScript = await fetch(`${baseUrl}/console.js`)
    const invalidAssets = await Promise.all([
      fetch(`${baseUrl}/marketplace.js`),
      fetch(`${baseUrl}/console-contract.js`),
      fetch(`${baseUrl}/marketplace.${"0".repeat(64)}.js`),
      fetch(`${baseUrl}/${scriptPath}?v=duplicate`),
    ])
    const retired = await fetch(
      `${baseUrl}/detail.html?view=world&id=world%2Frefund-unit&registry=https%3A%2F%2Fevil.example`,
      { redirect: "manual" },
    )
    const schemeRelativeRetired = await fetch(
      `${baseUrl}//evil.example/landing?view=world`,
      { redirect: "manual" },
    )
    const pages = [await root.text()]
    const javascript = await script.text()
    const robots = await fetch(`${baseUrl}/robots.txt`)
    const robotsText = await robots.text()
    const favicon = await fetch(`${baseUrl}/favicon.ico`)
    const revision = await fetch(`${baseUrl}/.well-known/atm-origin-revision`)
    const missing = await fetch(`${baseUrl}/not-found`)
    const canonicalRedirect = await fetch(`${baseUrl}/seller?ref=legacy`, {
      headers: { host: "marketplace.getatm.io" },
      redirect: "manual",
    })
    const canonicalDoubleSlashRedirect = await rawHttpRequest(
      port,
      "//attacker.example/payload?ref=legacy",
      "marketplace.getatm.io",
    )

    expect(root.status).toBe(200)
    expect(root.headers.get("cache-control")).toBe("no-store")
    expect(root.headers.get("content-security-policy")).toContain("default-src 'self'")
    expect(root.headers.get("content-security-policy")).toContain(
      "connect-src 'self' https://gateway.getatm.io",
    )
    expect(root.headers.get("content-security-policy")).toContain("frame-ancestors 'none'")
    expect(root.headers.get("x-content-type-options")).toBe("nosniff")
    expect(root.headers.get("x-frame-options")).toBe("DENY")
    expect(root.headers.get("referrer-policy")).toBe("no-referrer")
    expect(root.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    )
    expect(detail.status).toBe(302)
    expect(detail.headers.get("location")).toBe("/index.html")
    expect(root.headers.get("content-type")).toBe("text/html; charset=utf-8")
    expect(stylesheet.status).toBe(200)
    expect(stylesheet.headers.get("content-type")).toBe("text/css; charset=utf-8")
    expect(script.status).toBe(200)
    expect(script.headers.get("content-type")).toBe("text/javascript; charset=utf-8")
    for (const asset of [stylesheet, script, consoleStylesheet, consoleScript, consoleContract]) {
      expect(asset.status).toBe(200)
      expect(asset.headers.get("cache-control")).toBe(
        "public, max-age=31536000, immutable",
      )
      expect(asset.headers.get("content-security-policy")).toContain("script-src 'self'")
      expect(asset.headers.get("x-content-type-options")).toBe("nosniff")
    }
    expect(legacyConsoleScript.status).toBe(200)
    expect(legacyConsoleScript.headers.get("cache-control")).toBe("no-store")
    expect(await legacyConsoleScript.text()).toBe(
      await Bun.file(resolve(publicRoot, "web/console.js")).text(),
    )
    for (const invalidAsset of invalidAssets) {
      expect(invalidAsset.status).toBe(404)
      expect(invalidAsset.headers.get("cache-control")).toBe("no-store")
    }
    expect(consoleStylesheet.headers.get("content-type")).toBe("text/css; charset=utf-8")
    expect(consoleScript.headers.get("content-type")).toBe("text/javascript; charset=utf-8")
    expect(consoleContract.headers.get("content-type")).toBe("text/javascript; charset=utf-8")
    expect(robots.status).toBe(200)
    expect(robots.headers.get("content-type")).toBe("text/plain; charset=utf-8")
    expect(robotsText).toBe("User-agent: *\nAllow: /\n")
    expect(javascript).toContain("https://gateway.getatm.io")
    expect(javascript).not.toContain("localStorage")
    expect(javascript).not.toContain('query.get("registry")')
    expect(retired.status).toBe(302)
    expect(retired.headers.get("location")).toBe("/index.html")
    expect(schemeRelativeRetired.status).toBe(302)
    expect(schemeRelativeRetired.headers.get("location")).toBe("/index.html")
    for (const html of pages) {
      expect(html).toContain('href="marketplace.')
      expect(html).toContain('href="console.')
      expect(html).toContain('src="marketplace.')
      expect(html).toContain('data-console-view')
      expect(html).not.toContain("World pack")
      expect(html).not.toContain("/v1/marketplace/worlds")
      expect(html).not.toContain("data-world")
      expect(html).not.toContain("main-world")
      expect(html).not.toContain("MARKETPLACE_WORLDS_VISIBLE")
      expect(html).not.toContain("data:text/")
    }
    expect(favicon.status).toBe(204)
    expect(revision.status).toBe(200)
    expect(revision.headers.get("cache-control")).toBe("no-store")
    expect(revision.headers.get("x-atm-origin-revision")).toBe(testRevision)
    expect(await revision.json()).toEqual({ revision: testRevision })
    expect(missing.status).toBe(404)
    expect(canonicalRedirect.status).toBe(301)
    expect(canonicalRedirect.headers.get("location")).toBe(
      "https://getatm.io/seller?ref=legacy",
    )
    expect(canonicalDoubleSlashRedirect).toContain("HTTP/1.1 301")
    expect(canonicalDoubleSlashRedirect.toLowerCase()).toContain(
      "location: https://getatm.io//attacker.example/payload?ref=legacy",
    )
  } finally {
    server.kill()
    await server.exited
  }
})

test("rejects a Railway-native source revision", async () => {
  const server = Bun.spawn(["bun", "web/server.ts"], {
    cwd: publicRoot,
    env: {
      ...Bun.env,
      ATM_ORIGIN_REVISION: undefined,
      PORT: "0",
      RAILWAY_GIT_COMMIT_SHA: testRevision,
    },
    stderr: "pipe",
    stdout: "pipe",
  })
  try {
    const port = await waitForReadyOutput(server.stdout)

    const response = await fetch(
      `http://127.0.0.1:${port}/.well-known/atm-origin-revision`,
    )

    expect(response.status).toBe(503)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("x-atm-origin-revision")).toBeNull()
  } finally {
    server.kill()
    await server.exited
  }
})

test("prefers the explicit CLI deployment revision", async () => {
  const cliRevision = "fedcba9876543210fedcba9876543210fedcba98"
  const server = Bun.spawn(["bun", "web/server.ts"], {
    cwd: publicRoot,
    env: {
      ...Bun.env,
      ATM_ORIGIN_REVISION: cliRevision,
      PORT: "0",
      RAILWAY_GIT_COMMIT_SHA: testRevision,
    },
    stderr: "pipe",
    stdout: "pipe",
  })
  try {
    const port = await waitForReadyOutput(server.stdout)

    const response = await fetch(
      `http://127.0.0.1:${port}/.well-known/atm-origin-revision`,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("x-atm-origin-revision")).toBe(cliRevision)
    expect(await response.json()).toEqual({ revision: cliRevision })
  } finally {
    server.kill()
    await server.exited
  }
})
