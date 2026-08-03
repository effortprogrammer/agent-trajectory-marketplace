import type {
  CreateRealtimeCustomStyleInput,
  CreateRealtimeCustomStyleWireRequest,
  RealtimeAspectRatio,
  RealtimeChainCostEstimate,
  RealtimeChainCostInput,
  RealtimeChainCostWireRequest,
  RealtimeChainEditInput,
  RealtimeChainEditResult,
  RealtimeChainEditWireRequest,
  RealtimeChainFinalizeInput,
  RealtimeChainFinalizeResult,
  RealtimeChainFinalizeWireRequest,
  RealtimeCustomStyle,
  RealtimeCustomStyleListQuery,
  RealtimeCustomStyleListResult,
  RealtimeCustomStyleReference,
  RealtimeCustomStyleReferenceWire,
  RealtimeMode,
  RealtimeSettings,
  RealtimeSettingsWire,
  UpdateRealtimeCustomStyleInput,
  UpdateRealtimeCustomStyleWireRequest,
} from './types'
import { ValidationError } from '../errors'

const MODES = new Set<RealtimeMode>(['basic', 'advanced'])
const RESOLUTIONS = new Set(['1k', '2k'])
const ASPECT_RATIOS = new Set<RealtimeAspectRatio>([
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16',
  '2:3',
  '1:2',
  '2:1',
  '4:5',
  '3:2',
  '5:4',
  '21:9',
])
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const CANONICAL_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
const IMAGE_JOB_TYPE = /^[a-z0-9_]+_job$/

interface Issue {
  loc: string[]
  msg: string
}

export function buildRealtimeChainEditRequest(input: RealtimeChainEditInput): RealtimeChainEditWireRequest {
  const issues: Issue[] = []
  const params = input?.params
  if (!isRecord(params))
    throw new ValidationError('Invalid realtime edit input', [{ loc: ['params'], msg: 'params are required' }])

  const mode = validateMode(params.mode, ['params', 'mode'], issues)
  validateResolution(params.resolution, ['params', 'resolution'], issues)
  validateAspectRatio(params.aspectRatio, ['params', 'aspectRatio'], issues)

  const hasPrompt = typeof params.prompt === 'string'
  const hasSettings = isRecord(params.settings)
  if (hasPrompt === hasSettings)
    issues.push({ loc: ['params'], msg: 'exactly one of prompt or settings is required' })
  if (hasPrompt && (params.prompt.length < 1 || params.prompt.length > 10_000))
    issues.push({ loc: ['params', 'prompt'], msg: 'prompt must contain between 1 and 10000 characters' })

  let settings: RealtimeSettingsWire | undefined
  if (hasSettings)
    settings = buildSettings(params.settings as unknown as RealtimeSettings, issues)

  if (!Array.isArray(params.images) || params.images.length < 1 || params.images.length > 4) {
    issues.push({ loc: ['params', 'images'], msg: 'images must contain between 1 and 4 items' })
  }
  else {
    params.images.forEach((image, index) => {
      if (!isRecord(image) || !isCanonicalUuid(image.id))
        issues.push({ loc: ['params', 'images', String(index), 'id'], msg: 'image id must be a canonical UUID' })
      if (!isRecord(image) || !isRealtimeImageType(image.type))
        issues.push({ loc: ['params', 'images', String(index), 'type'], msg: 'image type must be media_input or an *_job type' })
    })
  }

  if (input.chainId !== undefined && input.chainId !== null && !isCanonicalUuid(input.chainId))
    issues.push({ loc: ['chainId'], msg: 'chainId must be a canonical UUID' })

  if (issues.length > 0)
    throw new ValidationError('Invalid realtime edit input', issues)

  const wireParams = {
    ...(hasPrompt ? { prompt: params.prompt as string } : {}),
    ...(settings ? { settings } : {}),
    mode,
    resolution: params.resolution,
    aspect_ratio: params.aspectRatio,
    medias: params.images.map(image => ({
      role: 'image' as const,
      data: { id: image.id, type: image.type },
    })),
  }

  return {
    ...(input.chainId !== undefined ? { chain_id: input.chainId } : {}),
    params: wireParams,
  }
}

export function buildRealtimeChainCostRequest(input: RealtimeChainCostInput): RealtimeChainCostWireRequest {
  const issues: Issue[] = []
  const mode = validateMode(input?.mode, ['mode'], issues)
  validateResolution(input?.resolution, ['resolution'], issues)
  validateAspectRatio(input?.aspectRatio, ['aspectRatio'], issues)
  if (issues.length > 0)
    throw new ValidationError('Invalid realtime cost input', issues)
  return {
    mode,
    resolution: input.resolution,
    aspect_ratio: input.aspectRatio,
  }
}

export function buildRealtimeChainFinalizeRequest(input: RealtimeChainFinalizeInput): RealtimeChainFinalizeWireRequest {
  if (!input || !isCanonicalUuid(input.chainId))
    throw new ValidationError('Invalid realtime finalize input', [{ loc: ['chainId'], msg: 'chainId must be a canonical UUID' }])
  return { chain_id: input.chainId }
}

export function buildCreateRealtimeCustomStyleRequest(input: CreateRealtimeCustomStyleInput): CreateRealtimeCustomStyleWireRequest {
  const issues: Issue[] = []
  validateOptionalPrompt(input?.prompt, ['prompt'], issues, false)
  if (input?.reference !== undefined && input.reference !== null)
    validateStyleReference(input.reference, ['reference'], issues)
  if (issues.length > 0)
    throw new ValidationError('Invalid realtime custom style input', issues)
  return {
    prompt: input?.prompt ?? '',
    ...(input?.reference !== undefined ? { reference: toStyleReferenceWire(input.reference) } : {}),
  }
}

export function buildUpdateRealtimeCustomStyleRequest(input: UpdateRealtimeCustomStyleInput): UpdateRealtimeCustomStyleWireRequest {
  const issues: Issue[] = []
  validateOptionalPrompt(input?.prompt, ['prompt'], issues, true)
  if (input?.reference !== undefined && input.reference !== null)
    validateStyleReference(input.reference, ['reference'], issues)
  if (input?.clearReference !== undefined && typeof input.clearReference !== 'boolean')
    issues.push({ loc: ['clearReference'], msg: 'clearReference must be a boolean' })
  if (input?.clearReference === true && input.reference !== undefined && input.reference !== null)
    issues.push({ loc: ['reference'], msg: 'reference cannot be set when clearReference is true' })
  if (issues.length > 0)
    throw new ValidationError('Invalid realtime custom style input', issues)
  return {
    ...(input?.prompt !== undefined ? { prompt: input.prompt } : {}),
    ...(input?.reference !== undefined ? { reference: toStyleReferenceWire(input.reference) } : {}),
    ...(input?.clearReference !== undefined ? { clear_reference: input.clearReference } : {}),
  }
}

export function validateRealtimeCustomStyleListQuery(query: RealtimeCustomStyleListQuery): void {
  const issues: Issue[] = []
  if (query.cursor !== undefined && (!Number.isFinite(query.cursor) || query.cursor <= 0))
    issues.push({ loc: ['cursor'], msg: 'cursor must be a positive finite number' })
  if (query.size !== undefined && (!Number.isInteger(query.size) || query.size < 1 || query.size > 100))
    issues.push({ loc: ['size'], msg: 'size must be an integer between 1 and 100' })
  if (issues.length > 0)
    throw new ValidationError('Invalid realtime custom style query', issues)
}

export function parseRealtimeChainEditResult(body: unknown): RealtimeChainEditResult {
  const value = unwrapData(body)
  if (!isRecord(value))
    throw invalidResponse('edit')
  return {
    chainId: requiredUuid(value.chain_id, 'chain_id'),
    jobSetId: requiredUuid(value.job_set_id, 'job_set_id'),
    jobId: requiredUuid(value.job_id, 'job_id'),
    status: requiredString(value.status, 'status'),
    createdAt: requiredNumber(value.created_at, 'created_at'),
  }
}

export function parseRealtimeChainCostEstimate(body: unknown): RealtimeChainCostEstimate {
  const value = unwrapData(body)
  if (!isRecord(value))
    throw invalidResponse('cost')
  return {
    credits: requiredNumber(value.credits, 'credits'),
    creditsExact: requiredNumber(value.credits_exact, 'credits_exact'),
  }
}

export function parseRealtimeChainFinalizeResult(body: unknown): RealtimeChainFinalizeResult {
  const value = unwrapData(body)
  if (!isRecord(value))
    throw invalidResponse('finalize')
  const status = value.status
  if (status !== 'finalized' && status !== 'released')
    throw invalidResponse('finalize', 'status')
  return {
    chainId: requiredUuid(value.chain_id, 'chain_id'),
    status,
  }
}

export function parseRealtimeCustomStyle(body: unknown): RealtimeCustomStyle {
  const value = unwrapData(body)
  if (!isRecord(value))
    throw invalidResponse('custom style')
  if (typeof value.prompt !== 'string')
    throw invalidResponse('custom style', 'prompt')
  return {
    id: requiredUuid(value.id, 'id'),
    prompt: value.prompt,
    reference: value.reference === null || value.reference === undefined
      ? null
      : parseStyleReference(value.reference),
  }
}

export function parseRealtimeCustomStyleList(body: unknown): RealtimeCustomStyleListResult {
  const value = unwrapData(body)
  if (!isRecord(value) || !Array.isArray(value.items))
    throw invalidResponse('custom style list')
  const nextCursor = value.next_cursor
  if (nextCursor !== undefined && nextCursor !== null && (typeof nextCursor !== 'number' || !Number.isFinite(nextCursor)))
    throw invalidResponse('custom style list', 'next_cursor')
  return {
    items: value.items.map(parseRealtimeCustomStyle),
    ...(typeof nextCursor === 'number' ? { nextCursor } : {}),
  }
}

function buildSettings(settings: RealtimeSettings, issues: Issue[]): RealtimeSettingsWire {
  if (typeof settings.style !== 'string' || settings.style.length < 1 || settings.style.length > 200)
    issues.push({ loc: ['params', 'settings', 'style'], msg: 'style must contain between 1 and 200 characters' })
  if (settings.customStyle !== undefined && (typeof settings.customStyle !== 'string' || settings.customStyle.length > 500))
    issues.push({ loc: ['params', 'settings', 'customStyle'], msg: 'customStyle must be at most 500 characters' })
  if (settings.mood !== undefined && (typeof settings.mood !== 'string' || settings.mood.length < 1 || settings.mood.length > 200))
    issues.push({ loc: ['params', 'settings', 'mood'], msg: 'mood must contain between 1 and 200 characters' })
  if (settings.palette !== undefined && (typeof settings.palette !== 'string' || settings.palette.length < 1 || settings.palette.length > 200))
    issues.push({ loc: ['params', 'settings', 'palette'], msg: 'palette must contain between 1 and 200 characters' })
  if (settings.customColors !== undefined) {
    if (!Array.isArray(settings.customColors) || settings.customColors.length > 8) {
      issues.push({ loc: ['params', 'settings', 'customColors'], msg: 'customColors must contain at most 8 items' })
    }
    else {
      settings.customColors.forEach((color, index) => {
        if (typeof color !== 'string' || !HEX_COLOR.test(color))
          issues.push({ loc: ['params', 'settings', 'customColors', String(index)], msg: 'color must use #RRGGBB format' })
      })
    }
  }
  if (settings.sketchInfluence !== undefined && (!Number.isInteger(settings.sketchInfluence) || settings.sketchInfluence < 0 || settings.sketchInfluence > 100))
    issues.push({ loc: ['params', 'settings', 'sketchInfluence'], msg: 'sketchInfluence must be an integer between 0 and 100' })
  if (settings.referenceMode !== undefined && settings.referenceMode !== 'style' && settings.referenceMode !== 'character')
    issues.push({ loc: ['params', 'settings', 'referenceMode'], msg: 'referenceMode must be style or character' })
  if (settings.target !== undefined && settings.target !== 'canvas' && settings.target !== 'selection')
    issues.push({ loc: ['params', 'settings', 'target'], msg: 'target must be canvas or selection' })
  if (settings.customStyleId !== undefined && settings.customStyleId !== null && !isCanonicalUuid(settings.customStyleId))
    issues.push({ loc: ['params', 'settings', 'customStyleId'], msg: 'customStyleId must be a canonical UUID' })

  return {
    style: settings.style,
    ...(settings.customStyle !== undefined ? { custom_style: settings.customStyle } : {}),
    ...(settings.mood !== undefined ? { mood: settings.mood } : {}),
    ...(settings.palette !== undefined ? { palette: settings.palette } : {}),
    ...(settings.customColors !== undefined ? { custom_colors: settings.customColors } : {}),
    ...(settings.sketchInfluence !== undefined ? { sketch_influence: settings.sketchInfluence } : {}),
    ...(settings.referenceMode !== undefined ? { reference_mode: settings.referenceMode } : {}),
    ...(settings.target !== undefined ? { target: settings.target } : {}),
    ...(settings.customStyleId !== undefined ? { custom_style_id: settings.customStyleId } : {}),
  }
}

function validateMode(value: unknown, loc: string[], issues: Issue[]): RealtimeMode {
  const mode = value ?? 'advanced'
  if (!MODES.has(mode as RealtimeMode))
    issues.push({ loc, msg: 'mode must be basic or advanced' })
  return mode as RealtimeMode
}

function validateResolution(value: unknown, loc: string[], issues: Issue[]): void {
  if (!RESOLUTIONS.has(value as string))
    issues.push({ loc, msg: 'resolution must be 1k or 2k' })
}

function validateAspectRatio(value: unknown, loc: string[], issues: Issue[]): void {
  if (!ASPECT_RATIOS.has(value as RealtimeAspectRatio))
    issues.push({ loc, msg: 'unsupported aspect ratio' })
}

function validateOptionalPrompt(value: unknown, loc: string[], issues: Issue[], nullable: boolean): void {
  if (value === undefined || (nullable && value === null))
    return
  if (typeof value !== 'string' || value.length > 500)
    issues.push({ loc, msg: 'prompt must be at most 500 characters' })
}

function validateStyleReference(reference: RealtimeCustomStyleReference, loc: string[], issues: Issue[]): void {
  if (!isRecord(reference) || !isCanonicalUuid(reference.mediaId))
    issues.push({ loc: [...loc, 'mediaId'], msg: 'mediaId must be a canonical UUID' })
  for (const key of ['url', 'sourceName', 'contentType'] as const) {
    const value = reference[key]
    if (value !== undefined && value !== null && typeof value !== 'string')
      issues.push({ loc: [...loc, key], msg: `${key} must be a string or null` })
  }
  if (typeof reference.url === 'string' && !isHttpUrl(reference.url))
    issues.push({ loc: [...loc, 'url'], msg: 'url must use http or https' })
  if (typeof reference.sourceName === 'string' && reference.sourceName.length > 500)
    issues.push({ loc: [...loc, 'sourceName'], msg: 'sourceName must be at most 500 characters' })
  if (typeof reference.contentType === 'string' && reference.contentType.length > 255)
    issues.push({ loc: [...loc, 'contentType'], msg: 'contentType must be at most 255 characters' })
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  }
  catch {
    return false
  }
}

function toStyleReferenceWire(reference: RealtimeCustomStyleReference | null): RealtimeCustomStyleReferenceWire | null {
  if (reference === null)
    return null
  return {
    media_id: reference.mediaId,
    ...(reference.url !== undefined ? { url: reference.url } : {}),
    ...(reference.sourceName !== undefined ? { source_name: reference.sourceName } : {}),
    ...(reference.contentType !== undefined ? { content_type: reference.contentType } : {}),
  }
}

function parseStyleReference(body: unknown): RealtimeCustomStyleReference {
  if (!isRecord(body))
    throw invalidResponse('custom style reference')
  return {
    mediaId: requiredUuid(body.media_id, 'media_id'),
    ...(optionalNullableString(body.url, 'url')),
    ...(optionalNullableString(body.source_name, 'source_name', 'sourceName')),
    ...(optionalNullableString(body.content_type, 'content_type', 'contentType')),
  }
}

function optionalNullableString(value: unknown, wireKey: string, publicKey = wireKey): Record<string, string | null> {
  if (value === undefined)
    return {}
  if (value !== null && typeof value !== 'string')
    throw invalidResponse('custom style reference', wireKey)
  return { [publicKey]: value }
}

function requiredString(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.length < 1)
    throw invalidResponse('realtime', key)
  return value
}

function requiredUuid(value: unknown, key: string): string {
  if (!isCanonicalUuid(value))
    throw invalidResponse('realtime', key)
  return value
}

function requiredNumber(value: unknown, key: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw invalidResponse('realtime', key)
  return value
}

function invalidResponse(kind: string, field?: string): ValidationError {
  return new ValidationError(`Invalid realtime ${kind} response`, field ? [{ loc: [field], msg: `${field} is invalid` }] : undefined)
}

function unwrapData(body: unknown): unknown {
  return isRecord(body) && Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_UUID.test(value)
}

function isRealtimeImageType(value: unknown): value is 'media_input' | `${string}_job` {
  return value === 'media_input' || (typeof value === 'string' && IMAGE_JOB_TYPE.test(value))
}

/** @internal Validate UUIDs used in realtime path parameters and job reads. */
export function requireRealtimeUuid(value: unknown, name: string): string {
  if (!isCanonicalUuid(value))
    throw new ValidationError(`Invalid realtime ${name}`, [{ loc: [name], msg: `${name} must be a canonical UUID` }])
  return value
}
