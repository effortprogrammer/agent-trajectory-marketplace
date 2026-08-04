import type { JobResponse } from '../spec'

export type NormalizedJobResponse = JobResponse & {
  job_set_type?: string
  cost?: number | null
}

type UnknownRecord = Record<string, unknown>

/** Normalize product/feed job payloads into the SDK's flat job read shape. */
export function normalizeProductJob(job: UnknownRecord, set?: UnknownRecord): NormalizedJobResponse {
  const status = normalizeStatus(stringValue(job.status) ?? 'pending', job.ip_check_finished === false)
  const urls = extractResultUrls(job)
  const meta = recordValue(job.meta)
  const params = recordValue(job.params) ?? recordValue(set?.params)

  return cleanUndefined({
    id: stringValue(job.id) ?? '',
    job_set_type: stringValue(job.job_set_type) ?? stringValue(set?.type) ?? stringValue(set?.job_set_type),
    job_set_id: stringValue(job.job_set_id) ?? stringValue(set?.id),
    job_set_parent_id: nullableStringValue(job.job_set_parent_id) ?? nullableStringValue(set?.parent_id),
    status,
    result_url: urls.rawUrl,
    min_result_url: urls.minUrl,
    thumbnail_url: urls.thumbnailUrl,
    params,
    created_at: numberValue(job.created_at) ?? numberValue(set?.created_at),
    fail_reason: nullableStringValue(job.fail_reason) ?? nullableStringValue(meta?.fail_reason),
    cost: numberOrNullValue(job.cost),
  })
}

export function normalizeJobListBody(body: unknown): unknown {
  const record = recordValue(body)
  if (!record)
    return body

  if (Array.isArray(record.jobs))
    return { ...record, jobs: record.jobs.map(item => normalizeJobLike(item)) }
  if (Array.isArray(record.items))
    return { ...record, items: record.items.map(item => normalizeJobLike(item)) }
  return record
}

export function normalizeJobSetBody(body: unknown): unknown {
  if (Array.isArray(body))
    return body.map(item => normalizeJobLike(item))

  const record = recordValue(body)
  if (!record)
    return body

  if (Array.isArray(record.jobs))
    return record.jobs.map(item => normalizeJobLike(item, record))
  if (Array.isArray(record.items))
    return record.items.map(item => normalizeJobLike(item, record))
  return []
}

export function normalizeJobLike(job: unknown, set?: unknown): NormalizedJobResponse {
  const record = recordValue(job)
  return normalizeProductJob(record ?? {}, recordValue(set) ?? undefined)
}

function normalizeStatus(status: string, isWaitingOnIpCheck: boolean): string {
  const normalized = status === 'waiting' ? 'queued' : status
  return normalized === 'completed' && isWaitingOnIpCheck ? 'ip_detect' : normalized
}

function extractResultUrls(job: UnknownRecord): {
  rawUrl: string | null
  minUrl: string | null
  thumbnailUrl: string | null
} {
  const results = recordValue(job.results)
  return {
    rawUrl: nestedResultUrl(results, 'raw') ?? nullableStringValue(job.result_url),
    minUrl: nestedResultUrl(results, 'min') ?? nullableStringValue(job.min_result_url),
    thumbnailUrl:
      nullableStringValue(job.thumbnail_url)
      ?? nestedResultUrl(results, 'thumbnail')
      ?? nullableStringValue(results?.thumbnail_url)
      ?? nullableStringValue(recordValue(results?.raw)?.thumbnail_url)
      ?? nullableStringValue(recordValue(results?.min)?.thumbnail_url),
  }
}

function nestedResultUrl(results: UnknownRecord | undefined, key: string): string | null {
  const value = results?.[key]
  if (typeof value === 'string')
    return value
  return nullableStringValue(recordValue(value)?.url)
}

function cleanUndefined<T extends UnknownRecord>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

function recordValue(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function nullableStringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : value === null ? null : null
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function numberOrNullValue(value: unknown): number | null | undefined {
  return typeof value === 'number' ? value : value === null ? null : undefined
}
