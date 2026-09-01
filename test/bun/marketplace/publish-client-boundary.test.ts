import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { createServer } from "node:net"
import type { AddressInfo, Server, Socket } from "node:net"

import {
  parsePublishBundle,
} from "../../../src/marketplace/publish-bundle"
import {
  createPublishClient,
  PublishClientError,
} from "../../../src/marketplace/publish-client"
import { createPublishFrameBody, parsePublishFrame } from "../../../src/marketplace/publish-frame"

const servers: Bun.Server<undefined>[] = []
const tcpServers: Server[] = []
const tcpSockets = new Set<Socket>()

const validBundle = () => {
  const fixture = parsePublishFrame(readFileSync("contract/publish-wire/v1/candidate-valid.frame"))
  return parsePublishBundle(Buffer.from(fixture.archive))
}

const serve = (fetch: (request: Request) => Response | Promise<Response>): Bun.Server<undefined> => {
  const server = Bun.serve({ fetch, hostname: "127.0.0.1", port: 0 })
  servers.push(server)
  return server
}

const expectClientError = async (action: () => Promise<unknown>): Promise<PublishClientError> => {
  try {
    await action()
  } catch (error) {
    if (error instanceof PublishClientError) return error
    throw error
  }
  throw new TypeError("expected PublishClientError")
}

const boundedOutcome = async (
  action: Promise<unknown>,
): Promise<Readonly<{ readonly code: string; readonly status: number }> | "deadline" | "success"> => {
  const deadline = AbortSignal.timeout(250)
  return Promise.race([
    action.then(
      () => "success" as const,
      (error: unknown) => error instanceof PublishClientError
        ? { code: error.code, status: error.status }
        : { code: "unexpected_error", status: 0 },
    ),
    new Promise<"deadline">((resolve) => {
      deadline.addEventListener("abort", () => resolve("deadline"), { once: true })
    }),
  ])
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
  for (const socket of tcpSockets) socket.destroy()
  tcpSockets.clear()
  for (const server of tcpServers.splice(0)) server.close()
})

describe("candidate publish client boundaries", () => {
  test("rejects direct invalid credentials before consuming the bundle or requesting", async () => {
    // Given: an admitted bundle, malformed direct credential, and a request counter.
    const bundle = validBundle()
    let hits = 0
    const server = serve(() => {
      hits += 1
      return new Response(null, { status: 503 })
    })

    // When: the exported client receives a credential containing forbidden whitespace.
    const error = await expectClientError(() =>
      createPublishClient(`http://127.0.0.1:${server.port}`).publish({
        bundle,
        credential: " invalid-direct ",
      }),
    )

    // Then: admission remains available because validation precedes ownership transfer.
    let reuseCode = ""
    try {
      const frame = createPublishFrameBody(bundle)
      await frame.body.cancel()
    } catch (reuseError) {
      reuseCode = reuseError instanceof Error ? reuseError.message : String(reuseError)
    }
    expect({ code: error.code, hits, reuseCode, status: error.status }).toEqual({
      code: "missing_publish_credential",
      hits: 0,
      reuseCode: "",
      status: 0,
    })
  })

  test("cancels an in-flight response when the caller aborts", async () => {
    // Given: a request that reaches a live server whose response remains open.
    const requestArrived = Promise.withResolvers<void>()
    const responseCancelled = Promise.withResolvers<void>()
    const responseStarted = Promise.withResolvers<void>()
    const server = serve(async (request) => {
      await request.arrayBuffer()
      requestArrived.resolve()
      return new Response(new ReadableStream<Uint8Array>({
        cancel() {
          responseCancelled.resolve()
        },
        start(controller) {
          controller.enqueue(new Uint8Array([0x7b]))
          responseStarted.resolve()
        },
      }), { status: 202 })
    })
    const controller = new AbortController()
    const action = createPublishClient(`http://127.0.0.1:${server.port}`).publish({
      bundle: validBundle(),
      credential: "flag-sentinel",
      signal: controller.signal,
    })
    await Promise.all([requestArrived.promise, responseStarted.promise])

    // When: the exact caller-owned abort signal fires after transport begins.
    controller.abort()

    // Then: the request terminates promptly with a stable local cancellation code.
    expect(await boundedOutcome(action)).toEqual({ code: "cancelled", status: 0 })
    const cancellationDeadline = AbortSignal.timeout(250)
    expect(await Promise.race([
      responseCancelled.promise.then(() => "cancelled" as const),
      new Promise<"deadline">((resolve) => {
        cancellationDeadline.addEventListener("abort", () => resolve("deadline"), { once: true })
      }),
    ])).toBe("cancelled")
  })

  test("rejects oversized declared response length before awaiting body bytes", async () => {
    // Given: raw local HTTP headers declaring a body beyond policy while the body remains open.
    const responseStarted = Promise.withResolvers<void>()
    const server = createServer((socket) => {
      tcpSockets.add(socket)
      socket.once("data", () => {
        socket.write([
          "HTTP/1.1 202 Accepted",
          `Content-Length: ${64 * 1024 + 1}`,
          "Content-Type: application/json",
          "Connection: close",
          "",
          "",
        ].join("\r\n"))
        responseStarted.resolve()
      })
    })
    tcpServers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject)
        resolve()
      })
    })
    const address = server.address() as AddressInfo
    const action = createPublishClient(`http://127.0.0.1:${address.port}`).publish({
      bundle: validBundle(),
      credential: "flag-sentinel",
    })
    await responseStarted.promise

    // When/Then: the declaration is enough to cancel and reject without an unbounded read.
    expect(await boundedOutcome(action)).toEqual({ code: "invalid_response", status: 202 })
  })
})
