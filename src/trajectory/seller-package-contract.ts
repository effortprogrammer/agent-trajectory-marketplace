import { z } from "zod"

export const packageFilePaths = [
  "seller.json",
  "dataset.json",
  "trace.atf.json",
  "preview.json",
  "redaction-report.json",
] as const

export const sellerPackageInputSchema = z
  .object({
    outDir: z.string().min(1),
    sellerId: z.string().min(1),
    title: z.string().min(1),
    tracePath: z.string().min(1),
  })
  .strict()

export const inspectPackageInputSchema = z
  .object({
    packageDir: z.string().min(1),
  })
  .strict()

export const sellerFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("trajectory-seller"),
    sellerId: z.string().min(1),
    rights: z.literal("self_generated_agent_log"),
    createdAt: z.string().min(1),
  })
  .strict()

export const datasetFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("agent-log-dataset"),
    datasetId: z.string().min(1),
    title: z.string().min(1),
    runtime: z.string().min(1),
    status: z.string().min(1),
    eventCount: z.number().int().nonnegative(),
    eventKinds: z.array(z.string().min(1)),
    traceSha256: z.string().min(1),
    purpose: z.literal("sellable_self_log_dataset"),
  })
  .strict()

export const previewFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("agent-log-preview"),
    runtime: z.string().min(1),
    status: z.string().min(1),
    eventCount: z.number().int().nonnegative(),
    eventKinds: z.array(z.string().min(1)),
  })
  .strict()

export const redactionReportFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("redaction-report"),
    redactionClean: z.boolean(),
    redactedFindings: z.array(
      z.object({ kind: z.string().min(1), name: z.string().min(1) }).strict(),
    ),
  })
  .strict()

export const manifestFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("trajectory-seller-package"),
    packageId: z.string().min(1),
    createdAt: z.string().min(1),
    files: z.array(z.object({ path: z.string().min(1), sha256: z.string().min(1) }).strict()),
    checks: z
      .object({
        listingReady: z.boolean(),
        marketplaceReady: z.boolean(),
        redactionClean: z.boolean(),
      })
      .strict(),
  })
  .strict()

export type ManifestFile = z.infer<typeof manifestFileSchema>

export const SellerPackageErrorCode = {
  InvalidDatasetJson: "invalid_dataset_json",
  InvalidManifestJson: "invalid_manifest_json",
  InvalidOutputPath: "invalid_output_path",
  InvalidPackageContents: "invalid_package_contents",
  InvalidPackageFile: "invalid_package_file",
  InvalidPackagePath: "invalid_package_path",
  InvalidPreviewJson: "invalid_preview_json",
  InvalidRedactionReportJson: "invalid_redaction_report_json",
  InvalidSellerJson: "invalid_seller_json",
  MissingPackageFile: "missing_package_file",
  PackageHashMismatch: "package_hash_mismatch",
  TraceNotMarketplaceReady: "trace_not_marketplace_ready",
} as const

export type SellerPackageErrorCode =
  (typeof SellerPackageErrorCode)[keyof typeof SellerPackageErrorCode]

export class SellerPackageError extends Error {
  readonly code: SellerPackageErrorCode

  constructor(code: SellerPackageErrorCode, message: string) {
    super(message)
    this.name = "SellerPackageError"
    this.code = code
  }
}
