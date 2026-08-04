import type { JobEntry } from './define-job'

export type Registry = Map<string, JobEntry>

export function buildRegistry(jobs: readonly JobEntry[]): Registry {
  const registry: Registry = new Map()
  for (const job of jobs) {
    // Last-write-wins here would silently serialize through the wrong codecs
    // while the type level still advertises both entries — fail loudly instead.
    if (registry.has(job.jobSetType))
      throw new Error(`buildRegistry: duplicate jobSetType '${job.jobSetType}' — register one entry per backend job type`)
    registry.set(job.jobSetType, job)
  }
  return registry
}
