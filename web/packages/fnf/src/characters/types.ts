import type { MediaRef } from '../types'

export type CharacterStatus = 'queued' | 'in_progress' | 'completed' | 'failed'
export type CharacterType = 'soul' | 'soul_2' | 'soul_cinematic'

export interface Character {
  /** Custom-reference id used by compatible Soul generation models. */
  id: string
  /** Linked Character Element id when the backend includes it. */
  elementId?: string
  name?: string
  type: CharacterType
  status: CharacterStatus
  failReason?: string
  thumbnailUrl?: string
  createdAt?: number
}

export interface CreateCharacterInput {
  name?: string
  /** Defaults to `soul_2`. */
  type?: CharacterType
  images: MediaRef[]
}

export interface CharacterCreateRequest {
  name: string
  type: CharacterType
  input_images: Array<{ id: string, type: string }>
}

export interface CharacterWaitOptions {
  signal?: AbortSignal
  intervalMs?: number
  timeoutMs?: number
  onProgress?: (character: Character) => void
}
