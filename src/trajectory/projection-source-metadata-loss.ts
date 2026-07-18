import type { TrajectoryProjectionManifest } from "./projection-contract"
import type { ProjectionEvent } from "./projection-source"

type EventMapping = TrajectoryProjectionManifest["events"][number]

const assertNeverParentLinkage = (value: never): never => {
  throw new TypeError(`unmapped_parent_linkage_status: ${value}`)
}

/**
 * Augments a regular event mapping with source-metadata manifest accounting.
 *
 * Records `sourceEventId` as unsupported identity loss, the source `timestamp` as
 * a transformed field, the resolved/unresolved/absent parent linkage as either a
 * transformed parent index, an unsupported parent reference plus a null default,
 * or a null default alone. Exhaustive linkage handling is preserved via
 * `assertNeverParentLinkage`.
 */
export const augmentRegularEventMappingWithSourceMetadata = (
  mapping: EventMapping,
  event: ProjectionEvent,
  sourceBase: string,
  targetBase: string,
): EventMapping => {
  if (event.sourceMetadata === undefined) return mapping
  const transformedFields: EventMapping["transformedFields"] = [
    ...mapping.transformedFields,
    {
      sourcePath: `${sourceBase}/timestamp`,
      targetPath: `${targetBase}/startTime`,
      operation: "copy_source_timestamp",
    },
  ]
  const unsupported: EventMapping["unsupported"] = [
    ...mapping.unsupported,
    {
      sourcePath: `${sourceBase}/sourceEventId`,
      reason: "source_link_identity_not_projected",
    },
  ]
  const defaultedFields: EventMapping["defaultedFields"] = [...mapping.defaultedFields]
  const parentLinkageStatus = event.parentLinkage.status
  switch (parentLinkageStatus) {
    case "resolved":
      transformedFields.push({
        sourcePath: `${sourceBase}/parentSourceEventId`,
        targetPath: `${targetBase}/parentSpanIndex`,
        operation: "resolve_source_parent_event_index",
      })
      break
    case "unresolved":
      unsupported.push({
        sourcePath: `${sourceBase}/parentSourceEventId`,
        reason: "source_parent_linkage_unresolved",
      })
      defaultedFields.push({
        targetPath: `${targetBase}/parentSpanIndex`,
        value: null,
        reason: "source_parent_index_unavailable",
      })
      break
    case "absent":
      defaultedFields.push({
        targetPath: `${targetBase}/parentSpanIndex`,
        value: null,
        reason: "source_parent_index_unavailable",
      })
      break
    default:
      return assertNeverParentLinkage(parentLinkageStatus)
  }
  return { ...mapping, transformedFields, unsupported, defaultedFields }
}
