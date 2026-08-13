import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { chromium, type Browser, type BrowserContext, type Page } from "playwright"

import {
  worldCatalogDetailResponseSchema,
  worldCatalogListResponseSchema,
  type WorldCatalogDetailResponse,
  type WorldCatalogListResponse,
} from "../../../src/worlds/contracts"

const catalogPath = "/v1/marketplace/worlds"
const publicRoot = resolve(import.meta.dir, "../../..")
let sharedBrowser: Browser | undefined
const publicJson = (value: unknown, init?: ResponseInit): Response => Response.json(value, {
  ...init,
  headers: { "access-control-allow-origin": "*", ...init?.headers },
})

export const worldUiMockModes = [
  "ready",
  "api500",
  "empty",
  "revoked",
  "partial",
  "cjk",
] as const

export type WorldUiMockMode = (typeof worldUiMockModes)[number]

export type WorldUiHarness = Readonly<{
  readonly appUrl: string
  readonly registryUrl: string
  readonly screenshotPath: (name: string) => string
  readonly waitForWorldResponse: (page: Page, detail: boolean) => Promise<import("playwright").Response>
  readonly newPage: (viewport: Readonly<{ readonly height: number; readonly width: number }>) => Promise<Page>
  readonly close: () => Promise<void>
}>

const fixture = async <T>(
  name: string,
  parse: (value: unknown) => T,
): Promise<T> => parse(JSON.parse(await readFile(join(publicRoot, "contract/world/v1", name), "utf8")))

const partialDetail = (detail: WorldCatalogDetailResponse): WorldCatalogDetailResponse => {
  const firstDimension = detail.conformance.vector[0]
  if (firstDimension === undefined) throw new Error("Todo25 detail fixture has no conformance vector")
  return worldCatalogDetailResponseSchema.parse({
    ...detail,
    conformanceStatus: "partial",
    conformance: {
      ...detail.conformance,
      status: "partial",
      vector: [{
        ...firstDimension,
        denominator: 2,
        outcome: "partial",
        unsupported: 1,
      }],
      coverageTotal: 2,
      unsupportedCount: 1,
    },
  })
}

const cjkDetail = (detail: WorldCatalogDetailResponse): WorldCatalogDetailResponse =>
  worldCatalogDetailResponseSchema.parse({
    ...detail,
    familyKey: "family/환불-처리-단위",
    worldId: "world/환불-처리-단위-장문-식별자",
  })

const listFor = (
  list: WorldCatalogListResponse,
  detail: WorldCatalogDetailResponse,
): WorldCatalogListResponse => worldCatalogListResponseSchema.parse({
  worlds: [{
    ...list.worlds[0],
    availability: detail.availability,
    conformanceStatus: detail.conformanceStatus,
    worldId: detail.worldId,
  }],
})

const reservePort = (): number => {
  const probe = Bun.serve({ fetch: () => new Response("reserved"), port: 0 })
  const port = probe.port
  probe.stop(true)
  if (port === undefined) throw new Error("port-zero server omitted port")
  return port
}

const waitForReadyOutput = async (stream: ReadableStream<Uint8Array>, expected: string): Promise<void> => {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ""
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) throw new Error(`web server exited before readiness: ${output}`)
      output += decoder.decode(next.value, { stream: true })
      if (output.includes(expected)) return
    }
  } finally {
    reader.releaseLock()
  }
}

const within = async <T>(promise: Promise<T>, label: string): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out`)), 5_000)
  })
  try {
    return await Promise.race([promise, expired])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

const startWebServer = (): Readonly<{ readonly baseUrl: string; readonly server: Bun.Server<undefined> }> => {
  const assets: Record<string, Readonly<{ readonly file: string; readonly type: string }>> = {
    "/": { file: "index.html", type: "text/html; charset=utf-8" },
    "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
    "/detail.html": { file: "detail.html", type: "text/html; charset=utf-8" },
    "/marketplace.css": { file: "marketplace.css", type: "text/css; charset=utf-8" },
    "/marketplace.js": { file: "marketplace.js", type: "text/javascript; charset=utf-8" },
  }
  const server = Bun.serve({
    fetch: async (request) => {
      const asset = assets[new URL(request.url).pathname]
      if (asset === undefined) return new Response("not found", { status: 404 })
      const file = Bun.file(join(publicRoot, "web", asset.file))
      if (!(await file.exists())) return new Response("not found", { status: 404 })
      return new Response(file, { headers: { "content-type": asset.type } })
    },
    hostname: "127.0.0.1",
    port: 0,
  })
  return { baseUrl: `http://127.0.0.1:${server.port}`, server }
}

const startRegistry = async (
  mode: WorldUiMockMode,
): Promise<Readonly<{ readonly server: Bun.Server<undefined>; readonly url: string }>> => {
  const list = await fixture("catalog-list-200.json", worldCatalogListResponseSchema.parse)
  const detail = await fixture("catalog-detail-200.json", worldCatalogDetailResponseSchema.parse)
  const selectedDetail = mode === "partial" ? partialDetail(detail) : mode === "cjk" ? cjkDetail(detail) : detail
  const selectedList = listFor(list, selectedDetail)
  const server = Bun.serve({
    fetch(request) {
      const path = new URL(request.url).pathname
      if (mode === "api500" && path.startsWith(catalogPath)) {
        return publicJson({ error: "registry_failure" }, { status: 500 })
      }
      if (path === catalogPath) {
        if (mode === "empty" || mode === "revoked") return publicJson({ worlds: [] })
        return publicJson(selectedList)
      }
      if (path.startsWith(`${catalogPath}/`)) {
        if (mode === "revoked") return publicJson({ error: "not_found" }, { status: 404 })
        if (mode === "empty") return publicJson({ error: "not_found" }, { status: 404 })
        return publicJson(selectedDetail)
      }
      return publicJson({ error: "not_found" }, { status: 404 })
    },
    hostname: "127.0.0.1",
    port: 0,
  })
  return { server, url: `http://127.0.0.1:${server.port}` }
}

export const startWorldUiHarness = async (mode: WorldUiMockMode): Promise<WorldUiHarness> => {
  const screenshots = await mkdtemp(join(tmpdir(), "todo26-world-ui-"))
  const registry = await startRegistry(mode)
  let web: Readonly<{ readonly baseUrl: string; readonly server: Bun.Server<undefined> }> | undefined
  const contexts: BrowserContext[] = []
  try {
    web = startWebServer()
    sharedBrowser ??= await chromium.launch({
      args: ["--disable-background-networking"],
      executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      headless: true,
    })
  } catch (error) {
    registry.server.stop(true)
    web?.server.stop(true)
    await rm(screenshots, { force: true, recursive: true })
    throw error
  }
  const browser = sharedBrowser
  if (browser === undefined) throw new Error("system Chrome did not launch")
  return {
    appUrl: web.baseUrl,
    registryUrl: registry.url,
    screenshotPath: (name) => join(screenshots, name),
    waitForWorldResponse: (page, detail) => page.waitForResponse((response) => {
      const path = new URL(response.url()).pathname
      return detail ? path.startsWith(`${catalogPath}/`) : path === catalogPath
    }, { timeout: 5_000 }),
    newPage: async (viewport) => {
      const context = await browser.newContext({ viewport })
      contexts.push(context)
      return context.newPage()
    },
    close: async () => {
      for (const context of contexts) await context.close()
      registry.server.stop(true)
      web.server.stop(true)
      await rm(screenshots, { force: true, recursive: true })
    },
  }
}

export const closeWorldUiBrowser = async (): Promise<void> => {
  if (sharedBrowser === undefined) return
  const browser = sharedBrowser
  sharedBrowser = undefined
  await browser.close()
}
