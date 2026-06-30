import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
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
  rewriteManifestHashes,
  runCli,
  sellerSchema,
  sha256File,
  traceSchema,
} from "./trajectory-seller-fixtures"

afterEach(() => {
  cleanupSellerWorkspaces()
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
  expect(manifest.files.map((file) => file.path)).toEqual(
    expect.arrayContaining([
      "seller.json",
      "dataset.json",
      "trace.atf.json",
      "preview.json",
      "redaction-report.json",
    ]),
  )

  const inspect = await runCli(["trajectory", "seller", "inspect", "--path", packageDir, "--json"])
  expect(inspect.success).toBe(true)
  const inspected = packageInspectSchema.parse(parseJson(inspect.stdout))
  expect(inspected.valid).toBe(true)
  expect(inspected.listingReady).toBe(true)
  expect(inspected.sellerId).toBe("agent-local")
  expect(inspected.eventCount).toBe(6)
  expect(inspected.filesVerified).toContain("trace.atf.json")
})

test("trajectory seller package rejects traces with unredacted secrets", async () => {
  const { workspace, exportPath } = await prepareTrace()
  const trace = traceSchema.parse(parseJson(readFileSync(exportPath, "utf8")))
  writeFileSync(
    exportPath,
    JSON.stringify({
      ...trace,
      events: trace.events.map((event) =>
        event.kind === "verification" ? { ...event, detail: "api_key leaked-secret" } : event,
      ),
    }),
  )

  const result = await runCli(packageArgs(exportPath, join(workspace, "bad-package")))
  expect(result.success).toBe(false)
  expect(result.stderr).toContain("unredacted_secret")
})

test("trajectory seller package rejects traces that are not marketplace ready", async () => {
  const { workspace, exportPath } = await prepareTrace()
  const trace = traceSchema.parse(parseJson(readFileSync(exportPath, "utf8")))
  writeFileSync(
    exportPath,
    JSON.stringify({
      ...trace,
      status: "draft",
    }),
    "utf8",
  )

  const packageDir = join(workspace, "not-ready-package")
  const result = await runCli(packageArgs(exportPath, packageDir))
  expect(result.success).toBe(false)
  expect(result.stderr).toContain("trace_not_marketplace_ready")
  expect(existsSync(join(packageDir, "manifest.json"))).toBe(false)
})

test("trajectory seller package rejects symlinked output directories outside the repository", async () => {
  const { workspace, exportPath } = await prepareTrace()
  const outsideDir = "/tmp/trajectory-marketplace-seller-package"
  const symlinkedDir = join(workspace, "symlinked-package")

  rmSync(outsideDir, { force: true, recursive: true })
  mkdirSync(outsideDir, { recursive: true })
  symlinkSync(outsideDir, symlinkedDir, "dir")

  const result = await runCli(packageArgs(exportPath, symlinkedDir))
  const manifestEscaped = existsSync(join(outsideDir, "manifest.json"))
  rmSync(outsideDir, { force: true, recursive: true })

  expect(result.success).toBe(false)
  expect(result.stderr).toContain("invalid_output_path")
  expect(manifestEscaped).toBe(false)
})

test("trajectory seller package rejects preexisting symlinked package files", async () => {
  const { workspace, exportPath } = await prepareTrace()
  const outsideManifest = "/tmp/trajectory-marketplace-seller-manifest.json"
  const packageDir = join(workspace, "package-with-symlink-file")

  rmSync(outsideManifest, { force: true })
  mkdirSync(packageDir, { recursive: true })
  symlinkSync(outsideManifest, join(packageDir, "manifest.json"))

  const result = await runCli(packageArgs(exportPath, packageDir))
  const escapedManifest = existsSync(outsideManifest)
  rmSync(outsideManifest, { force: true })

  expect(result.success).toBe(false)
  expect(result.stderr).toContain("invalid_output_path")
  expect(escapedManifest).toBe(false)
})

test("trajectory seller package rejects unmanifested preexisting files", async () => {
  const { workspace, exportPath } = await prepareTrace()
  const packageDir = join(workspace, "package-with-extra-file")

  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, "run.sh"), "#!/bin/sh\necho pwned\n", "utf8")

  const result = await runCli(packageArgs(exportPath, packageDir))
  expect(result.success).toBe(false)
  expect(result.stderr).toContain("invalid_package_contents")
  expect(existsSync(join(packageDir, "manifest.json"))).toBe(false)
})

test("trajectory seller inspect rejects tampered package files", async () => {
  const { workspace, exportPath } = await prepareTrace()
  const packageDir = join(workspace, "seller-package")
  expect((await runCli(packageArgs(exportPath, packageDir))).success).toBe(true)

  writeFileSync(join(packageDir, "trace.atf.json"), JSON.stringify({ tampered: true }), "utf8")

  const result = await runCli(["trajectory", "seller", "inspect", "--path", packageDir, "--json"])
  expect(result.success).toBe(false)
  expect(result.stderr).toContain("package_hash_mismatch")
})

test("trajectory seller inspect revalidates trace even when package hashes are recomputed", async () => {
  const { workspace, exportPath } = await prepareTrace()
  const packageDir = join(workspace, "seller-package")
  expect((await runCli(packageArgs(exportPath, packageDir))).success).toBe(true)

  const tracePath = join(packageDir, "trace.atf.json")
  const trace = traceSchema.parse(parseJson(readFileSync(tracePath, "utf8")))
  writeFileSync(
    tracePath,
    JSON.stringify({
      ...trace,
      events: trace.events.map((event) =>
        event.kind === "verification"
          ? { ...event, detail: "authorization bearer seller-secret" }
          : event,
      ),
    }),
    "utf8",
  )

  const datasetPath = join(packageDir, "dataset.json")
  const dataset = datasetSchema.parse(parseJson(readFileSync(datasetPath, "utf8")))
  writeFileSync(
    datasetPath,
    `${JSON.stringify({ ...dataset, traceSha256: sha256File(tracePath) }, null, 2)}\n`,
    "utf8",
  )
  rewriteManifestHashes(packageDir)

  const result = await runCli(["trajectory", "seller", "inspect", "--path", packageDir, "--json"])
  expect(result.success).toBe(false)
  expect(result.stderr).toContain("unredacted_secret")
})

test("trajectory seller inspect rejects unmanifested package files", async () => {
  const { workspace, exportPath } = await prepareTrace()
  const packageDir = join(workspace, "seller-package")
  expect((await runCli(packageArgs(exportPath, packageDir))).success).toBe(true)

  writeFileSync(join(packageDir, "run.sh"), "#!/bin/sh\necho pwned\n", "utf8")

  const result = await runCli(["trajectory", "seller", "inspect", "--path", packageDir, "--json"])
  expect(result.success).toBe(false)
  expect(result.stderr).toContain("invalid_package_contents")
})
