import { createHash } from "node:crypto"

import {
  type TrajectoryProjectionManifest,
  type TrajectoryProjectionProfileName,
  trajectoryProjectionManifestSchema,
  trajectoryProjectionProfiles,
} from "./projection-contract"
import { buildProjectionEventMapping } from "./projection-event-loss"
import type { ProjectionSource } from "./projection-source"

type ManifestInput = Readonly<{
  profile: TrajectoryProjectionProfileName
  source: ProjectionSource
  sourceBytes: Uint8Array
}>

export const buildProjectionManifest = ({
  profile,
  source,
  sourceBytes,
}: ManifestInput): TrajectoryProjectionManifest => {
  const selectedProfile =
    profile === "otel-genai"
      ? trajectoryProjectionProfiles.otelGenAi
      : trajectoryProjectionProfiles.openInference
  const legacyVersionOmitted = source.version === 1 && source.document.formatVersion === undefined
  return trajectoryProjectionManifestSchema.parse({
    schemaVersion: 1,
    kind: "trajectory-projection-mapping-loss-manifest",
    manifestVersion: "trajectory-projection-manifest-v1",
    source: {
      sha256: createHash("sha256").update(sourceBytes).digest("hex"),
      atfFormatVersion: source.version,
      eventCount: source.events.length,
    },
    projection: {
      profile,
      specificationVersion: selectedProfile.specificationVersion,
      schemaVersion: 1,
      recordCount: source.events.length,
    },
    reconstruction: "not_supported",
    identity: {
      sourceHashPreserved: true,
      generatedTraceIds: false,
      generatedSpanIds: false,
    },
    document: {
      transformedFields: [
        { sourcePath: "/eventCount", targetPath: "/source/eventCount", operation: "copy_integer" },
        ...(legacyVersionOmitted
          ? []
          : [
              {
                sourcePath: "/formatVersion",
                targetPath: "/source/atfFormatVersion",
                operation: "copy_integer",
              },
            ]),
      ],
      defaultedFields: [
        ...(legacyVersionOmitted
          ? [
              {
                targetPath: "/source/atfFormatVersion",
                value: 1,
                reason: "legacy_v1_format_version_omitted",
              },
            ]
          : []),
        ...(profile === "otel-genai"
          ? [
              {
                targetPath: "/resource/attributes/service.name",
                value: "agent-trajectory-marketplace.local-projection",
                reason: "local_projection_resource_default",
              },
            ]
          : []),
      ],
      droppedFields: [
        { sourcePath: "/runtime", reason: "content_omitted_by_projection_policy" },
        { sourcePath: "/status", reason: "content_omitted_by_projection_policy" },
        ...(source.document.privacy === undefined
          ? []
          : [
              {
                sourcePath: "/privacy",
                reason: "privacy_metadata_retained_only_as_loss_signal",
              },
            ]),
      ],
      truncation: [],
      redaction:
        source.document.privacy === undefined
          ? []
          : [{ sourcePath: "/privacy", reason: "privacy_filter_stamp_present" }],
      unsupported: [],
    },
    events: source.events.map((event) => buildProjectionEventMapping(event, profile)),
  })
}
