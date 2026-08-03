import type { Character, CharacterCreateRequest, CharacterStatus, CharacterType, CreateCharacterInput } from './types'
import { ValidationError } from '../errors'

const MIN_CHARACTER_IMAGES = 1
const MAX_CHARACTER_IMAGES = 100
const CHARACTER_TYPES = new Set<CharacterType>(['soul', 'soul_2', 'soul_cinematic'])

function isCharacterImageType(type: unknown): type is string {
  return typeof type === 'string' && (type === 'media_input' || type.endsWith('_job'))
}

export function buildCharacterCreateRequest(input: CreateCharacterInput): CharacterCreateRequest {
  const issues: Array<{ loc: string[], msg: string }> = []
  const name = input.name?.trim()
  const type = input.type ?? 'soul_2'

  if (!CHARACTER_TYPES.has(type))
    issues.push({ loc: ['type'], msg: 'type must be soul, soul_2, or soul_cinematic' })

  if (name && name.length > 100)
    issues.push({ loc: ['name'], msg: 'name must be at most 100 characters' })

  if (!Array.isArray(input.images) || input.images.length < MIN_CHARACTER_IMAGES || input.images.length > MAX_CHARACTER_IMAGES) {
    issues.push({ loc: ['images'], msg: `images must contain between ${MIN_CHARACTER_IMAGES} and ${MAX_CHARACTER_IMAGES} items` })
  }
  else {
    input.images.forEach((image, index) => {
      if (!image || typeof image.id !== 'string' || image.id.trim() === '')
        issues.push({ loc: ['images', String(index), 'id'], msg: 'image id is required' })
      if (!image || !isCharacterImageType(image.type))
        issues.push({ loc: ['images', String(index), 'type'], msg: 'character images must be image references' })
      else if (type === 'soul' && image.type !== 'media_input')
        issues.push({ loc: ['images', String(index), 'type'], msg: 'soul character images must be uploaded image references' })
    })
  }

  if (issues.length > 0)
    throw new ValidationError('Invalid character input', issues)

  return {
    name: name || 'Untitled character',
    type,
    input_images: input.images.map(image => ({ id: image.id, type: image.type })),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function normalizeStatus(value: unknown): CharacterStatus {
  if (value === 'completed' || value === 'showcase_completed')
    return 'completed'
  if (value === 'failed')
    return 'failed'
  if (value === 'in_progress' || value === 'training')
    return 'in_progress'
  return 'queued'
}

export function parseCharacter(body: unknown): Character {
  const value = isRecord(body) && isRecord(body.data) ? body.data : body
  if (!isRecord(value))
    throw new ValidationError('Invalid character response')

  const id = optionalString(value.id) ?? optionalString(value.id_)
  if (!id)
    throw new ValidationError('Invalid character response', [{ loc: ['id'], msg: 'character id is required' }])

  const elementId = optionalString(value.element_id)
  const name = optionalString(value.name)
  const failReason = optionalString(value.fail_reason)
  const thumbnailUrl = optionalString(value.thumbnail_url)
  const type = optionalString(value.type)
  if (!type || !CHARACTER_TYPES.has(type as CharacterType))
    throw new ValidationError('Invalid character response', [{ loc: ['type'], msg: 'unsupported character type' }])

  return {
    id,
    type: type as CharacterType,
    status: normalizeStatus(value.status),
    ...(elementId ? { elementId } : {}),
    ...(name ? { name } : {}),
    ...(failReason ? { failReason } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(typeof value.created_at === 'number' ? { createdAt: value.created_at } : {}),
  }
}
