import { expect, setDefaultTimeout, test } from "bun:test"

import { publicRoot } from "./marketplace-handler-test-support"

const processTimeoutMs = 30_000
setDefaultTimeout(processTimeoutMs + 10_000)

type ReadyMessage = Readonly<{
  marketplacePort: number
  registryConfigured: boolean
}>

type UpstreamMessage = Readonly<{
  method: string
  path: string
}>

const awaitIpc = async <Value>(signal: Promise<Value>): Promise<Value> => {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error("expected IPC event did not arrive")),
      processTimeoutMs,
    )
  })
  try {
    return await Promise.race([signal, deadline])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

test("Given a child-owned Registry and Marketplace When login is posted Then IPC proves request and teardown", async () => {
  const ready = Promise.withResolvers<ReadyMessage>()
  const upstream = Promise.withResolvers<UpstreamMessage>()
  const teardown = Promise.withResolvers<void>()
  const child = Bun.spawn(
    [process.execPath, "test/bun/web/server-process.fixture.ts"],
    {
      cwd: publicRoot,
      ipc(message) {
        if (
          typeof message !== "object"
          || message === null
          || !("type" in message)
        ) {
          return
        }
        if (
          message.type === "ready"
          && "marketplacePort" in message
          && typeof message.marketplacePort === "number"
          && "registryConfigured" in message
          && typeof message.registryConfigured === "boolean"
        ) {
          ready.resolve({
            marketplacePort: message.marketplacePort,
            registryConfigured: message.registryConfigured,
          })
        }
        if (
          message.type === "upstream-request"
          && "method" in message
          && typeof message.method === "string"
          && "path" in message
          && typeof message.path === "string"
        ) {
          upstream.resolve({ method: message.method, path: message.path })
        }
        if (message.type === "teardown-complete") teardown.resolve()
      },
      stderr: "pipe",
      stdout: "pipe",
      timeout: processTimeoutMs,
    },
  )

  try {
    const readiness = await awaitIpc(ready.promise)
    expect(readiness.registryConfigured).toBeTrue()
    const responsePromise = fetch(
      `http://127.0.0.1:${readiness.marketplacePort}/api/registry/v1/auth/login`,
      {
        body: JSON.stringify({ email: "owner@example.test" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    )

    const [requestEvent, response] = await Promise.all([
      awaitIpc(upstream.promise),
      responsePromise,
    ])

    expect(requestEvent).toEqual({ method: "POST", path: "/v1/auth/login" })
    expect(response.status).toBe(200)
  } finally {
    if (child.exitCode === null) child.send({ type: "shutdown" })
    await awaitIpc(teardown.promise)
    expect(await child.exited).toBe(0)
  }
})
