import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { writeStoredAuthSession } from "../../../src/auth/store"

const roots: string[] = []
const result = { ok: true, wallet: { currency: "USD", pendingCredits: 17, availableCredits: 29, reservedCredits: 5, lifetimeRedeemedCredits: 101, nextDistributionAt: "2030-01-02T03:04:05Z" } }

const root = (): string => {
  const value = mkdtempSync(join(tmpdir(), "wallet-process-"))
  roots.push(value)
  return value
}

const run = async (argumentsList: readonly string[], environment: Readonly<Record<string, string>>) => {
  const child = Bun.spawn([process.execPath, "dist/collector.js", ...argumentsList], { cwd: process.cwd(), env: environment, stderr: "pipe", stdout: "pipe" })
  const [exitCode, stderr, stdout] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()])
  return { exitCode, stderr, stdout }
}

const environment = (config: string): Record<string, string> => {
  const value: Record<string, string> = { ...process.env, TRAJECTORY_MARKETPLACE_CONFIG_HOME: config }
  delete value.TRAJECTORY_REGISTRY_API_KEY
  return value
}

const storeSession = (config: string, server: string, accessToken = "stored-sentinel"): void => {
  writeStoredAuthSession({ accessToken, accountId: "acct-0123456789abcdef", expiresAt: "2099-01-01T00:00:00.000Z", server, tokenType: "Bearer" }, { storePath: join(config, "agent-trajectory-marketplace", "auth.json") })
}

beforeAll(() => {
  const build = Bun.spawnSync([process.execPath, "run", "build:collector"], { cwd: process.cwd(), stderr: "pipe" })
  if (build.exitCode !== 0) throw new Error(new TextDecoder().decode(build.stderr))
})

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { force: true, recursive: true })
})

describe("marketplace wallet balance process boundary", () => {
  test("rejects absent session and unknown flags before transport", async () => {
    // Given: no stored session and an unsupported flag spelling.
    let hits = 0
    const server = Bun.serve({ fetch() { hits += 1; return Response.json(result) }, hostname: "127.0.0.1", port: 0 })
    const config = root()
    const serverUrl = `http://127.0.0.1:${server.port}`

    // When: the command runs without any credential source and with an unknown flag.
    const missing = await run(["marketplace", "seller", "wallet", "balance", "--server", serverUrl], environment(config))
    const flagged = await run(["marketplace", "seller", "wallet", "balance", "--server", serverUrl, "--token", "no"], environment(config))
    server.stop(true)

    // Then: both fail locally with zero transport.
    expect({ hits, flagged, missing }).toEqual({
      hits: 0,
      flagged: { exitCode: 1, stderr: "{\"error\":\"invalid_command\"}\n", stdout: "" },
      missing: { exitCode: 1, stderr: "{\"error\":\"missing_wallet_credential\"}\n", stdout: "" },
    })
  })

  test("uses the stored login session when no override is defined", async () => {
    // Given: an active stored session and no flag or environment override.
    let authorization = ""
    const server = Bun.serve({ fetch(request) {
      authorization = request.headers.get("authorization") ?? ""
      return Response.json(result)
    }, hostname: "127.0.0.1", port: 0 })
    const config = root()
    const serverUrl = `http://127.0.0.1:${server.port}`
    storeSession(config, serverUrl)

    // When: the command runs.
    const output = await run(["marketplace", "seller", "wallet", "balance", "--server", serverUrl], environment(config))
    server.stop(true)

    // Then: the stored token authorizes one strict response.
    expect({ authorization, output }).toEqual({ authorization: "Bearer stored-sentinel", output: { exitCode: 0, stderr: "", stdout: `${JSON.stringify(result)}\n` } })
  })

  test("uses a defined environment credential ahead of the stored session", async () => {
    // Given: both a valid environment credential and a valid stored session.
    let authorization = ""
    const server = Bun.serve({ fetch(request) {
      authorization = request.headers.get("authorization") ?? ""
      return Response.json(result)
    }, hostname: "127.0.0.1", port: 0 })
    const config = root()
    const serverUrl = `http://127.0.0.1:${server.port}`
    storeSession(config, serverUrl)

    // When: the command runs with the environment credential defined.
    const output = await run(
      ["marketplace", "seller", "wallet", "balance", "--server", serverUrl],
      { ...environment(config), TRAJECTORY_REGISTRY_API_KEY: "env-sentinel" },
    )
    server.stop(true)

    // Then: the environment credential wins.
    expect({ authorization, output }).toEqual({ authorization: "Bearer env-sentinel", output: { exitCode: 0, stderr: "", stdout: `${JSON.stringify(result)}\n` } })
  })

  test("rejects an invalid defined environment credential without stored fallback", async () => {
    // Given: an invalid defined environment credential and a valid stored session.
    let hits = 0
    const server = Bun.serve({ fetch() { hits += 1; return Response.json(result) }, hostname: "127.0.0.1", port: 0 })
    const config = root()
    const serverUrl = `http://127.0.0.1:${server.port}`
    storeSession(config, serverUrl)

    // When: the command runs.
    const output = await run(
      ["marketplace", "seller", "wallet", "balance", "--server", serverUrl],
      { ...environment(config), TRAJECTORY_REGISTRY_API_KEY: " invalid env credential " },
    )
    server.stop(true)

    // Then: the malformed higher-priority source fails closed with zero transport.
    expect({ hits, output }).toEqual({ hits: 0, output: { exitCode: 1, stderr: "{\"error\":\"missing_wallet_credential\"}\n", stdout: "" } })
  })

  test("honors an explicit api key and rejects an invalid one before transport", async () => {
    // Given: a stored session plus valid and invalid explicit keys.
    const authorizations: string[] = []
    const server = Bun.serve({ fetch(request) {
      authorizations.push(request.headers.get("authorization") ?? "")
      return Response.json(result)
    }, hostname: "127.0.0.1", port: 0 })
    const config = root()
    const serverUrl = `http://127.0.0.1:${server.port}`
    storeSession(config, serverUrl)

    // When: the command runs with each explicit key.
    const valid = await run(["marketplace", "seller", "wallet", "balance", "--server", serverUrl, "--api-key", "flag-sentinel"], environment(config))
    const invalid = await run(["marketplace", "seller", "wallet", "balance", "--server", serverUrl, "--api-key", " invalid flag "], environment(config))
    server.stop(true)

    // Then: the valid key wins and the invalid key fails closed.
    expect({ authorizations, invalid, valid }).toEqual({
      authorizations: ["Bearer flag-sentinel"],
      invalid: { exitCode: 1, stderr: "{\"error\":\"missing_wallet_credential\"}\n", stdout: "" },
      valid: { exitCode: 0, stderr: "", stdout: `${JSON.stringify(result)}\n` },
    })
  })

  test("rejects a malformed stored token before transport", async () => {
    // Given: an active stored session whose token contains whitespace.
    let hits = 0
    const server = Bun.serve({ fetch() { hits += 1; return Response.json(result) }, hostname: "127.0.0.1", port: 0 })
    const config = root()
    const serverUrl = `http://127.0.0.1:${server.port}`
    storeSession(config, serverUrl, " malformed ")

    // When: the command runs.
    const output = await run(["marketplace", "seller", "wallet", "balance", "--server", serverUrl], environment(config))
    server.stop(true)

    // Then: the malformed stored credential fails locally with zero transport.
    expect({ hits, output }).toEqual({ hits: 0, output: { exitCode: 1, stderr: "{\"error\":\"missing_wallet_credential\"}\n", stdout: "" } })
  })

  test("treats an empty defined environment credential as an invalid override", async () => {
    // Given: an empty but defined environment credential and a valid stored session.
    let hits = 0
    const server = Bun.serve({ fetch() { hits += 1; return Response.json(result) }, hostname: "127.0.0.1", port: 0 })
    const config = root()
    const serverUrl = `http://127.0.0.1:${server.port}`
    storeSession(config, serverUrl)

    // When: the command runs with the empty override defined.
    const output = await run(
      ["marketplace", "seller", "wallet", "balance", "--server", serverUrl],
      { ...environment(config), TRAJECTORY_REGISTRY_API_KEY: "" },
    )
    server.stop(true)

    // Then: the defined override fails closed instead of falling back.
    expect({ hits, output }).toEqual({ hits: 0, output: { exitCode: 1, stderr: "{\"error\":\"missing_wallet_credential\"}\n", stdout: "" } })
  })

  test("never uses a stored session bound to a different server", async () => {
    // Given: a valid stored session for another origin only.
    let hits = 0
    const server = Bun.serve({ fetch() { hits += 1; return Response.json(result) }, hostname: "127.0.0.1", port: 0 })
    const other = Bun.serve({ fetch() { return Response.json(result) }, hostname: "127.0.0.1", port: 0 })
    const config = root()
    const serverUrl = `http://127.0.0.1:${server.port}`
    storeSession(config, `http://127.0.0.1:${other.port}`)

    // When: the command targets the origin without a session.
    const output = await run(["marketplace", "seller", "wallet", "balance", "--server", serverUrl], environment(config))
    server.stop(true)
    other.stop(true)

    // Then: the foreign token is never offered to this server.
    expect({ hits, output }).toEqual({ hits: 0, output: { exitCode: 1, stderr: "{\"error\":\"missing_wallet_credential\"}\n", stdout: "" } })
  })
})
