import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { z } from "zod"

const publicRoot = join(import.meta.dir, "../../..")
const registryRoot =
  process.env.TRAJECTORY_REGISTRY_ROOT ?? join(publicRoot, "..", "agent-trajectory-registry-world-compiler")
const coordinator = join(registryRoot, "scripts/qa/world_final_verify.py")
const registryPython = join(registryRoot, ".venv/bin/python")
const servers: Bun.Server<undefined>[] = []

const stages = [
  "publish",
  "publish-receipt",
  "malformed-spec",
  "generated-backend-sandbox-violation",
  "build",
  "conformance",
  "tampered-envelope",
  "promote",
  "trade",
  "hosted-onprem",
  "settle",
  "revocation",
  "withdrawal-denials",
] as const

const failureCases = [
  "malformed-spec",
  "generated-backend-sandbox-violation",
  "holdout-mismatch",
  "tampered-envelope",
  "post-withdraw-hosted-new-delivery",
  "post-withdraw-on-prem-license-refresh",
] as const

const receiptSchema = z.object({
  command: z.array(z.string().min(1)).min(1),
  cwd: z.string().min(1),
  exitCode: z.literal(0),
  outcome: z.literal("passed"),
  stage: z.enum(stages),
  stderrSha256: z.string().regex(/^[0-9a-f]{64}$/),
  stdoutSha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict()

const lifecycleSchema = z.object({
  failureCases: z.array(z.enum(failureCases)),
  mode: z.literal("lifecycle"),
  ok: z.literal(true),
  receipts: z.array(receiptSchema),
  scenarioId: z.literal("todo27-marketplace-lifecycle"),
}).strict()

const contractId = "00000000-0000-4000-8000-000000000002"
const entitlementId = "00000000-0000-4000-8000-000000000001"
const packDigest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

const run = async (
  command: readonly string[],
): Promise<Readonly<{ readonly exitCode: number; readonly stderr: string; readonly stdout: string }>> => {
  const child = Bun.spawn([...command], {
    cwd: publicRoot,
    env: { ...process.env, PYTHONPATH: registryRoot },
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
  expect(existsSync(registryPython)).toBe(true)
  expect(existsSync(coordinator)).toBe(true)
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
  test("process-drives the public client through every real registry lifecycle stage", async () => {
    // Given: the independently owned registry lifecycle coordinator and public client checkout.
    const command = [
      registryPython,
      coordinator,
      "lifecycle",
      "--registry-root",
      registryRoot,
      "--public-root",
      publicRoot,
      "--json",
    ]

    // When: the coordinator launches the real local registry lifecycle.
    const result = await run(command)

    // Then: the only public evidence is one canonical, digest-only complete receipt.
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" })
    expect(result.stdout).toMatch(/^[^\n]+\n$/u)
    const parsed = lifecycleSchema.parse(JSON.parse(result.stdout))
    expect(parsed.receipts.map((receipt) => receipt.stage)).toEqual([...stages])
    expect(parsed.failureCases).toEqual([...failureCases])
    expect(parsed.receipts.every((receipt) => receipt.cwd === publicRoot || receipt.cwd === registryRoot)).toBe(true)
  }, 300_000)

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
