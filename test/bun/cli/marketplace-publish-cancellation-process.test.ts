import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { writeStoredAuthSession } from "../../../src/auth/store"
import { encodeDatasetManifest } from "../../../src/marketplace/archive-contract"
import { writeDatasetZip } from "../../../src/marketplace/stored-zip"
import { officialGatewayProcessArguments, officialGatewayProcessEnvironment } from "../fixtures/gateway-process"

const roots: string[] = []
const servers: Bun.Server<undefined>[] = []

const fixtureRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "trajectory-publish-cancel-"))
  roots.push(root)
  return root
}

const bundle = (root: string): string => {
  const trace = Buffer.from('{"runtime":"codex","status":"collected","eventCount":0,"events":[]}', "utf8")
  const label = `s-${"0".repeat(64)}`
  const path = `traces/${label}.atf.json`
  const manifest = encodeDatasetManifest({
    artifacts: [{
      byteCount: trace.length,
      label,
      path,
      sha256: createHash("sha256").update(trace).digest("hex"),
    }],
    formatVersion: 1,
  })
  const output = join(root, "candidate.zip")
  writeFileSync(output, writeDatasetZip([
    { data: manifest, name: "dataset-manifest.json" },
    { data: trace, name: path },
  ]))
  return output
}

const publishArguments = (path: string, server: string): readonly string[] => [
  "marketplace", "seller", "candidate", "publish",
  "--bundle", path,
  "--server", server,
]

beforeAll(() => {
  const build = Bun.spawnSync([process.execPath, "run", "build:collector"], {
    cwd: process.cwd(),
    stderr: "pipe",
    stdout: "pipe",
  })
  if (build.exitCode !== 0) throw new Error(new TextDecoder().decode(build.stderr))
})

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe("marketplace candidate publish cancellation", () => {
  test("invalid defined environment credential cannot select stored identity", async () => {
    // Given: a live registry and active stored login behind a malformed environment credential.
    const root = fixtureRoot()
    let hits = 0
    const submissionId = `sub_${"0".repeat(26)}`
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        hits += 1
        await request.arrayBuffer()
        return Response.json({
          protocolVersion: 1,
          submissionId,
          status: "accepted",
          statusUrl: `/v1/marketplace/seller/candidates/${submissionId}`,
        }, { status: 202 })
      },
    })
    servers.push(server)
    const origin = `http://127.0.0.1:${server.port}`
    writeStoredAuthSession({
      accessToken: "stored-sentinel",
      accountId: "acct-0123456789abcdef",
      expiresAt: "2099-01-01T00:00:00.000Z",
      server: origin,
      tokenType: "Bearer",
    }, { storePath: join(root, "agent-trajectory-marketplace", "auth.json") })

    // When: the built CLI resolves a defined invalid higher-priority environment source.
    const invocation = officialGatewayProcessArguments([
      process.execPath,
      "dist/collector.js",
      ...publishArguments(bundle(root), origin).filter((argument) => argument !== "--server" && argument !== origin),
    ], origin)
    const child = Bun.spawn(invocation.argumentsList, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...officialGatewayProcessEnvironment(invocation.target),
        TRAJECTORY_MARKETPLACE_CONFIG_HOME: root,
        TRAJECTORY_REGISTRY_API_KEY: " invalid-environment ",
      },
      stderr: "pipe",
      stdout: "pipe",
    })
    const [exitCode, stderr, stdout] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
    ])

    // Then: authority does not silently fall through to the stored account.
    expect({ exitCode, hits, stderr, stdout }).toEqual({
      exitCode: 1,
      hits: 0,
      stderr: '{"error":"missing_publish_credential"}\n',
      stdout: "",
    })
  })

  test.each(["SIGINT", "SIGTERM"] as const)(
    "propagates %s into an in-flight publish",
    async (signal) => {
      // Given: a built CLI request whose live registry response remains open.
      const root = fixtureRoot()
      const requestArrived = Promise.withResolvers<Readonly<{ declared: number; received: number }>>()
      const responseCancelled = Promise.withResolvers<void>()
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const received = (await request.arrayBuffer()).byteLength
          requestArrived.resolve({
            declared: Number(request.headers.get("content-length")),
            received,
          })
          return new Response(new ReadableStream<Uint8Array>({
            cancel() {
              responseCancelled.resolve()
            },
          }), { status: 202 })
        },
      })
      servers.push(server)
      const target = `http://127.0.0.1:${server.port}`
      const invocation = officialGatewayProcessArguments([
        process.execPath,
        "dist/collector.js",
        ...publishArguments(bundle(root), target).filter((argument) => argument !== "--server" && argument !== target),
        "--api-key", "flag-sentinel",
      ], target)
      const child = Bun.spawn(invocation.argumentsList, {
        cwd: process.cwd(),
        env: { ...process.env, ...officialGatewayProcessEnvironment(invocation.target), TRAJECTORY_MARKETPLACE_CONFIG_HOME: root },
        stderr: "pipe",
        stdout: "pipe",
      })
      const stderrPromise = new Response(child.stderr).text()
      const stdoutPromise = new Response(child.stdout).text()
      const lengths = await requestArrived.promise

      // When: the exact operating-system signal is sent after request arrival.
      child.kill(signal)
      const deadline = AbortSignal.timeout(250)
      const outcome = await Promise.race([
        child.exited.then((exitCode) => ({ exitCode }) as const),
        new Promise<"deadline">((resolve) => {
          deadline.addEventListener("abort", () => resolve("deadline"), { once: true })
        }),
      ])
      if (outcome === "deadline") {
        child.kill("SIGKILL")
        await child.exited
      }
      const [stderr, stdout] = await Promise.all([stderrPromise, stdoutPromise])
      const cancellationDeadline = AbortSignal.timeout(250)
      const bodyCancellation = await Promise.race([
        responseCancelled.promise.then(() => "cancelled" as const),
        new Promise<"deadline">((resolve) => {
          cancellationDeadline.addEventListener("abort", () => resolve("deadline"), { once: true })
        }),
      ])

      // Then: the process exits through the stable CLI error and cancels the live body.
      expect({ bodyCancellation, lengths, outcome, stderr, stdout }).toEqual({
        bodyCancellation: "cancelled",
        lengths: { declared: 1115, received: 1115 },
        outcome: { exitCode: 1 },
        stderr: '{"error":"cancelled"}\n',
        stdout: "",
      })
    },
  )
})
