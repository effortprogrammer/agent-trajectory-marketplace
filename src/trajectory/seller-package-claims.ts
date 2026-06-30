import type { InspectTraceResult } from "./evidence"
import type { ManifestFile } from "./seller-package-contract"
import { SellerPackageError, SellerPackageErrorCode } from "./seller-package-contract"

type DatasetFile = Readonly<{
  eventCount: number
  eventKinds: readonly string[]
  datasetId: string
  runtime: string
  status: string
  traceSha256: string
}>

type PreviewFile = Readonly<{
  eventCount: number
  eventKinds: readonly string[]
  runtime: string
  status: string
}>

type RedactedFinding = Readonly<{
  kind: string
  name: string
}>

type RedactionReportFile = Readonly<{
  redactionClean: boolean
  redactedFindings: readonly RedactedFinding[]
}>

type PackageClaimsInput = Readonly<{
  dataset: DatasetFile
  manifest: ManifestFile
  preview: PreviewFile
  redactionReport: RedactionReportFile
  traceInspect: InspectTraceResult
  traceSha256: string
}>

const sameStringList = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index])

const sameRedactedFindings = (
  left: readonly RedactedFinding[],
  right: readonly RedactedFinding[],
) =>
  left.length === right.length &&
  left.every((finding, index) => {
    const rightFinding = right[index]
    return rightFinding?.kind === finding.kind && rightFinding.name === finding.name
  })

const datasetIdForTrace = (traceSha256: string) => `agent-log-${traceSha256.slice(0, 16)}`

const packageIdForTrace = (traceSha256: string) => `seller-package-${traceSha256.slice(0, 16)}`

const assertDatasetMatchesTrace = (
  dataset: DatasetFile,
  traceInspect: InspectTraceResult,
  traceSha256: string,
) => {
  if (
    dataset.datasetId !== datasetIdForTrace(traceSha256) ||
    dataset.runtime !== traceInspect.runtime ||
    dataset.status !== traceInspect.status ||
    dataset.eventCount !== traceInspect.eventCount ||
    dataset.traceSha256 !== traceSha256 ||
    !sameStringList(dataset.eventKinds, traceInspect.eventKinds)
  ) {
    throw new SellerPackageError(
      SellerPackageErrorCode.InvalidDatasetJson,
      "invalid_dataset_json: trace metadata mismatch",
    )
  }
}

const assertPreviewMatchesTrace = (preview: PreviewFile, traceInspect: InspectTraceResult) => {
  if (
    preview.runtime !== traceInspect.runtime ||
    preview.status !== traceInspect.status ||
    preview.eventCount !== traceInspect.eventCount ||
    !sameStringList(preview.eventKinds, traceInspect.eventKinds)
  ) {
    throw new SellerPackageError(
      SellerPackageErrorCode.InvalidPreviewJson,
      "invalid_preview_json: trace metadata mismatch",
    )
  }
}

const assertRedactionReportMatchesTrace = (
  redactionReport: RedactionReportFile,
  traceInspect: InspectTraceResult,
) => {
  if (
    redactionReport.redactionClean !== traceInspect.checks.redactionClean ||
    !sameRedactedFindings(redactionReport.redactedFindings, traceInspect.redactedFindings)
  ) {
    throw new SellerPackageError(
      SellerPackageErrorCode.InvalidRedactionReportJson,
      "invalid_redaction_report_json: trace metadata mismatch",
    )
  }
}

const assertManifestMatchesTrace = (
  manifest: ManifestFile,
  traceInspect: InspectTraceResult,
  traceSha256: string,
) => {
  if (
    manifest.packageId !== packageIdForTrace(traceSha256) ||
    manifest.checks.listingReady !== traceInspect.marketplaceReady ||
    manifest.checks.marketplaceReady !== traceInspect.marketplaceReady ||
    manifest.checks.redactionClean !== traceInspect.checks.redactionClean
  ) {
    throw new SellerPackageError(
      SellerPackageErrorCode.InvalidManifestJson,
      "invalid_manifest_json: trace metadata mismatch",
    )
  }
}

export const assertPackageClaimsMatch = ({
  dataset,
  manifest,
  preview,
  redactionReport,
  traceInspect,
  traceSha256,
}: PackageClaimsInput) => {
  assertDatasetMatchesTrace(dataset, traceInspect, traceSha256)
  assertPreviewMatchesTrace(preview, traceInspect)
  assertRedactionReportMatchesTrace(redactionReport, traceInspect)
  assertManifestMatchesTrace(manifest, traceInspect, traceSha256)
}
