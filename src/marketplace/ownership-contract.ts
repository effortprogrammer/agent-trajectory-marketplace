import { z } from "zod"

import { authAccountIdSchema } from "../auth/contract"
import { datasetArchivePolicy, datasetManifestSchema, datasetTracePathSchema } from "./archive-contract"
import type { AuthAccountId } from "../auth/contract"
import type { DatasetManifest } from "./archive-contract"

export const bundleIdSchema = z.string().regex(/^bundle-[0-9a-f]{64}$/).brand<"BundleId">()
export const archiveSha256Schema = z.string().regex(/^[0-9a-f]{64}$/).brand<"ArchiveSha256">()
export const submissionArtifactPathSchema = datasetTracePathSchema.brand<"SubmissionArtifactPath">()

export const authenticatedArtifactClaimSchema = z
  .object({
    artifactPath: submissionArtifactPathSchema,
    traceSha256: archiveSha256Schema,
    byteCount: z.number().int().positive().max(datasetArchivePolicy.maxTraceBytes),
    submittedByAccountId: authAccountIdSchema,
  })
  .strict()

export const authenticatedBundleSubmissionSchema = z
  .object({
    bundleId: bundleIdSchema,
    archiveSha256: archiveSha256Schema,
    submittedByAccountId: authAccountIdSchema,
    claimStatus: z.literal("self_attested"),
    manifest: datasetManifestSchema,
    artifacts: z.array(authenticatedArtifactClaimSchema).min(1).max(datasetArchivePolicy.maxTraces),
  })
  .strict()
  .superRefine((submission, context) => {
    const manifestByPath = new Map(submission.manifest.artifacts.map((artifact) => [artifact.path, artifact]))
    const claimedPaths = new Set<string>()
    const claimedHashes = new Set<string>()

    for (const artifact of submission.artifacts) {
      if (artifact.submittedByAccountId !== submission.submittedByAccountId) {
        context.addIssue({ code: "custom", message: "artifact claimant must match submitted account" })
      }
      if (claimedPaths.has(artifact.artifactPath)) {
        context.addIssue({ code: "custom", message: "artifact paths must be unique" })
      }
      if (claimedHashes.has(artifact.traceSha256)) {
        context.addIssue({ code: "custom", message: "artifact hashes must be unique" })
      }
      claimedPaths.add(artifact.artifactPath)
      claimedHashes.add(artifact.traceSha256)

      const manifestArtifact = manifestByPath.get(artifact.artifactPath)
      if (
        manifestArtifact === undefined ||
        manifestArtifact.sha256 !== artifact.traceSha256 ||
        manifestArtifact.byteCount !== artifact.byteCount
      ) {
        context.addIssue({ code: "custom", message: "artifact claim must match the identity-neutral manifest" })
      }
    }

    if (claimedPaths.size !== submission.manifest.artifacts.length) {
      context.addIssue({ code: "custom", message: "every manifest artifact must have one claim" })
    }
  })

export type BundleId = z.infer<typeof bundleIdSchema>
export type ArchiveSha256 = z.infer<typeof archiveSha256Schema>
export type SubmissionArtifactPath = z.infer<typeof submissionArtifactPathSchema>
export type AuthenticatedArtifactClaim = Readonly<{
  artifactPath: SubmissionArtifactPath
  traceSha256: ArchiveSha256
  byteCount: number
  submittedByAccountId: AuthAccountId
}>
export type AuthenticatedBundleSubmission = Readonly<{
  bundleId: BundleId
  archiveSha256: ArchiveSha256
  submittedByAccountId: AuthAccountId
  claimStatus: "self_attested"
  manifest: DatasetManifest
  artifacts: readonly AuthenticatedArtifactClaim[]
}>
