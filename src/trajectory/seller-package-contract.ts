import { z } from "zod"

import { privacyStampSchema } from "./privacy/contract"

export const packageFilePaths = [
  "seller.json",
  "dataset.json",
  "trace.atf.json",
  "preview.json",
  "redaction-report.json",
  "privacy-report.json",
] as const

export const sellerPackageInputSchema = z
  .object({
    metadataPath: z.string().min(1).optional(),
    outDir: z.string().min(1),
    sellerId: z.string().min(1),
    title: z.string().min(1),
    tracePath: z.string().min(1),
  })
  .strict()

const marketplaceUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://") || value.startsWith("http://"))

export const marketplaceAccessPolicyValues = [
  "request_required",
  "free",
  "entitlement_required",
  "purchase_required",
] as const

export const marketplaceMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    price: z
      .object({
        mode: z.enum(["free", "request_access", "entitlement", "purchase"]),
        display: z.string().min(1).max(120),
      })
      .strict(),
    license: z
      .object({
        name: z.string().min(1).max(120),
        url: marketplaceUrlSchema.optional(),
      })
      .strict(),
    usageTerms: z
      .object({
        allowed: z.array(z.string().min(1).max(240)).min(1).max(20),
        prohibited: z.array(z.string().min(1).max(240)).min(1).max(20),
      })
      .strict(),
    sellerProfile: z
      .object({
        displayName: z.string().min(1).max(120),
        supportUrl: marketplaceUrlSchema.optional(),
      })
      .strict(),
    sample: z
      .object({
        summary: z.string().min(1).max(4096),
        maxPreviewEvents: z.number().int().nonnegative().max(100),
      })
      .strict(),
    accessPolicy: z.enum(marketplaceAccessPolicyValues),
  })
  .strict()

export type MarketplaceMetadata = z.infer<typeof marketplaceMetadataSchema>

export const fallbackMarketplaceMetadata = (input: {
  readonly eventCount: number
  readonly sellerId: string
  readonly title: string
}): MarketplaceMetadata =>
  marketplaceMetadataSchema.parse({
    schemaVersion: 1,
    price: { mode: "free", display: "Free" },
    license: { name: "Closed Alpha Evaluation" },
    usageTerms: {
      allowed: ["evaluation"],
      prohibited: ["resale"],
    },
    sellerProfile: { displayName: input.sellerId },
    sample: {
      summary: input.title,
      maxPreviewEvents: Math.min(input.eventCount, 10),
    },
    accessPolicy: "free",
  })

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

export const privacyReportFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("privacy-report"),
    privacyFiltered: z.boolean(),
    // Present when the trace carries a stamp (always, for collected traces).
    stamp: privacyStampSchema.optional(),
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
        privacyFiltered: z.boolean(),
        redactionClean: z.boolean(),
      })
      .strict(),
    marketplace: marketplaceMetadataSchema.optional(),
  })
  .strict()

export type ManifestFile = z.infer<typeof manifestFileSchema>

export const SellerPackageErrorCode = {
  InvalidDatasetJson: "invalid_dataset_json",
  InvalidManifestJson: "invalid_manifest_json",
  InvalidMarketplaceMetadata: "invalid_marketplace_metadata",
  InvalidOutputPath: "invalid_output_path",
  InvalidPackageContents: "invalid_package_contents",
  InvalidPackageFile: "invalid_package_file",
  InvalidPackagePath: "invalid_package_path",
  InvalidPreviewJson: "invalid_preview_json",
  InvalidPrivacyReportJson: "invalid_privacy_report_json",
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
