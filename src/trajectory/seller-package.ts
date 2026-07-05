import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs"

import { inspectTrace, inspectTraceFile } from "./evidence"
import { resolveReadableProjectPath, resolveWritableProjectPath } from "./path-safety"
import { assertPackageClaimsMatch } from "./seller-package-claims"
import {
  datasetFileSchema,
  fallbackMarketplaceMetadata,
  inspectPackageInputSchema,
  manifestFileSchema,
  marketplaceMetadataSchema,
  packageFilePaths,
  previewFileSchema,
  redactionReportFileSchema,
  SellerPackageError,
  SellerPackageErrorCode,
  sellerFileSchema,
  sellerPackageInputSchema,
} from "./seller-package-contract"
import {
  assertClosedPackageDirectory,
  assertManifestFileList,
  assertManifestHash,
  assertUsableDirectory,
  fileEntry,
  readJsonFile,
  requirePackageFile,
  sha256File,
  throwSellerPathError,
  writablePackageFilePath,
  writeJsonFile,
} from "./seller-package-files"

const packageManifestFilePath = "manifest.json"
const packageDirectoryFilePaths = [...packageFilePaths, packageManifestFilePath] as const

const assertMarketplaceReady = (marketplaceReady: boolean, tracePath: string) => {
  if (!marketplaceReady) {
    throw new SellerPackageError(
      SellerPackageErrorCode.TraceNotMarketplaceReady,
      `trace_not_marketplace_ready: ${tracePath}`,
    )
  }
}

export const createSellerPackage = (input: {
  readonly metadataPath?: string
  readonly outDir: string
  readonly sellerId: string
  readonly title: string
  readonly tracePath: string
}) => {
  const parsed = sellerPackageInputSchema.parse(input)
  const inspect = inspectTrace({ tracePath: parsed.tracePath })
  assertMarketplaceReady(inspect.marketplaceReady, inspect.tracePath)
  const metadata =
    parsed.metadataPath === undefined
      ? undefined
      : readJsonFile(
          resolveReadableProjectPath({
            inputPath: parsed.metadataPath,
            code: SellerPackageErrorCode.InvalidMarketplaceMetadata,
            throwPathError: throwSellerPathError,
          }),
          marketplaceMetadataSchema,
          SellerPackageErrorCode.InvalidMarketplaceMetadata,
        )
  const packageDir = resolveWritableProjectPath({
    inputPath: parsed.outDir,
    code: SellerPackageErrorCode.InvalidOutputPath,
    throwPathError: throwSellerPathError,
  })
  const sellerPath = writablePackageFilePath(packageDir, "seller.json")
  const datasetPath = writablePackageFilePath(packageDir, "dataset.json")
  const tracePath = writablePackageFilePath(packageDir, "trace.atf.json")
  const previewPath = writablePackageFilePath(packageDir, "preview.json")
  const redactionReportPath = writablePackageFilePath(packageDir, "redaction-report.json")
  const manifestPath = writablePackageFilePath(packageDir, packageManifestFilePath)
  const cleanupOnFailure = !existsSync(packageDir)

  assertUsableDirectory(packageDir, SellerPackageErrorCode.InvalidOutputPath)
  assertClosedPackageDirectory(packageDir, packageFilePaths)

  try {
    mkdirSync(packageDir, { recursive: true })
    copyFileSync(inspect.tracePath, tracePath)

    const traceSha256 = sha256File(tracePath)
    const packageId = `seller-package-${traceSha256.slice(0, 16)}`
    const datasetId = `agent-log-${traceSha256.slice(0, 16)}`

    writeJsonFile(sellerPath, {
      schemaVersion: 1,
      kind: "trajectory-seller",
      sellerId: parsed.sellerId,
      rights: "self_generated_agent_log",
      createdAt: new Date().toISOString(),
    })
    writeJsonFile(datasetPath, {
      schemaVersion: 1,
      kind: "agent-log-dataset",
      datasetId,
      title: parsed.title,
      runtime: inspect.runtime,
      status: inspect.status,
      eventCount: inspect.eventCount,
      eventKinds: inspect.eventKinds,
      traceSha256,
      purpose: "sellable_self_log_dataset",
    })
    writeJsonFile(previewPath, {
      schemaVersion: 1,
      kind: "agent-log-preview",
      runtime: inspect.runtime,
      status: inspect.status,
      eventCount: inspect.eventCount,
      eventKinds: inspect.eventKinds,
    })
    writeJsonFile(redactionReportPath, {
      schemaVersion: 1,
      kind: "redaction-report",
      redactionClean: inspect.checks.redactionClean,
      redactedFindings: inspect.redactedFindings,
    })
    writeJsonFile(manifestPath, {
      schemaVersion: 1,
      kind: "trajectory-seller-package",
      packageId,
      createdAt: new Date().toISOString(),
      files: packageFilePaths.map((filePath) => fileEntry(packageDir, filePath)),
      checks: {
        listingReady: inspect.marketplaceReady,
        marketplaceReady: inspect.marketplaceReady,
        redactionClean: inspect.checks.redactionClean,
      },
      ...(metadata === undefined ? {} : { marketplace: metadata }),
    })
  } catch (error) {
    if (cleanupOnFailure) {
      rmSync(packageDir, { force: true, recursive: true })
    }
    throw error
  }

  return {
    packageDir,
    manifestPath,
    datasetPath,
    sellerPath,
    tracePath,
    listingReady: inspect.marketplaceReady,
    eventCount: inspect.eventCount,
    ...(metadata === undefined ? {} : { metadataPath: manifestPath }),
  }
}

export const inspectSellerPackageDirectory = (packageDir: string) => {
  assertUsableDirectory(packageDir, SellerPackageErrorCode.InvalidPackagePath)
  assertClosedPackageDirectory(packageDir, packageDirectoryFilePaths)

  const manifest = readJsonFile(
    requirePackageFile(packageDir, packageManifestFilePath),
    manifestFileSchema,
    SellerPackageErrorCode.InvalidManifestJson,
  )
  const seller = readJsonFile(
    requirePackageFile(packageDir, "seller.json"),
    sellerFileSchema,
    SellerPackageErrorCode.InvalidSellerJson,
  )
  const dataset = readJsonFile(
    requirePackageFile(packageDir, "dataset.json"),
    datasetFileSchema,
    SellerPackageErrorCode.InvalidDatasetJson,
  )
  const preview = readJsonFile(
    requirePackageFile(packageDir, "preview.json"),
    previewFileSchema,
    SellerPackageErrorCode.InvalidPreviewJson,
  )
  const redactionReport = readJsonFile(
    requirePackageFile(packageDir, "redaction-report.json"),
    redactionReportFileSchema,
    SellerPackageErrorCode.InvalidRedactionReportJson,
  )

  assertManifestFileList(manifest, packageFilePaths)
  for (const filePath of packageFilePaths) {
    assertManifestHash(packageDir, manifest, filePath)
  }
  const tracePath = requirePackageFile(packageDir, "trace.atf.json")
  const traceInspect = inspectTraceFile(tracePath)
  assertMarketplaceReady(traceInspect.marketplaceReady, tracePath)
  const traceSha256 = sha256File(tracePath)
  assertPackageClaimsMatch({
    dataset,
    manifest,
    preview,
    redactionReport,
    traceInspect,
    traceSha256,
  })

  return {
    valid: true,
    listingReady: traceInspect.marketplaceReady,
    sellerId: seller.sellerId,
    datasetId: dataset.datasetId,
    eventCount: traceInspect.eventCount,
    metadata:
      manifest.marketplace ??
      fallbackMarketplaceMetadata({
        eventCount: dataset.eventCount,
        sellerId: seller.sellerId,
        title: dataset.title,
      }),
    filesVerified: [...packageFilePaths],
  }
}

export const inspectSellerPackage = (input: { readonly packageDir: string }) => {
  const parsed = inspectPackageInputSchema.parse(input)
  const packageDir = resolveReadableProjectPath({
    inputPath: parsed.packageDir,
    code: SellerPackageErrorCode.InvalidPackagePath,
    throwPathError: throwSellerPathError,
  })

  return inspectSellerPackageDirectory(packageDir)
}
