import { afterEach, describe, expect, test } from "bun:test"

import {
  PayoutRequestClientError,
  createPayoutRequestClient,
} from "../../../src/marketplace/payout-request-client"

const weeklyLimitBody =
  '{"ok":false,"error":{"code":"weekly_payout_limit_reached","message":"The rolling weekly payout limit has been reached."}}'
const servers: Bun.Server<undefined>[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

const failure = async (
  action: () => Promise<unknown>,
): Promise<PayoutRequestClientError> => {
  try {
    await action()
  } catch (error) {
    if (error instanceof PayoutRequestClientError) return error
    throw error
  }
  throw new TypeError("expected payout request failure")
}

describe("weekly payout limit", () => {
  test("preserves the registry cap code and rolling-window retry delay", async () => {
    // Given: the registry reports an exhausted rolling payout window.
    const server = Bun.serve({
      fetch: () =>
        new Response(weeklyLimitBody, {
          headers: {
            "content-type": "application/json",
            "retry-after": "3600",
          },
          status: 429,
        }),
      hostname: "127.0.0.1",
      port: 0,
    })
    servers.push(server)

    // When: the payout client submits a canonical request.
    const error = await failure(() =>
      createPayoutRequestClient(`http://127.0.0.1:${server.port}`).create({
        credential: "session-sentinel",
        operationId: "00000000-0000-4000-8000-000000000801",
      }),
    )

    // Then: callers receive the exact policy code and retry boundary.
    expect({
      code: error.code,
      registry: error.registry,
      retryAfterSeconds: error.retryAfterSeconds,
      status: error.status,
    }).toEqual({
      code: "registry_error",
      registry: {
        code: "weekly_payout_limit_reached",
        message: "The rolling weekly payout limit has been reached.",
      },
      retryAfterSeconds: 3600,
      status: 429,
    })
  })
})
