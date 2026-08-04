import type { Reference, ReferenceCategory, ReferenceMedia, ReferenceStatus } from './types'
import { ValidationError } from '../errors'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function normalizeStatus(value: unknown): ReferenceStatus {
  if (
    value === 'processing'
    || value === 'completed'
    || value === 'kling_failed'
    || value === 'voice_clone_failed'
    || value === 'failed'
    || value === 'ip_checking'
    || value === 'ip_detected'
    || value === 'nsfw'
  ) {
    return value
  }
  return null
}

function normalizeCategory(value: unknown): ReferenceCategory {
  if (
    value === 'auto'
    || value === 'character'
    || value === 'environment'
    || value === 'prop'
    || value === 'auto:character'
    || value === 'auto:environment'
    || value === 'auto:prop'
    || value === 'voice'
    || value === 'character_ip_verified'
    || value === 'environment_ip_verified'
  ) {
    return value
  }
  return null
}

function parseMediaList(value: unknown): ReferenceMedia[] {
  if (!Array.isArray(value))
    return []

  return value.flatMap((item) => {
    if (!isRecord(item))
      return []
    const id = optionalString(item.id)
    const url = optionalString(item.url)
    const type = optionalString(item.type)
    if (!id || !url || !type)
      return []
    return [{
      id,
      url,
      type,
    }]
  })
}

export function parseReference(body: unknown): Reference {
  const value = isRecord(body) && isRecord(body.data) ? body.data : body
  if (!isRecord(value))
    throw new ValidationError('Invalid reference response')

  const id = optionalString(value.id) ?? optionalString(value.id_)
  if (!id)
    throw new ValidationError('Invalid reference response', [{ loc: ['id'], msg: 'reference id is required' }])

  const name = optionalString(value.name)
  if (!name)
    throw new ValidationError('Invalid reference response', [{ loc: ['name'], msg: 'reference name is required' }])

  const description = optionalString(value.description) ?? null
  const characterId = optionalString(value.character_id) ?? optionalString(value.soul_character_id)
  return {
    id,
    name,
    category: normalizeCategory(value.category),
    status: normalizeStatus(value.status),
    description,
    medias: parseMediaList(value.medias),
    videoMedias: parseMediaList(value.video_medias),
    ...(characterId ? { characterId } : {}),
    ...(typeof value.created_at === 'number' ? { createdAt: value.created_at } : {}),
  }
}
