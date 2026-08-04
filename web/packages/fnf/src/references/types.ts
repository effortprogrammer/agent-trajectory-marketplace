export type ReferenceCategory =
  | 'auto'
  | 'character'
  | 'environment'
  | 'prop'
  | 'auto:character'
  | 'auto:environment'
  | 'auto:prop'
  | 'voice'
  | 'character_ip_verified'
  | 'environment_ip_verified'
  | null

export type ReferenceStatus =
  | 'processing'
  | 'completed'
  | 'kling_failed'
  | 'voice_clone_failed'
  | 'failed'
  | 'ip_checking'
  | 'ip_detected'
  | 'nsfw'
  | null

export interface ReferenceMedia {
  id: string
  url: string
  type: string
}

export interface Reference {
  id: string
  name: string
  category: ReferenceCategory
  status: ReferenceStatus
  description: string | null
  medias: ReferenceMedia[]
  videoMedias: ReferenceMedia[]
  /** Custom-reference id for Character Elements; pass it to a compatible Soul generation model. */
  characterId?: string
  createdAt?: number
}

export interface ReferenceListQuery {
  cursor?: number
  size?: number
  category?: Exclude<ReferenceCategory, null>
}

export interface ReferenceListResult {
  items: Reference[]
  nextCursor?: number
}

export interface ReferenceWaitOptions {
  signal?: AbortSignal
  intervalMs?: number
  timeoutMs?: number
  onProgress?: (reference: Reference) => void
}
