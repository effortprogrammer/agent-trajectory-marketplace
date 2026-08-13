import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { encodeDatasetManifest } from "../../../src/marketplace/archive-contract"
import { writeDatasetZip } from "../../../src/marketplace/stored-zip"
import { writeStoredAuthSession } from "../../../src/auth/store"
import { parsePublishFrame } from "../../../src/marketplace/publish-frame"
import { officialGatewayProcessArguments, officialGatewayProcessEnvironment } from "../fixtures/gateway-process"

const roots: string[] = []

const fixtureRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "trajectory-publish-cli-"))
  roots.push(root)
  return root
}

const bundle = (root: string): string => {
  const trace = Buffer.from('{"runtime":"codex","status":"collected","eventCount":0,"events":[]}', "utf8")
  const label = `s-${"0".repeat(64)}`
  const path = `traces/${label}.atf.json`
  const manifest = encodeDatasetManifest({
    artifacts: [{ byteCount: trace.length, label, path, sha256: createHash("sha256").update(trace).digest("hex") }],
    formatVersion: 1,
  })
  const output = join(root, "candidate.zip")
  writeFileSync(output, writeDatasetZip([{ data: manifest, name: "dataset-manifest.json" }, { data: trace, name: path }]))
  return output
}

const runCli = async (argumentsList: readonly string[], environment: Readonly<Record<string, string | undefined>>): Promise<Readonly<{ readonly exitCode: number; readonly stderr: string; readonly stdout: string }>> => {
  const serverIndex = argumentsList.indexOf("--server")
  const invocation = officialGatewayProcessArguments(
    [process.execPath, "dist/collector.js", ...(serverIndex < 0
      ? argumentsList
      : argumentsList.filter((_, index) => index !== serverIndex && index !== serverIndex + 1))],
    serverIndex < 0 ? undefined : argumentsList[serverIndex + 1],
  )
  const child = Bun.spawn(invocation.argumentsList, {
    cwd: process.cwd(),
    env: { ...environment, ...officialGatewayProcessEnvironment(invocation.target) },
    stderr: "pipe",
    stdout: "pipe",
  })
  const [exitCode, stderr, stdout] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()])
  return { exitCode, stderr, stdout }
}

beforeAll(() => {
  const build = Bun.spawnSync([process.execPath, "run", "build:collector"], { cwd: process.cwd(), stderr: "pipe", stdout: "pipe" })
  if (build.exitCode !== 0) throw new Error(new TextDecoder().decode(build.stderr))
})

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe("marketplace candidate publish process boundary", () => {
  test("prints nested publish help before resolving inputs or credentials", async () => {
    // Given: unavailable local inputs, an empty configuration root, and a credential sentinel.
    const root = fixtureRoot()
    const environment = {
      ...process.env,
      TRAJECTORY_MARKETPLACE_CONFIG_HOME: root,
      TRAJECTORY_REGISTRY_API_KEY: "environment-sentinel",
    }

    // When: the built CLI receives only the nested publish help spelling.
    const result = await runCli(["marketplace", "seller", "candidate", "publish", "--help"], environment)

    // Then: help succeeds without creating state or exposing credentials.
    expect({ files: readdirSync(root), result: { exitCode: result.exitCode, stderr: result.stderr } }).toEqual({
      files: [],
      result: { exitCode: 0, stderr: "" },
    })
    expect(result.stdout).toContain("trajectory marketplace seller candidate publish")
    for (const option of ["--bundle", "--api-key"]) expect(result.stdout).toContain(option)
    expect(result.stdout).not.toContain("--server")
    expect(`${result.stdout}${result.stderr}`).not.toContain("environment-sentinel")
  })

  test("invalid bundle and missing credential make zero HTTP requests", async () => {
    // Given: a live loopback server and local inputs that must fail before transport.
    const root = fixtureRoot()
    let hits = 0
    const server = Bun.serve({ fetch: () => { hits += 1; return new Response(null, { status: 500 }) }, hostname: "127.0.0.1", port: 0 })
    const base = { ...process.env, TRAJECTORY_MARKETPLACE_CONFIG_HOME: root, TRAJECTORY_REGISTRY_API_KEY: "" }

    // When: the built CLI receives an invalid archive then a valid archive without a credential.
    const invalid = await runCli(["marketplace", "seller", "candidate", "publish", "--bundle", join(root, "missing.zip"), "--server", `http://127.0.0.1:${server.port}`], base)
    const missingCredential = await runCli(["marketplace", "seller", "candidate", "publish", "--bundle", bundle(root), "--server", `http://127.0.0.1:${server.port}`], base)
    server.stop(true)

    // Then: both stable local failures occur without any request.
    expect({ hits, invalid: invalid.stderr, missing: missingCredential.stderr }).toEqual({
      hits: 0,
      invalid: '{"error":"invalid_bundle_request"}\n',
      missing: '{"error":"missing_publish_credential"}\n',
    })
  })

  test("invalid explicit API key rejects before fallback and makes zero HTTP requests", async () => {
    // Given: a valid bundle, live registry, and valid fallback credentials behind an invalid flag.
    const root = fixtureRoot()
    let hits = 0
    const server = Bun.serve({ fetch: () => { hits += 1; return new Response(null, { status: 500 }) }, hostname: "127.0.0.1", port: 0 })
    writeStoredAuthSession({
      accessToken: "stored-sentinel",
      accountId: "acct-0123456789abcdef",
      expiresAt: "2099-01-01T00:00:00.000Z",
      server: `http://127.0.0.1:${server.port}`,
      tokenType: "Bearer",
    }, { storePath: join(root, "agent-trajectory-marketplace", "auth.json") })

    // When: the built CLI receives an explicitly supplied whitespace-padded API key.
    const result = await runCli([
      "marketplace", "seller", "candidate", "publish", "--bundle", bundle(root), "--server", `http://127.0.0.1:${server.port}`, "--api-key", " invalid-flag ",
    ], { ...process.env, TRAJECTORY_MARKETPLACE_CONFIG_HOME: root, TRAJECTORY_REGISTRY_API_KEY: "environment-sentinel" })
    server.stop(true)

    // Then: explicit invalid input fails locally instead of selecting either fallback credential.
    expect({ hits, result }).toEqual({
      hits: 0,
      result: { exitCode: 1, stderr: '{"error":"missing_publish_credential"}\n', stdout: "" },
    })
  })

  test("invalid stored credential rejects before transport", async () => {
    // Given: a valid bundle and active server-bound session whose token contains a control character.
    const root = fixtureRoot()
    let hits = 0
    const server = Bun.serve({
      fetch: () => {
        hits += 1
        return new Response(null, { status: 500 })
      },
      hostname: "127.0.0.1",
      port: 0,
    })
    writeStoredAuthSession({
      accessToken: "stored\nsentinel",
      accountId: "acct-0123456789abcdef",
      expiresAt: "2099-01-01T00:00:00.000Z",
      server: `http://127.0.0.1:${server.port}`,
      tokenType: "Bearer",
    }, { storePath: join(root, "agent-trajectory-marketplace", "auth.json") })

    // When: publish resolves that session after the flag and environment sources are omitted.
    const environment: Record<string, string | undefined> = {
      ...process.env,
      TRAJECTORY_MARKETPLACE_CONFIG_HOME: root,
    }
    delete environment["TRAJECTORY_REGISTRY_API_KEY"]
    const result = await runCli([
      "marketplace", "seller", "candidate", "publish",
      "--bundle", bundle(root),
      "--server", `http://127.0.0.1:${server.port}`,
    ], environment)
    server.stop(true)

    // Then: the invalid stored value is rejected with the stable local credential error and zero requests.
    expect({ hits, result }).toEqual({
      hits: 0,
      result: { exitCode: 1, stderr: '{"error":"missing_publish_credential"}\n', stdout: "" },
    })
  })

  test("built CLI posts one exact frame and prints strict accepted receipt", async () => {
    // Given: a reviewed dataset bundle and loopback registry receipt.
    const root = fixtureRoot()
    const archivePath = bundle(root)
    const archive = Bun.file(archivePath)
    let authorization = ""
    let contentType = ""
    let idempotencyKey = ""
    let body = new Uint8Array()
    const submissionId = `sub_${"0".repeat(26)}`
    const server = Bun.serve({
      fetch: async (request) => {
        authorization = request.headers.get("authorization") ?? ""
        contentType = request.headers.get("content-type") ?? ""
        idempotencyKey = request.headers.get("idempotency-key") ?? ""
        body = new Uint8Array(await request.arrayBuffer())
        return Response.json({ protocolVersion: 1, submissionId, status: "accepted", statusUrl: `/v1/marketplace/seller/candidates/${submissionId}` }, { status: 202 })
      }, hostname: "127.0.0.1", port: 0,
    })
    writeStoredAuthSession({
      accessToken: "stored-sentinel",
      accountId: "acct-0123456789abcdef",
      expiresAt: "2099-01-01T00:00:00.000Z",
      server: `http://127.0.0.1:${server.port}`,
      tokenType: "Bearer",
    }, { storePath: join(root, "agent-trajectory-marketplace", "auth.json") })

    // When: the built CLI publishes with three distinct credential sources.
    const result = await runCli([
      "marketplace", "seller", "candidate", "publish", "--bundle", archivePath, "--server", `http://127.0.0.1:${server.port}`, "--api-key", "flag-sentinel",
    ], { ...process.env, TRAJECTORY_MARKETPLACE_CONFIG_HOME: root, TRAJECTORY_REGISTRY_API_KEY: "environment-sentinel" })
    server.stop(true)

    // Then: only the flag credential is sent and no private data reaches terminal output.
    const frame = parsePublishFrame(body)
    expect({ authorization, contentType, idempotencyKey, frameBytes: body.length, frameArchive: frame.archive, result }).toMatchObject({
      authorization: "Bearer flag-sentinel",
      contentType: "application/octet-stream",
      idempotencyKey: `archive-${createHash("sha256").update(new Uint8Array(await archive.arrayBuffer())).digest("hex")}`,
      frameBytes: expect.any(Number),
      frameArchive: new Uint8Array(await archive.arrayBuffer()),
      result: { exitCode: 0, stderr: "" },
    })
    expect(result.stdout).toBe(`${JSON.stringify({ protocolVersion: 1, submissionId, status: "accepted", statusUrl: `/v1/marketplace/seller/candidates/${submissionId}` })}\n`)
    expect(`${result.stdout}${result.stderr}`).not.toContain("sentinel")
  })
})
