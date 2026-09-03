import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { officialRegistryOrigin } from "../../../src/auth/official-origin"
import { writeStoredAuthSession } from "../../../src/auth/store"

const roots: string[] = []
const servers: Bun.Server<undefined>[] = []

beforeAll(() => {
  const build = Bun.spawnSync(
    [process.execPath, "run", "build:collector"],
    { cwd: process.cwd(), stderr: "pipe", stdout: "pipe" },
  )
  if (build.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(build.stderr))
  }
})

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true })
  }
})

describe("marketplace weekly payout limit process", () => {
  test("prints the policy code instead of the generic registry wrapper", async () => {
    // Given: an active seller session and a registry with no weekly capacity.
    const root = mkdtempSync(join(tmpdir(), "weekly-payout-limit-cli-"))
    roots.push(root)
    writeStoredAuthSession(
      {
        accessToken: "weekly-limit-session",
        accountId: "acct-0123456789abcdef",
        expiresAt: "2099-01-01T00:00:00.000Z",
        server: officialRegistryOrigin,
        tokenType: "Bearer",
      },
      {
        storePath: join(
          root,
          "agent-trajectory-marketplace",
          "auth.json",
        ),
      },
    )
    const server = Bun.serve({
      fetch: () =>
        new Response(
          '{"ok":false,"error":{"code":"weekly_payout_limit_reached","message":"The rolling weekly payout limit has been reached."}}',
          {
            headers: {
              "content-type": "application/json",
              "retry-after": "3600",
            },
            status: 429,
          },
        ),
      hostname: "127.0.0.1",
      port: 0,
    })
    servers.push(server)

    // When: the built CLI requests another payout.
    const child = Bun.spawn(
      [
        process.execPath,
        "--preload",
        "./test/bun/fixtures/gateway-fetch-preload.ts",
        "dist/collector.js",
        "marketplace",
        "seller",
        "payout",
        "request",
        "--operation-id",
        "00000000-0000-4000-8000-000000000802",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRAJECTORY_MARKETPLACE_CONFIG_HOME: root,
          TRAJECTORY_TEST_GATEWAY_TARGET: `http://127.0.0.1:${server.port}`,
        },
        stderr: "pipe",
        stdout: "pipe",
      },
    )
    const [exitCode, stderr, stdout] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
    ])

    // Then: automation sees the specific policy rejection and no credential.
    expect({ exitCode, stderr, stdout }).toEqual({
      exitCode: 1,
      stderr: '{"error":"weekly_payout_limit_reached"}\n',
      stdout: "",
    })
    expect(stderr).not.toContain("weekly-limit-session")
  })
})
