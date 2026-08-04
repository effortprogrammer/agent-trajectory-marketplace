import type { Generation, MediaRef } from '../types'

export type RealtimeMode = 'basic' | 'advanced'
export type RealtimeResolution = '1k' | '2k'
export type RealtimeAspectRatio =
  | '16:9'
  | '4:3'
  | '1:1'
  | '3:4'
  | '9:16'
  | '2:3'
  | '1:2'
  | '2:1'
  | '4:5'
  | '3:2'
  | '5:4'
  | '21:9'

export type RealtimeReferenceMode = 'style' | 'character'
export type RealtimeTarget = 'canvas' | 'selection'

export type RealtimeImageType = 'media_input' | `${string}_job`

/** A persisted image upload or image-job result accepted by realtime editing. */
export type RealtimeImageRef = Omit<MediaRef, 'type'> & {
  type: RealtimeImageType
}

/** Structured controls compiled by the backend into a Flux Klein prompt. */
export interface RealtimeSettings {
  /** Built-in style key, or `custom` with customStyle/customStyleId. */
  style: string
  customStyle?: string
  mood?: string
  palette?: string
  customColors?: string[]
  sketchInfluence?: number
  referenceMode?: RealtimeReferenceMode
  target?: RealtimeTarget
  /** A saved custom style. Its reference image is appended server-side. */
  customStyleId?: string | null
}

type RealtimePromptEdit = {
  prompt: string
  settings?: never
}

type RealtimeSettingsEdit = {
  prompt?: never
  settings: RealtimeSettings
}

/** Exactly one of prompt or settings is required. */
export type RealtimeEditParams = (RealtimePromptEdit | RealtimeSettingsEdit) & {
  mode?: RealtimeMode
  resolution: RealtimeResolution
  aspectRatio: RealtimeAspectRatio
  /**
   * Explicit source images for this attempt. Up to four are accepted. Saved
   * style references are expanded server-side by the existing realtime API.
   */
  images: RealtimeImageRef[]
}

export interface RealtimeChainEditInput {
  /** Omit/null to begin a chain; pass the previous result's chainId to continue it. */
  chainId?: string | null
  params: RealtimeEditParams
}

export interface RealtimeChainEditResult {
  chainId: string
  jobSetId: string
  /** Pass this to RealtimeClient.getEditJob/pollEditJob. */
  jobId: string
  status: string
  createdAt: number
}

export interface RealtimeChainCostInput {
  mode?: RealtimeMode
  resolution: RealtimeResolution
  aspectRatio: RealtimeAspectRatio
}

export interface RealtimeChainCostEstimate {
  /** Rounded display value returned by fnf. */
  credits: number
  /** Exact fractional credit value. */
  creditsExact: number
}

export interface RealtimeChainFinalizeInput {
  chainId: string
}

export interface RealtimeChainFinalizeResult {
  chainId: string
  status: 'finalized' | 'released'
}

export interface RealtimeCustomStyleReference {
  mediaId: string
  url?: string | null
  sourceName?: string | null
  contentType?: string | null
}

export interface RealtimeCustomStyle {
  id: string
  prompt: string
  reference: RealtimeCustomStyleReference | null
}

export interface RealtimeCustomStyleListQuery {
  /** Float epoch-seconds cursor returned by the previous page. */
  cursor?: number
  size?: number
}

export interface RealtimeCustomStyleListResult {
  items: RealtimeCustomStyle[]
  nextCursor?: number
}

export interface CreateRealtimeCustomStyleInput {
  prompt?: string
  reference?: RealtimeCustomStyleReference | null
}

export interface UpdateRealtimeCustomStyleInput {
  /** Omit/null to keep the current prompt. */
  prompt?: string | null
  /** Omit/null to keep the current reference; use clearReference to remove it. */
  reference?: RealtimeCustomStyleReference | null
  clearReference?: boolean
}

/** Per-call transport metadata; confirmation tokens are opaque to the SDK. */
export interface RealtimeChainEditOptions {
  confirmationToken?: string
}

export interface RealtimeEditPollOptions {
  signal?: AbortSignal
  /** Fires after every successful job read, including intermediate statuses. */
  onProgress?: (generation: Generation) => void
}

// Raw adapter wire contracts. They stay out of the public realtime barrel;
// application-facing inputs/results above are camelCase.
export interface RealtimeSettingsWire {
  style: string
  custom_style?: string
  mood?: string
  palette?: string
  custom_colors?: string[]
  sketch_influence?: number
  reference_mode?: RealtimeReferenceMode
  target?: RealtimeTarget
  custom_style_id?: string | null
}

export interface RealtimeEditParamsWire extends Record<string, unknown> {
  prompt?: string
  settings?: RealtimeSettingsWire
  mode: RealtimeMode
  resolution: RealtimeResolution
  aspect_ratio: RealtimeAspectRatio
  medias: Array<{ role: 'image', data: { id: string, type: RealtimeImageType } }>
}

export interface RealtimeChainEditWireRequest extends Record<string, unknown> {
  chain_id?: string | null
  params: RealtimeEditParamsWire
  confirmation_token?: string
}

export interface RealtimeChainCostWireRequest extends Record<string, unknown> {
  mode: RealtimeMode
  resolution: RealtimeResolution
  aspect_ratio: RealtimeAspectRatio
}

export interface RealtimeChainFinalizeWireRequest extends Record<string, unknown> {
  chain_id: string
}

export interface RealtimeCustomStyleReferenceWire {
  media_id: string
  url?: string | null
  source_name?: string | null
  content_type?: string | null
}

export interface CreateRealtimeCustomStyleWireRequest extends Record<string, unknown> {
  prompt: string
  reference?: RealtimeCustomStyleReferenceWire | null
}

export interface UpdateRealtimeCustomStyleWireRequest extends Record<string, unknown> {
  prompt?: string | null
  reference?: RealtimeCustomStyleReferenceWire | null
  clear_reference?: boolean
}
