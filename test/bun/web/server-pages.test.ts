import { expect, setDefaultTimeout, test } from "bun:test"
import { connect } from "node:net"
import { resolve } from "node:path"

import {
  publicRoot,
  testRevision,
} from "./marketplace-handler-test-support"

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
    const rootHtml = await root.text()
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
    expect(root.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    )
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
    for (const asset of [
      stylesheet,
      script,
      consoleStylesheet,
      consoleScript,
      consoleContract,
    ]) {
      expect(asset.status).toBe(200)
      expect(asset.headers.get("cache-control")).toBe(
        "public, max-age=31536000, immutable",
      )
      expect(asset.headers.get("content-security-policy")).toContain(
        "script-src 'self'",
      )
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
    expect(consoleScript.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    )
    expect(consoleContract.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    )
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
    expect(rootHtml).toContain('href="marketplace.')
    expect(rootHtml).toContain('href="console.')
    expect(rootHtml).toContain('src="marketplace.')
    expect(rootHtml).toContain("data-console-view")
    expect(rootHtml).not.toContain("World pack")
    expect(rootHtml).not.toContain("/v1/marketplace/worlds")
    expect(rootHtml).not.toContain("data-world")
    expect(rootHtml).not.toContain("main-world")
    expect(rootHtml).not.toContain("MARKETPLACE_WORLDS_VISIBLE")
    expect(rootHtml).not.toContain("data:text/")
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
