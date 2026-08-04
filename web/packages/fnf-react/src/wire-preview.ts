import type { GenerationInput, JobEntry } from '@higgsfield/fnf'
import { ApiJobError, buildRegistry, buildWireParams } from '@higgsfield/fnf'
import { useMemo } from 'react'
import { useFnfJobs } from './provider'

export type WirePreviewResult =
  | {
    ok: true
    jobSetType: string
    outputType: JobEntry['outputType']
    params: Record<string, unknown>
  }
  | {
    ok: false
    error: { code: string, message: string, status?: number, data?: unknown }
  }

export function getWirePreview(input: GenerationInput, jobs: readonly JobEntry[]): WirePreviewResult {
  try {
    const entry = buildRegistry(jobs).get(input.model)
    if (!entry)
      throw new ApiJobError('unknown_model', `Unknown model: ${input.model}`)
    return {
      ok: true,
      jobSetType: entry.jobSetType,
      outputType: entry.outputType,
      params: buildWireParams(input, entry),
    }
  }
  catch (err) {
    if (err instanceof ApiJobError)
      return { ok: false, error: err.toJSON() }
    return { ok: false, error: { code: 'unexpected', message: err instanceof Error ? err.message : String(err) } }
  }
}

export function useFnfWirePreview(input: GenerationInput): WirePreviewResult {
  const jobs = useFnfJobs()
  return useMemo(() => getWirePreview(input, jobs), [input, jobs])
}
