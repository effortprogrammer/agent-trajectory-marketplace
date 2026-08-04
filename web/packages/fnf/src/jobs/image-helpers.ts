import type { MediaRef } from '../types'
import { ValidationError } from '../errors'
import { z } from '../z'

export interface WireMediaData {
  id: string
  type: string
  url?: string
}

export const mediaRefSchema = z.custom<MediaRef>(isMediaRef)

export function isMediaRef(value: unknown): value is MediaRef {
  if (!value || typeof value !== 'object')
    return false
  const ref = value as Partial<MediaRef>
  return typeof ref.id === 'string' && typeof ref.type === 'string'
}

export function toWireMediaData(value: unknown): WireMediaData | undefined {
  if (!isMediaRef(value))
    return undefined
  return {
    id: value.id,
    type: value.type,
    ...(value.url !== undefined ? { url: value.url } : {}),
  }
}

export function dimensionsFromRatios<Ratio extends string>(
  ratios: Record<Ratio, readonly [number, number]>,
  aspectRatio: Ratio,
  base: number,
): { width: number, height: number } {
  const ratio = ratios[aspectRatio]
  if (!ratio) {
    throw new ValidationError(`aspect ratio '${aspectRatio}' is not supported (allowed: ${Object.keys(ratios).join(', ')})`, [
      { loc: ['settings', 'aspectRatio'], msg: `aspect ratio '${aspectRatio}' is not supported` },
    ])
  }

  const [wRatio, hRatio] = ratio
  const maxRatio = Math.max(wRatio, hRatio)
  return {
    width: Math.round(base * (wRatio / maxRatio)),
    height: Math.round(base * (hRatio / maxRatio)),
  }
}
