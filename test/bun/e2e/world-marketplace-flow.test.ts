import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  officialGatewayProcessArguments,
  officialGatewayProcessEnvironment,
} from "../fixtures/gateway-process"

const publicRoot = join(import.meta.dir, "../../..")
const contractRoot = join(publicRoot, "contract/world/v1")
const servers: Bun.Server<undefined>[] = []

const contractId = "00000000-0000-4000-8000-000000000002"
const entitlementId = "00000000-0000-4000-8000-000000000001"
const instanceId = "instance-7f1a9c2e"
const packDigest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
const worldId = "world/refund-unit"
const fixture = (name: string): string => readFileSync(join(contractRoot, name), "utf8")
const jsonFixture = (name: string): Response =>
  new Response(fixture(name), { headers: { "content-type": "application/json" } })
const hosted = `${JSON.stringify({
  ok: true,
  result: { instanceId, packDigest, revision: 0, status: "active", worldId },
})}\n`
const crossRepository = (() => {
  const apiKey = process.env.TODO27_REGISTRY_API_KEY
  const head = process.env.TODO27_REGISTRY_HEAD
  const root = process.env.TODO27_REGISTRY_ROOT
  const server = process.env.TODO27_REGISTRY_URL
  return apiKey === undefined || head === undefined || root === undefined || server === undefined
    ? undefined
    : { apiKey, head, root, server }
})()
const crossRepositoryTest = crossRepository === undefined ? test.skip : test
const todo27Trace = (content: string): string => JSON.stringify({
  runtime: "codex",
  status: "collected",
  formatVersion: 2,
  eventCount: 1,
  events: [{
    kind: "message",
    name: "user",
    timestamp: "2026-07-27T00:00:00Z",
    sourceEventId: "event-1",
    payload: {
      role: "user",
      content,
      usage: {
        model: "claude-fable-5",
        inputTokens: 1,
        outputTokens: 1,
      },
    },
  }],
})

const run = async (
  command: readonly string[],
  target?: string,
): Promise<Readonly<{ readonly exitCode: number; readonly stderr: string; readonly stdout: string }>> => {
  const processConfiguration = officialGatewayProcessArguments(command, target)
  const child = Bun.spawn(processConfiguration.argumentsList, {
    cwd: publicRoot,
    env: {
      ...process.env,
      ...officialGatewayProcessEnvironment(processConfiguration.target),
    },
    stderr: "pipe",
    stdout: "pipe",
  })
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ])
  return { exitCode, stderr, stdout }
}

beforeAll(() => {
  const build = Bun.spawnSync([process.execPath, "run", "build:collector"], {
    cwd: publicRoot,
    stderr: "pipe",
    stdout: "pipe",
  })
  expect(build.exitCode).toBe(0)
})

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

describe("public Todo27 marketplace lifecycle", () => {
  test("process-drives the built client through the public World lifecycle", async () => {
    // Given: a live Registry HTTP boundary serving the exact shipped public contracts.
    const observed: string[] = []
    const server = Bun.serve({
      async fetch(request) {
        const path = new URL(request.url).pathname
        observed.push(`${request.method} ${path} ${request.headers.get("authorization") ?? "-"}`)
        if (path === "/v1/marketplace/worlds") return jsonFixture("catalog-list-200.json")
        if (path === `/v1/marketplace/worlds/${worldId}`) return jsonFixture("catalog-detail-200.json")
        if (path.endsWith(`/hosted/instances/${instanceId}`)) {
          return new Response(hosted, { headers: { "content-type": "application/json" } })
        }
        if (path.endsWith("/hosted/instances")) {
          expect(await request.text()).toBe("{\"seed\":7}")
          expect(request.headers.get("idempotency-key")).toBe("todo27-lifecycle")
          expect(request.headers.get("x-world-pack-digest")).toBe(packDigest)
          return new Response(hosted, { headers: { "content-type": "application/json" } })
        }
        if (path.endsWith("/downloads")) return jsonFixture("entitlement-download-200.json")
        return new Response(null, { status: 404 })
      },
      hostname: "127.0.0.1",
      port: 0,
    })
    servers.push(server)
    const base = `http://127.0.0.1:${server.port}`
    const auth = ["--api-key", "api-token"]

    // When: one built CLI process traverses catalog, hosted execution, and download.
    const results = [
      await run([process.execPath, "dist/collector.js", "world", "list"], base),
      await run([process.execPath, "dist/collector.js", "world", "detail", worldId], base),
      await run([
        process.execPath, "dist/collector.js", "world", "run", worldId, ...auth, "--contract-id", contractId,
        "--pack-digest", packDigest, "--seed", "7", "--idempotency-key", "todo27-lifecycle",
      ], base),
      await run([
        process.execPath, "dist/collector.js", "world", "status", worldId, instanceId, ...auth,
        "--contract-id", contractId, "--pack-digest", packDigest,
      ], base),
      await run([process.execPath, "dist/collector.js", "world", "download", entitlementId, ...auth], base),
    ]

    // Then: every step returns the exact shipped contract and authorization stays protected.
    expect(results).toEqual([
      { exitCode: 0, stderr: "", stdout: fixture("catalog-list-200.json") },
      { exitCode: 0, stderr: "", stdout: fixture("catalog-detail-200.json") },
      { exitCode: 0, stderr: "", stdout: hosted },
      { exitCode: 0, stderr: "", stdout: hosted },
      { exitCode: 0, stderr: "", stdout: fixture("entitlement-download-200.json") },
    ])
    expect(observed).toEqual([
      "GET /v1/marketplace/worlds -",
      `GET /v1/marketplace/worlds/${worldId} -`,
      `POST /v1/marketplace/buyer/world-contracts/${contractId}/hosted/instances Bearer api-token`,
      `GET /v1/marketplace/buyer/world-contracts/${contractId}/hosted/instances/${instanceId} Bearer api-token`,
      `POST /v1/marketplace/buyer/world-entitlements/${entitlementId}/downloads Bearer api-token`,
    ])
  })

  crossRepositoryTest("uses the built CLI against the explicitly supplied Registry head", async () => {
    // Registry PR CI supplies all four values; ordinary Marketplace CI has no private checkout.
    const supplied = crossRepository
    if (supplied === undefined) throw new Error("missing Todo27 Registry companion")
    const resolved = Bun.spawnSync(["git", "-C", supplied.root, "rev-parse", "HEAD"], { stdout: "pipe" })
    expect(resolved.exitCode).toBe(0)
    expect(new TextDecoder().decode(resolved.stdout).trim()).toBe(supplied.head)

    const workspace = mkdtempSync(join(tmpdir(), "todo27-marketplace-cli-"))
    try {
      const traces = join(workspace, "traces")
      const bundle = join(workspace, "candidate.zip")
      const selection = join(workspace, "selection.json")
      mkdirSync(traces)
      writeFileSync(join(traces, "main.atf.json"), todo27Trace("reviewed Todo27 main trace"))
      writeFileSync(join(traces, "retry.atf.json"), todo27Trace("reviewed Todo27 retry trace"))

      const previewed = await run([
        process.execPath, "dist/collector.js", "marketplace", "seller", "candidate", "bundle",
        "--root", traces, "--print-selection",
      ])
      expect(previewed).toEqual({
        exitCode: 0,
        stderr: "",
        stdout: expect.stringContaining('"schemaVersion":1'),
      })
      writeFileSync(selection, previewed.stdout)
      const bundled = await run([
        process.execPath, "dist/collector.js", "marketplace", "seller", "candidate", "bundle",
        "--root", traces, "--out", bundle, "--selection", selection,
      ])
      expect(bundled).toEqual({ exitCode: 0, stderr: "", stdout: expect.stringContaining('"traceCount":2') })

      const published = await run([
        process.execPath, "dist/collector.js", "marketplace", "seller", "candidate", "publish",
        "--bundle", bundle, "--selection", selection, "--api-key", supplied.apiKey,
      ], supplied.server)
      expect(published).toEqual({
        exitCode: 0,
        stderr: "",
        stdout: expect.any(String),
      })
      expect(JSON.parse(published.stdout)).toEqual({
        membership: [
          expect.stringMatching(/^s-[0-9a-f]{64}$/),
          expect.stringMatching(/^s-[0-9a-f]{64}$/),
        ],
        protocolVersion: 1,
        submissionId: expect.stringMatching(/^sub_/),
        status: "accepted",
        statusUrl: expect.stringMatching(/^\/v1\/marketplace\/seller\/candidates\/sub_/),
      })
      const receiptPath = process.env.TODO27_COMPANION_RECEIPT_PATH
      if (receiptPath === undefined) throw new Error("missing Todo27 receipt path")
      writeFileSync(receiptPath, published.stdout)
    } finally {
      rmSync(workspace, { force: true, recursive: true })
    }
  })

  test("returns exact safe JSON for malformed digest incompatible unauthorized and revoked requests", async () => {
    // Given: a public HTTP boundary that produces the lifecycle's adverse delivery statuses.
    const server = Bun.serve({
      fetch(request) {
        const path = new URL(request.url).pathname
        if (path === "/v1/marketplace/worlds") return new Response("{", { headers: { "content-type": "application/json" } })
        if (path.endsWith("/downloads")) {
          return new Response(null, { status: request.headers.get("authorization") === "Bearer revoked-token" ? 410 : 401 })
        }
        return new Response(null, { status: 422 })
      },
      hostname: "127.0.0.1",
      port: 0,
    })
    servers.push(server)
    const base = `http://127.0.0.1:${server.port}`
    const worldRun = [
      "world",
      "run",
      "world/refund-unit",
      "--api-key",
      "api-token",
      "--contract-id",
      contractId,
      "--pack-digest",
      packDigest,
      "--seed",
      "7",
      "--idempotency-key",
      "todo27-adverse",
    ]

    // When: malformed catalog, incompatible hosted, unauthorized, and revoked download requests run through the built CLI.
    const results = await Promise.all([
      run([process.execPath, "dist/collector.js", "world", "list"], base),
      run([process.execPath, "dist/collector.js", ...worldRun], base),
      run([process.execPath, "dist/collector.js", "world", "download", entitlementId, "--api-key", "api-token"], base),
      run([process.execPath, "dist/collector.js", "world", "download", entitlementId, "--api-key", "revoked-token"], base),
    ])

    // Then: every public failure is redacted into the exact machine-safe error contract.
    expect(results).toEqual([
      { exitCode: 2, stderr: "{\"error\":{\"code\":\"invalid_response\",\"message\":\"invalid_response\"}}\n", stdout: "" },
      { exitCode: 2, stderr: "{\"error\":{\"code\":\"incompatible\",\"message\":\"incompatible\"}}\n", stdout: "" },
      { exitCode: 2, stderr: "{\"error\":{\"code\":\"unauthorized\",\"message\":\"unauthorized\"}}\n", stdout: "" },
      { exitCode: 2, stderr: "{\"error\":{\"code\":\"revoked\",\"message\":\"revoked\"}}\n", stdout: "" },
    ])
  })
})
