import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { hostedSummarySchema, runHostedRegistrySmoke } from "../src/registry/hosted-e2e"
import { parseRegistryServeConfig, startRegistryServer } from "../src/registry/server"

const hostedE2eSummarySchema = hostedSummarySchema

const workspaces: string[] = []

afterEach(() => {
  while (workspaces.length > 0) {
    const workspace = workspaces.pop()
    if (workspace !== undefined) {
      rmSync(workspace, { force: true, recursive: true })
    }
  }
})

const createWorkspace = () => {
  const workspace = mkdtempSync(join(tmpdir(), "hosted-registry-e2e-test-"))
  workspaces.push(workspace)
  return workspace
}

const runHostedE2e = async (
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
) => {
  const child = Bun.spawn({
    cmd: [process.execPath, "scripts/hosted-registry-e2e.ts", ...args],
    cwd: process.cwd(),
    env: { ...process.env, ...env, LANG: "en_US.UTF-8" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() }
}

const githubSecretExpression = (name: string) => `${"$"}{{ secrets.${name} }}`

describe("hosted registry e2e script", () => {
  test("declares opt-in CI gating for the hosted smoke", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8")

    expect(workflow).toContain("workflow_dispatch")
    expect(workflow).toContain("HOSTED_REGISTRY_E2E_ENABLED")
    expect(workflow).toContain(
      `HOSTED_REGISTRY_URL: ${githubSecretExpression("HOSTED_REGISTRY_URL")}`,
    )
    expect(workflow).toContain(
      `HOSTED_REGISTRY_API_KEY: ${githubSecretExpression("HOSTED_REGISTRY_API_KEY")}`,
    )
    expect(workflow).toContain(
      `HOSTED_REGISTRY_BUYER_API_KEY: ${githubSecretExpression("HOSTED_REGISTRY_BUYER_API_KEY")}`,
    )
    expect(workflow).toContain("scripts/hosted-registry-e2e.ts")
  })

  test("fails validation when hosted smoke is not explicitly enabled", async () => {
    const result = await runHostedE2e(["--validate-env"], {
      HOSTED_REGISTRY_E2E_ENABLED: "",
      HOSTED_REGISTRY_URL: "",
      HOSTED_REGISTRY_API_KEY: "",
      HOSTED_REGISTRY_BUYER_API_KEY: "",
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("HOSTED_REGISTRY_E2E_ENABLED must be true")
  })

  test("requires a separate buyer API key for hosted marketplace reads", async () => {
    const result = await runHostedE2e(["--validate-env"], {
      HOSTED_REGISTRY_E2E_ENABLED: "true",
      HOSTED_REGISTRY_URL: "https://registry-staging.agent-trajectory-marketplace.com",
      HOSTED_REGISTRY_API_KEY: "seller-key",
      HOSTED_REGISTRY_BUYER_API_KEY: "",
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("HOSTED_REGISTRY_BUYER_API_KEY")
  })

  test("accepts a separate buyer API key for hosted marketplace reads", async () => {
    const result = await runHostedE2e(["--validate-env"], {
      HOSTED_REGISTRY_E2E_ENABLED: "true",
      HOSTED_REGISTRY_URL: "https://registry-staging.agent-trajectory-marketplace.com",
      HOSTED_REGISTRY_API_KEY: "seller-key",
      HOSTED_REGISTRY_BUYER_API_KEY: "buyer-key",
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('"ok":true')
  })

  test("prints buyer API key requirements in hosted smoke help", async () => {
    const result = await runHostedE2e(["--help"])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("HOSTED_REGISTRY_BUYER_API_KEY=<buyer API key>")
  })

  test("rejects production-looking public registry URLs unless explicitly allowed", async () => {
    const production = await runHostedE2e(["--validate-env"], {
      HOSTED_REGISTRY_E2E_ENABLED: "true",
      HOSTED_REGISTRY_URL: "https://registry.agent-trajectory-marketplace.com",
      HOSTED_REGISTRY_API_KEY: "test-key",
      HOSTED_REGISTRY_BUYER_API_KEY: "buyer-key",
    })
    const staging = await runHostedE2e(["--validate-env"], {
      HOSTED_REGISTRY_E2E_ENABLED: "true",
      HOSTED_REGISTRY_URL: "https://registry-staging.agent-trajectory-marketplace.com",
      HOSTED_REGISTRY_API_KEY: "test-key",
      HOSTED_REGISTRY_BUYER_API_KEY: "buyer-key",
    })
    const explicitlyAllowed = await runHostedE2e(["--validate-env"], {
      HOSTED_REGISTRY_E2E_ENABLED: "true",
      HOSTED_REGISTRY_URL: "https://registry.agent-trajectory-marketplace.com",
      HOSTED_REGISTRY_API_KEY: "test-key",
      HOSTED_REGISTRY_BUYER_API_KEY: "buyer-key",
      HOSTED_REGISTRY_E2E_ALLOW_PROD: "true",
    })

    expect(production.exitCode).toBe(1)
    expect(production.stderr).toContain("production-like")
    expect(staging.exitCode).toBe(0)
    expect(explicitlyAllowed.exitCode).toBe(0)
  })

  test("rejects unsafe hosted smoke probe summaries", () => {
    const safeSummary = {
      registryUrl: "http://127.0.0.1:4123",
      listingId: "listing-0123456789abcdef",
      wrongKeyExit: 1,
      extraFileStatus: 400,
      traversalStatus: 400,
      downloadInspectReady: true,
    }

    expect(() => hostedSummarySchema.parse({ ...safeSummary, wrongKeyExit: 0 })).toThrow()
    expect(() => hostedSummarySchema.parse({ ...safeSummary, extraFileStatus: 201 })).toThrow()
    expect(() => hostedSummarySchema.parse({ ...safeSummary, traversalStatus: 200 })).toThrow()
    expect(() =>
      hostedSummarySchema.parse({ ...safeSummary, downloadInspectReady: false }),
    ).toThrow()
  })

  test("writes the hosted summary shape during a fake local smoke run", async () => {
    const workspace = createWorkspace()
    const summaryPath = join(workspace, "summary.json")

    const result = await runHostedE2e(["--fake-local", "--summary", summaryPath])
    const summary = hostedE2eSummarySchema.parse(JSON.parse(readFileSync(summaryPath, "utf8")))

    expect(result.exitCode).toBe(0)
    expect(summary.wrongKeyExit).toBe(1)
    expect(summary.extraFileStatus).toBe(400)
    expect(summary.traversalStatus).toBe(400)
    expect(summary.downloadInspectReady).toBe(true)
    expect(result.stdout).toContain(summary.listingId)
    expect(summary.accountLoop).toMatchObject({
      signupStatus: 202,
      emailCode: "<redacted-email-code>",
      loginStatus: 200,
      accessRequestState: "requested",
      buyerWaitlistState: "requested",
      preApprovalGrantRejected: true,
      preGrantDownloadStatus: 403,
      postGrantDownloadStatus: 200,
      cliDownloadInspectReady: true,
      deviceLoginTokenPrinted: false,
      cliLogoutRevoked: true,
    })
    expect(result.stdout).not.toMatch(/"emailCode":\s*"\d{6}"/)
    expect(existsSync(join(process.cwd(), ".tmp", "hosted-registry-e2e-local-work"))).toBe(false)
  }, 60000)

  test("runs twice against one registry without deterministic listing conflicts", async () => {
    const workspaceRoot = join(process.cwd(), ".tmp")
    mkdirSync(workspaceRoot, { recursive: true })
    const workspace = mkdtempSync(join(workspaceRoot, "hosted-registry-e2e-repeat-"))
    workspaces.push(workspace)
    const server = startRegistryServer(
      parseRegistryServeConfig({
        host: "127.0.0.1",
        port: "0",
        db: join(workspace, "registry.sqlite"),
        storage: join(workspace, "storage"),
        tmp: join(workspace, "tmp"),
        sellerKey: "agent-local:test-key",
      }),
    )
    try {
      const first = await runHostedRegistrySmoke({
        apiKey: "test-key",
        buyerApiKey: "test-key",
        registryUrl: server.baseUrl,
        localRoot: join(workspace, "first"),
      })
      const second = await runHostedRegistrySmoke({
        apiKey: "test-key",
        buyerApiKey: "test-key",
        registryUrl: server.baseUrl,
        localRoot: join(workspace, "second"),
      })

      expect(second.listingId).not.toBe(first.listingId)
    } finally {
      await server.stop()
    }
  })
})
