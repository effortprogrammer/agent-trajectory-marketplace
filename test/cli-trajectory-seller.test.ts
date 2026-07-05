import { afterEach, expect, test } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  cleanupSellerWorkspaces,
  datasetSchema,
  manifestSchema,
  packageArgs,
  packageInspectSchema,
  packageOutputSchema,
  parseJson,
  prepareTrace,
  runCli,
  sellerSchema,
} from "./trajectory-seller-fixtures"

afterEach(() => {
  cleanupSellerWorkspaces()
})

test("trajectory seller package preserves closed-alpha marketplace metadata", async () => {
  const { workspace, exportPath } = await prepareTrace()
  const packageDir = join(workspace, "seller-package-with-metadata")
  const metadataPath = join(workspace, "marketplace-metadata.json")
  writeFileSync(metadataPath, `${JSON.stringify(marketplaceMetadataFixture, null, 2)}\n`, "utf8")

  const packageResult = await runCli([
    ...packageArgs(exportPath, packageDir),
    "--metadata",
    metadataPath,
  ])
  const inspectResult = await runCli([
    "trajectory",
    "seller",
    "inspect",
    "--path",
    packageDir,
    "--json",
  ])

  expect(packageResult.success).toBe(true)
  expect(inspectResult.success).toBe(true)
  const output = packageOutputSchema.parse(parseJson(packageResult.stdout))
  const inspected = packageInspectSchema.parse(parseJson(inspectResult.stdout))
  const manifest = manifestSchema.parse(parseJson(readFileSync(output.manifestPath, "utf8")))
  expect(output.metadataPath).toBe(output.manifestPath)
  expect(inspected.metadata?.price.display).toBe("Request access")
  expect(inspected.metadata?.license.name).toBe("Closed Alpha Evaluation")
  expect(inspected.metadata?.usageTerms.allowed).toContain("benchmarking")
  expect(inspected.metadata?.sellerProfile.displayName).toBe("Agent Local")
  expect(inspected.metadata?.sample.summary).toBe("Sanitized Hermes workflow sample")
  expect(inspected.metadata?.accessPolicy).toBe("request_required")
  expect(manifest.marketplace?.license.name).toBe("Closed Alpha Evaluation")
})

test("trajectory seller package rejects unsafe closed-alpha marketplace metadata", async () => {
  const { workspace, exportPath } = await prepareTrace()
  const metadataPath = join(workspace, "unsafe-marketplace-metadata.json")
  writeFileSync(
    metadataPath,
    `${JSON.stringify({
      ...marketplaceMetadataFixture,
      license: { name: "Closed Alpha Evaluation", url: "javascript:alert(1)" },
      sample: { summary: "x".repeat(4097), maxPreviewEvents: 3 },
    })}\n`,
    "utf8",
  )

  const result = await runCli([
    ...packageArgs(exportPath, join(workspace, "unsafe-package")),
    "--metadata",
    metadataPath,
  ])

  expect(result.success).toBe(false)
  expect(result.stderr).toContain("invalid_marketplace_metadata")
})

test("trajectory seller package creates and inspects a listing-ready self-log package", async () => {
  const { workspace, exportPath } = await prepareTrace()
  const packageDir = join(workspace, "seller-package")
  const result = await runCli(packageArgs(exportPath, packageDir))

  expect(result.success).toBe(true)
  const output = packageOutputSchema.parse(parseJson(result.stdout))
  expect(output.listingReady).toBe(true)
  expect(output.eventCount).toBe(6)
  expect(existsSync(output.tracePath)).toBe(true)
  const seller = sellerSchema.parse(parseJson(readFileSync(output.sellerPath, "utf8")))
  const dataset = datasetSchema.parse(parseJson(readFileSync(output.datasetPath, "utf8")))
  const manifest = manifestSchema.parse(parseJson(readFileSync(output.manifestPath, "utf8")))
  expect(seller.sellerId).toBe("agent-local")
  expect(dataset.title).toBe("Hermes demo self-log")
  expect(dataset.runtime).toBe("hermes")
  expect(manifest.checks.listingReady).toBe(true)

  const inspect = await runCli(["trajectory", "seller", "inspect", "--path", packageDir, "--json"])
  const inspected = packageInspectSchema.parse(parseJson(inspect.stdout))
  expect(inspect.success).toBe(true)
  expect(inspected.valid).toBe(true)
  expect(inspected.listingReady).toBe(true)
  expect(inspected.sellerId).toBe("agent-local")
  expect(inspected.filesVerified).toContain("trace.atf.json")
})

const marketplaceMetadataFixture = {
  schemaVersion: 1,
  price: { mode: "request_access", display: "Request access" },
  license: {
    name: "Closed Alpha Evaluation",
    url: "https://example.test/license",
  },
  usageTerms: {
    allowed: ["evaluation", "benchmarking"],
    prohibited: ["resale", "model training without written approval"],
  },
  sellerProfile: {
    displayName: "Agent Local",
    supportUrl: "https://example.test/support",
  },
  sample: {
    summary: "Sanitized Hermes workflow sample",
    maxPreviewEvents: 3,
  },
  accessPolicy: "request_required",
} as const
