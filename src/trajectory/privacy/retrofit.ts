import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import {
  type HarnessTraceDocument,
  harnessTraceDocumentSchema,
  TrajectoryAdapterError,
} from "../adapters/contract"
import { resolveReadableProjectPath, resolveWritableProjectPath } from "../path-safety"
import { applyPrivacyPass } from "./apply"
import { type CollectPrivacyOptions, resolveCollectPrivacy } from "./pipeline"

// Retrofit path for traces exported before the privacy pass existed (or with
// --no-privacy-filter): runs the pass over an existing ATF file and writes a
// stamped copy, so old inventory whose harness session logs are gone can
// still become marketplace-ready.

const throwRetrofitPathError = (
  code: "invalid_export_path" | "invalid_session",
  path: string,
): never => {
  throw new TrajectoryAdapterError(code, `${code}: ${path}`)
}

export type RetrofitFilterResult = Readonly<{
  tracePath: string
  exportPath: string
  eventCount: number
  maskedSpanCount: number
  configHash: string
}>

export const filterExistingTrace = async (
  input: { readonly tracePath: string; readonly exportPath: string },
  privacyOptions?: CollectPrivacyOptions,
): Promise<RetrofitFilterResult> => {
  const tracePath = resolveReadableProjectPath({
    inputPath: input.tracePath,
    code: "invalid_session",
    throwPathError: throwRetrofitPathError,
  })
  let trace: HarnessTraceDocument
  try {
    trace = harnessTraceDocumentSchema.parse(JSON.parse(readFileSync(tracePath, "utf8")))
  } catch {
    throw new TrajectoryAdapterError(
      "invalid_session",
      `invalid_session: ${tracePath} is not a valid ATF trace document`,
    )
  }

  const privacy = resolveCollectPrivacy(privacyOptions)
  if (!privacy.enabled) {
    throw new TrajectoryAdapterError(
      "invalid_session",
      "invalid_session: the retrofit filter cannot run with the privacy filter disabled",
    )
  }
  const passed = await applyPrivacyPass(trace, privacy.filter, privacy.config)

  const exportPath = resolveWritableProjectPath({
    inputPath: input.exportPath,
    code: "invalid_export_path",
    throwPathError: throwRetrofitPathError,
  })
  mkdirSync(dirname(exportPath), { recursive: true })
  writeFileSync(exportPath, `${JSON.stringify(passed.trace, null, 2)}\n`, "utf8")
  return {
    tracePath,
    exportPath,
    eventCount: passed.trace.eventCount,
    maskedSpanCount: passed.maskedSpanCount,
    configHash: privacy.configHash,
  }
}
