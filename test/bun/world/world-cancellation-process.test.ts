import { afterEach, beforeAll, describe, expect, test } from "bun:test"

const servers: Bun.Server<undefined>[] = []
const contractId = "00000000-0000-4000-8000-000000000002"
const entitlementId = "00000000-0000-4000-8000-000000000001"
const instanceId = "instance-7f1a9c2e"
const packDigest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
const worldId = "world/refund-unit"

const bounded = async <T>(action: Promise<T>): Promise<T | "deadline"> => {
  const deadline = AbortSignal.timeout(250)
  return Promise.race([
    action,
    new Promise<"deadline">((resolve) => {
      deadline.addEventListener("abort", () => resolve("deadline"), { once: true })
    }),
  ])
}

beforeAll(() => {
  const build = Bun.spawnSync([process.execPath, "run", "build:collector"], {
    cwd: process.cwd(), stderr: "pipe", stdout: "pipe",
  })
  if (build.exitCode !== 0) throw new Error(new TextDecoder().decode(build.stderr))
})

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

describe("trajectory world caller cancellation", () => {
  test.each([
    ["list", ["world", "list"]],
    ["detail", ["world", "detail", worldId]],
    ["run", ["world", "run", worldId, "--contract-id", contractId, "--pack-digest", packDigest, "--seed", "7", "--idempotency-key", "run-7", "--api-key", "api-token"]],
    ["status", ["world", "status", worldId, instanceId, "--contract-id", contractId, "--pack-digest", packDigest, "--api-key", "api-token"]],
    ["download", ["world", "download", entitlementId, "--api-key", "api-token"]],
  ] as const)("cancels an in-flight %s request on SIGTERM", async (_command, argumentsList) => {
    // Given: a built public or protected command with a received request and a held response.
    const requestArrived = Promise.withResolvers<void>()
    const responseCancelled = Promise.withResolvers<void>()
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        await request.arrayBuffer()
        requestArrived.resolve()
        return new Response(new ReadableStream<Uint8Array>({
          cancel() {
            responseCancelled.resolve()
          },
        }), { headers: { "content-type": "application/json" } })
      },
    })
    servers.push(server)
    const child = Bun.spawn([
      process.execPath, "dist/collector.js", ...argumentsList,
      "--server", `http://127.0.0.1:${server.port}`,
    ], { cwd: process.cwd(), stderr: "pipe", stdout: "pipe" })
    const stderr = new Response(child.stderr).text()
    const stdout = new Response(child.stdout).text()

    try {
      await requestArrived.promise

      // When: the caller terminates only after the request has reached the registry.
      child.kill("SIGTERM")
      const outcome = await bounded(child.exited.then((exitCode) => ({ exitCode }) as const))
      if (outcome === "deadline") {
        child.kill("SIGKILL")
        await child.exited
      }
      const bodyCancellation = await bounded(responseCancelled.promise.then(() => "cancelled" as const))

      // Then: caller cancellation wins over the bounded client timeout and closes the transport.
      expect({ bodyCancellation, outcome, stderr: await stderr, stdout: await stdout }).toEqual({
        bodyCancellation: "cancelled",
        outcome: { exitCode: 2 },
        stderr: "{\"error\":{\"code\":\"cancelled\",\"message\":\"cancelled\"}}\n",
        stdout: "",
      })
    } finally {
      child.kill("SIGKILL")
      await child.exited
    }
  })
})
