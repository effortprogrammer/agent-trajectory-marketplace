import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

const railwayConfigSchema = z
  .object({
    build: z
      .object({
        builder: z.literal("NIXPACKS"),
      })
      .strict(),
    deploy: z
      .object({
        healthcheckPath: z.literal("/health"),
        restartPolicyType: z.literal("ON_FAILURE"),
        startCommand: z.literal("bun src/cli/index.ts trajectory registry serve --hosted"),
      })
      .strict(),
  })
  .strict()

const requiredHostedEnvNames = [
  "REGISTRY_ENV",
  "REGISTRY_HOST",
  "REGISTRY_PORT",
  "REGISTRY_PUBLIC_BASE_URL",
  "STAGING_REGISTRY_URL",
  "PRODUCTION_REGISTRY_URL",
  "REGISTRY_DB_BACKEND",
  "REGISTRY_DB_MIGRATIONS_DIR",
  "REGISTRY_DB_PATH",
  "REGISTRY_BACKUP_BUCKET",
  "REGISTRY_PACKAGE_STORAGE_BACKEND",
  "REGISTRY_PACKAGE_BUCKET",
  "REGISTRY_PACKAGE_STORAGE_REGION",
  "REGISTRY_PACKAGE_STORAGE_ACCESS_KEY_ID",
  "REGISTRY_PACKAGE_STORAGE_SECRET_ACCESS_KEY",
  "REGISTRY_TMP_ROOT",
  "REGISTRY_ACCESS_RECORDS",
  "REGISTRY_ADMIN_KEY_HASHES",
  "REGISTRY_LOG_LEVEL",
  "REGISTRY_OTEL_EXPORTER_OTLP_ENDPOINT",
] as const

describe("Railway staging deployment package", () => {
  test("Given Todo 13 staging deploy prep When Railway config is read Then hosted serve starts without production targeting", () => {
    const railwayConfig = railwayConfigSchema.parse(
      JSON.parse(readFileSync("railway.json", "utf8")),
    )
    const serializedConfig = JSON.stringify(railwayConfig)

    expect(railwayConfig.deploy.startCommand).toBe(
      "bun src/cli/index.ts trajectory registry serve --hosted",
    )
    expect(serializedConfig).not.toContain("PRODUCTION_REGISTRY_URL")
    expect(serializedConfig).not.toContain("registry.agent-trajectory-marketplace.com")
  })

  test("Given Todo 13 staging deploy prep When validation script is inspected Then required env and rollback dry-run are explicit", () => {
    const scriptPath = "scripts/railway-staging-preflight.ts"
    const script = readFileSync(scriptPath, "utf8")

    expect(script).toContain("validate-env-template")
    expect(script).toContain("rollback-dry-run")
    for (const envName of requiredHostedEnvNames) {
      expect(script).toContain(envName)
    }
    expect(script).toContain("HOSTED_REGISTRY_E2E_ENABLED")
    expect(script).toContain("scripts/hosted-registry-e2e.ts --validate-env")
    expect(script).not.toContain("HOSTED_REGISTRY_E2E_ALLOW_PROD")
  })

  test("Given a poisoned redaction placeholder When env template preflight runs Then validation fails without writing success evidence", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "railway-staging-preflight-"))
    try {
      // Given: a staging env template whose secret placeholder has appended secret-like content.
      const templatePath = join(workspace, "railway-staging.env.example")
      const evidencePath = join(workspace, "poisoned-redaction-evidence.json")
      const poisonedTemplate = readFileSync("docs/railway-staging.env.example", "utf8").replace(
        "REGISTRY_PACKAGE_STORAGE_SECRET_ACCESS_KEY=<redacted:filesystem-adapter-placeholder>",
        "REGISTRY_PACKAGE_STORAGE_SECRET_ACCESS_KEY=<redacted:filesystem-adapter-placeholder>leaked-secret",
      )
      writeFileSync(templatePath, poisonedTemplate, "utf8")

      // When: the preflight is executed through the CLI surface.
      const child = Bun.spawn({
        cmd: [
          "bun",
          "scripts/railway-staging-preflight.ts",
          "validate-env-template",
          "--template",
          templatePath,
          "--evidence",
          evidencePath,
        ],
        stderr: "pipe",
        stdout: "pipe",
      })
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])

      // Then: validation rejects the poisoned placeholder and never writes success evidence.
      expect(exitCode).not.toBe(0)
      expect(stderr).toContain("staging env template is incomplete or contains unredacted secrets")
      expect(stdout).not.toContain(evidencePath)
      expect(existsSync(evidencePath)).toBe(false)
    } finally {
      rmSync(workspace, { force: true, recursive: true })
    }
  })

  test("Given Todo 13 staging deploy prep When operator docs are present Then actual Railway resource creation remains out of scope", () => {
    const docsPath = "docs/marketplace-staging-railway.md"

    expect(existsSync(docsPath)).toBe(true)
    const docs = readFileSync(docsPath, "utf8")
    expect(docs).toContain("Do not run production deploys from this checklist")
    expect(docs).toContain("staging-only")
    expect(docs).toContain("rollback dry-run")
  })
})
