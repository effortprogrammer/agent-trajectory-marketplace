import type { MediaIssue } from '../groups/media'
import type { GenerationInput, MediaInput, MediaRef } from '../types'

export interface Size {
  width: number
  height: number
}

export function refsFor(media: MediaInput | undefined, role: string): MediaRef[] {
  const value = media?.[role]
  return Array.isArray(value) ? value : value ? [value] : []
}

export function firstMetaSize(media: MediaInput | undefined, roles: readonly string[]): Size | undefined {
  for (const role of roles) {
    for (const ref of refsFor(media, role)) {
      const { width, height } = ref.meta ?? {}
      if (width != null && height != null && height > 0)
        return { width, height }
    }
  }
  return undefined
}

export function firstMetaDuration(media: MediaInput | undefined, roles: readonly string[]): number | undefined {
  for (const role of roles) {
    for (const ref of refsFor(media, role)) {
      const seconds = ref.meta?.durationSec
      if (seconds != null)
        return seconds
    }
  }
  return undefined
}

export function integerRange(field: string, value: number | null | undefined, min: number, max: number): MediaIssue[] {
  if (value == null)
    return []
  if (Number.isInteger(value) && value >= min && value <= max)
    return []
  return [{ loc: ['settings', field], msg: `${field} must be an integer between ${min} and ${max}` }]
}

export function requiredPromptOrRole(input: GenerationInput, role: string, message: string): MediaIssue[] {
  const prompt = (input.prompt?.instruction ?? '').trim()
  if (prompt.length > 0 || refsFor(input.media, role).length > 0)
    return []
  return [{ loc: ['prompt'], msg: message }]
}

export function extractAngleRefIds(text: string): string[] {
  const ids = new Set<string>()
  for (const match of text.matchAll(/<<<([^>]+)>>>/g)) {
    const value = match[1]?.trim()
    if (!value || /^(image|video|audio|cast)_/.test(value))
      continue
    if (value.startsWith('element_')) {
      const id = value.slice('element_'.length)
      if (id && !/^\d+$/.test(id))
        ids.add(id)
      continue
    }
    ids.add(value)
  }
  return [...ids]
}

export function batch(settings: Record<string, unknown>, fallback = 1): number {
  return typeof settings.batchSize === 'number' ? settings.batchSize : fallback
}
