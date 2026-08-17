import { expect, setDefaultTimeout, test } from "bun:test"
import { connect } from "node:net"
import { resolve } from "node:path"

const publicRoot = resolve(import.meta.dir, "../../..")
setDefaultTimeout(10_000)

const reservePort = (): number => {
  const probe = Bun.serve({ fetch: () => new Response("reserved"), port: 0 })
  const port = probe.port
  probe.stop(true)
  if (port === undefined) throw new Error("port-zero server omitted port")
  return port
}

const waitForReadyOutput = async (
  stream: ReadableStream<Uint8Array>,
  expected: string,
): Promise<void> => {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ""
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`web server did not print ${expected}`)), 5_000)
  })
  try {
    while (!output.includes(expected)) {
      const chunk = await Promise.race([reader.read(), deadline])
      if (chunk.done) throw new Error(`web server exited before printing ${expected}`)
      output += decoder.decode(chunk.value, { stream: true })
    }
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
  const port = reservePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const server = Bun.spawn(["bun", "web/server.ts"], {
    cwd: publicRoot,
    env: { ...Bun.env, PORT: String(port) },
    stderr: "pipe",
    stdout: "pipe",
  })
  try {
    await waitForReadyOutput(server.stdout, `marketplace ui: http://localhost:${port}/`)

    const root = await fetch(baseUrl)
    const detail = await fetch(`${baseUrl}/detail.html?id=sub_14m3r01jp1wd7a3rm2j719p9vv`, {
      redirect: "manual",
    })
    const stylesheet = await fetch(`${baseUrl}/marketplace.css`)
    const script = await fetch(`${baseUrl}/marketplace.js`)
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
      expect(html).toContain('href="marketplace.css"')
      expect(html).toContain('src="marketplace.js"')
      expect(html).not.toContain("World pack")
      expect(html).not.toContain("/v1/marketplace/worlds")
      expect(html).not.toContain("data-world")
      expect(html).not.toContain("main-world")
      expect(html).not.toContain("MARKETPLACE_WORLDS_VISIBLE")
      expect(html).not.toContain("data:text/")
    }
    expect(favicon.status).toBe(204)
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
