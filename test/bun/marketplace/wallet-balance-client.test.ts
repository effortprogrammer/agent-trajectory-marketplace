import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { WalletBalanceClientError, createWalletBalanceClient } from "../../../src/marketplace/wallet-balance-client"
import type { WalletBalanceResponse } from "../../../src/marketplace/wallet-balance-contract"

const roots: string[] = []
const servers: Bun.Server<undefined>[] = []
const body: WalletBalanceResponse = {
  ok: true,
  wallet: {
    currency: "USD", pendingCredits: 17, availableCredits: 29, reservedCredits: 5,
    lifetimeRedeemedCredits: 101, nextDistributionAt: "2030-01-02T03:04:05Z",
  },
}

const root = (): string => {
  const value = mkdtempSync(join(tmpdir(), "wallet-client-"))
  roots.push(value)
  return value
}

const failure = async (action: () => Promise<unknown>): Promise<WalletBalanceClientError> => {
  try { await action() } catch (error) {
    if (error instanceof WalletBalanceClientError) return error
    throw error
  }
  throw new Error("expected client error")
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
  for (const path of roots.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe("bounded aggregate client", () => {
  test("sends the selected credential and accepts only the canonical response", async () => {
    // Given: a loopback wallet endpoint recording the bearer header.
    let authorization = ""
    const server = Bun.serve({ fetch(request) {
      authorization = request.headers.get("authorization") ?? ""
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
    }, hostname: "127.0.0.1", port: 0 })
    servers.push(server)
    root()

    // When: the client reads the balance with the resolved credential.
    const response = await createWalletBalanceClient(`http://127.0.0.1:${server.port}`)
      .read({ credential: "stored-sentinel" })

    // Then: exactly one credentialed request returns the strict wallet document.
    expect({ authorization, response }).toEqual({ authorization: "Bearer stored-sentinel", response: body })
  })

  test.each([" token ", "x\ty", "x\ny"] as const)("rejects malformed credential %j before any request", async (credential) => {
    // Given: a credential that must never reach the Authorization header.
    let requests = 0
    const server = Bun.serve({ fetch() { requests += 1; return Response.json(body) }, hostname: "127.0.0.1", port: 0 })
    servers.push(server)
    root()

    // When: the client is asked to use it.
    const error = await failure(() => createWalletBalanceClient(`http://127.0.0.1:${server.port}`)
      .read({ credential }))

    // Then: validation fails locally with zero transport.
    expect({ code: error.code, requests, status: error.status }).toEqual({ code: "missing_wallet_credential", requests: 0, status: 0 })
  })

  test("returns cancelled for a pre-aborted caller without requesting", async () => {
    // Given: a caller signal that is already aborted.
    let requests = 0
    const server = Bun.serve({ fetch() { requests += 1; return Response.json(body) }, hostname: "127.0.0.1", port: 0 })
    servers.push(server)
    root()
    const controller = new AbortController()
    controller.abort()

    // When: the client reads with that signal.
    const error = await failure(() => createWalletBalanceClient(`http://127.0.0.1:${server.port}`)
      .read({ credential: "stored-sentinel", signal: controller.signal }))

    // Then: cancellation is reported locally with zero transport.
    expect({ code: error.code, requests, status: error.status }).toEqual({ code: "cancelled", requests: 0, status: 0 })
  })

  test("cancels an in-flight response when the caller aborts", async () => {
    // Given: a server that signals request arrival and then holds the response open.
    let requests = 0
    let arrived!: () => void
    const arrival = new Promise<void>((resolve) => { arrived = resolve })
    const server = Bun.serve({ fetch() {
      requests += 1
      arrived()
      return new Promise<Response>(() => {})
    }, hostname: "127.0.0.1", port: 0 })
    servers.push(server)
    root()
    const controller = new AbortController()

    // When: the request is in flight and the caller aborts.
    const pending = failure(() => createWalletBalanceClient(`http://127.0.0.1:${server.port}`)
      .read({ credential: "stored-sentinel", signal: controller.signal }))
    await Promise.race([arrival, Bun.sleep(5_000).then(() => { throw new Error("request never arrived") })])
    controller.abort()
    const error = await pending

    // Then: the in-flight request is cancelled exactly once.
    expect({ code: error.code, requests, status: error.status }).toEqual({ code: "cancelled", requests: 1, status: 0 })
  })

  test.each([301, 302, 303, 307, 308])("rejects %i without following it", async (status) => {
    // Given: a redirecting endpoint and a destination that must stay untouched.
    let redirected = 0
    const destination = Bun.serve({ fetch() { redirected += 1; return Response.json(body) }, hostname: "127.0.0.1", port: 0 })
    const source = Bun.serve({ fetch() { return new Response(null, { headers: { location: `http://127.0.0.1:${destination.port}` }, status }) }, hostname: "127.0.0.1", port: 0 })
    servers.push(destination, source)
    root()

    // When: the client reads from the redirecting origin.
    const error = await failure(() => createWalletBalanceClient(`http://127.0.0.1:${source.port}`)
      .read({ credential: "stored-sentinel" }))

    // Then: the redirect is rejected with its status and no follow.
    expect({ code: error.code, redirected, status: error.status }).toEqual({ code: "redirect_rejected", redirected: 0, status })
  })

  test("preserves the observed status when the response violates the contract", async () => {
    // Given: a 500 response whose body fails the wallet contract.
    const server = Bun.serve({ fetch() {
      return new Response("{}", { headers: { "content-type": "application/json" }, status: 500 })
    }, hostname: "127.0.0.1", port: 0 })
    servers.push(server)
    root()

    // When: the client parses it.
    const error = await failure(() => createWalletBalanceClient(`http://127.0.0.1:${server.port}`)
      .read({ credential: "stored-sentinel" }))

    // Then: automation can distinguish the remote 500 from a local failure.
    expect({ code: error.code, status: error.status }).toEqual({ code: "invalid_response", status: 500 })
  })

  test("fails closed before parsing a large or noncanonical response", async () => {
    // Given: one response with a forbidden field and one oversized declared body.
    let requestCount = 0
    const server = Bun.serve({ fetch() {
      requestCount += 1
      return requestCount === 1
        ? Response.json({ ...body, ignored: true })
        : new Response("x".repeat(65_537), { headers: { "content-length": "65537", "content-type": "application/json" } })
    }, hostname: "127.0.0.1", port: 0 })
    servers.push(server)
    root()
    const url = `http://127.0.0.1:${server.port}`

    // When: both responses are read.
    const extra = await failure(() => createWalletBalanceClient(url).read({ credential: "stored-sentinel" }))
    const large = await failure(() => createWalletBalanceClient(url).read({ credential: "stored-sentinel" }))

    // Then: both fail as invalid responses.
    expect([extra.code, large.code]).toEqual(["invalid_response", "invalid_response"])
  })
})
