import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

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

const run = async (
  command: readonly string[],
): Promise<Readonly<{ readonly exitCode: number; readonly stderr: string; readonly stdout: string }>> => {
  const child = Bun.spawn([...command], {
    cwd: publicRoot,
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
    const auth = ["--server", base, "--api-key", "api-token"]

    // When: one built CLI process traverses catalog, hosted execution, and download.
    const results = [
      await run([process.execPath, "dist/collector.js", "world", "list", "--server", base]),
      await run([process.execPath, "dist/collector.js", "world", "detail", worldId, "--server", base]),
      await run([
        process.execPath, "dist/collector.js", "world", "run", worldId, ...auth, "--contract-id", contractId,
        "--pack-digest", packDigest, "--seed", "7", "--idempotency-key", "todo27-lifecycle",
      ]),
      await run([
        process.execPath, "dist/collector.js", "world", "status", worldId, instanceId, ...auth,
        "--contract-id", contractId, "--pack-digest", packDigest,
      ]),
      await run([process.execPath, "dist/collector.js", "world", "download", entitlementId, ...auth]),
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
      "--server",
      base,
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
      run([process.execPath, "dist/collector.js", "world", "list", "--server", base]),
      run([process.execPath, "dist/collector.js", ...worldRun]),
      run([process.execPath, "dist/collector.js", "world", "download", entitlementId, "--server", base, "--api-key", "api-token"]),
      run([process.execPath, "dist/collector.js", "world", "download", entitlementId, "--server", base, "--api-key", "revoked-token"]),
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
