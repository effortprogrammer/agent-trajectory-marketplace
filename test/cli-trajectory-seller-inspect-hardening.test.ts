import { afterEach, expect, test } from "bun:test"
import { readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  cleanupSellerWorkspaces,
  datasetSchema,
  manifestSchema,
  packageArgs,
  parseJson,
  prepareTrace,
  rewriteManifestHashes,
  runCli,
} from "./trajectory-seller-fixtures"

afterEach(() => {
  cleanupSellerWorkspaces()
})

test("trajectory seller inspect rejects surplus manifest file entries", async () => {
  const { workspace, exportPath } = await prepareTrace()
  const packageDir = join(workspace, "seller-package")
  expect((await runCli(packageArgs(exportPath, packageDir))).success).toBe(true)

  const manifestPath = join(packageDir, "manifest.json")
  const manifest = manifestSchema.parse(parseJson(readFileSync(manifestPath, "utf8")))
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        ...manifest,
        files: [...manifest.files, { path: "../../outside", sha256: "not-a-real-package-file" }],
      },
      null,
      2,
    )}\n`,
    "utf8",
  )

  const result = await runCli(["trajectory", "seller", "inspect", "--path", packageDir, "--json"])
  expect(result.success).toBe(false)
  expect(result.stderr).toContain("invalid_manifest_json")
})

test("trajectory seller inspect rejects invalid preview JSON even when hashes are recomputed", async () => {
  const { workspace, exportPath } = await prepareTrace()
  const packageDir = join(workspace, "seller-package")
  expect((await runCli(packageArgs(exportPath, packageDir))).success).toBe(true)

  writeFileSync(join(packageDir, "preview.json"), "#!/bin/sh\necho pwned\n", "utf8")
  rewriteManifestHashes(packageDir)

  const result = await runCli(["trajectory", "seller", "inspect", "--path", packageDir, "--json"])
  expect(result.success).toBe(false)
  expect(result.stderr).toContain("invalid_preview_json")
})

test("trajectory seller inspect rejects dataset metadata drift from the trace", async () => {
  const { workspace, exportPath } = await prepareTrace()
  const packageDir = join(workspace, "seller-package")
  expect((await runCli(packageArgs(exportPath, packageDir))).success).toBe(true)

  const datasetPath = join(packageDir, "dataset.json")
  const dataset = datasetSchema.parse(parseJson(readFileSync(datasetPath, "utf8")))
  writeFileSync(
    datasetPath,
    `${JSON.stringify({ ...dataset, runtime: "fake-runtime" }, null, 2)}\n`,
    "utf8",
  )
  rewriteManifestHashes(packageDir)

  const result = await runCli(["trajectory", "seller", "inspect", "--path", packageDir, "--json"])
  expect(result.success).toBe(false)
  expect(result.stderr).toContain("invalid_dataset_json")
})

test("trajectory seller inspect rejects forged trace-derived package identifiers", async () => {
  const { workspace, exportPath } = await prepareTrace()
  const packageDir = join(workspace, "seller-package")
  expect((await runCli(packageArgs(exportPath, packageDir))).success).toBe(true)

  const datasetPath = join(packageDir, "dataset.json")
  const dataset = datasetSchema.parse(parseJson(readFileSync(datasetPath, "utf8")))
  writeFileSync(
    datasetPath,
    `${JSON.stringify({ ...dataset, datasetId: "agent-log-forged" }, null, 2)}\n`,
    "utf8",
  )
  const manifestPath = join(packageDir, "manifest.json")
  const manifest = manifestSchema.parse(parseJson(readFileSync(manifestPath, "utf8")))
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ ...manifest, packageId: "seller-package-forged" }, null, 2)}\n`,
    "utf8",
  )
  rewriteManifestHashes(packageDir)

  const result = await runCli(["trajectory", "seller", "inspect", "--path", packageDir, "--json"])
  expect(result.success).toBe(false)
  expect(result.stderr).toContain("invalid_dataset_json")
})

test("trajectory seller inspect rejects unknown dataset listing claims", async () => {
  const { workspace, exportPath } = await prepareTrace()
  const packageDir = join(workspace, "seller-package")
  expect((await runCli(packageArgs(exportPath, packageDir))).success).toBe(true)

  const datasetPath = join(packageDir, "dataset.json")
  const dataset = datasetSchema.parse(parseJson(readFileSync(datasetPath, "utf8")))
  writeFileSync(
    datasetPath,
    `${JSON.stringify(
      { ...dataset, marketplaceClaim: "exclusive-human-curated-premium-dataset" },
      null,
      2,
    )}\n`,
    "utf8",
  )
  rewriteManifestHashes(packageDir)

  const result = await runCli(["trajectory", "seller", "inspect", "--path", packageDir, "--json"])
  expect(result.success).toBe(false)
  expect(result.stderr).toContain("invalid_dataset_json")
})

test("trajectory seller inspect rejects symlinked managed package files", async () => {
  const { workspace, exportPath } = await prepareTrace()
  const packageDir = join(workspace, "seller-package")
  const outsidePreview = "/tmp/trajectory-marketplace-seller-preview.json"
  expect((await runCli(packageArgs(exportPath, packageDir))).success).toBe(true)

  rmSync(outsidePreview, { force: true })
  writeFileSync(outsidePreview, readFileSync(join(packageDir, "preview.json"), "utf8"), "utf8")
  rmSync(join(packageDir, "preview.json"), { force: true })
  symlinkSync(outsidePreview, join(packageDir, "preview.json"))
  rewriteManifestHashes(packageDir)

  const result = await runCli(["trajectory", "seller", "inspect", "--path", packageDir, "--json"])
  rmSync(outsidePreview, { force: true })

  expect(result.success).toBe(false)
  expect(result.stderr).toContain("invalid_package_path")
})

test("trajectory seller inspect reports missing package files with a typed error", async () => {
  const { workspace, exportPath } = await prepareTrace()
  const packageDir = join(workspace, "seller-package")
  expect((await runCli(packageArgs(exportPath, packageDir))).success).toBe(true)

  rmSync(join(packageDir, "preview.json"), { force: true })

  const result = await runCli(["trajectory", "seller", "inspect", "--path", packageDir, "--json"])
  expect(result.success).toBe(false)
  expect(result.stderr).toContain("missing_package_file")
})
