import type { Codec } from '../group'
import type { MediaFormat, MediaInput, MediaRef } from '../types'
import { ValidationError } from '../errors'

/**
 * A cross-role rule: gets the per-role ref counts (absent role = 0) plus the
 * refs themselves (for rules over `MediaRef.meta`), and returns one or more
 * problem messages, or null when satisfied. Ship combinators cover the known
 * product rules — cardinality (`requiresOneOf`, `atLeastOneOf`, `maxTotal`)
 * and meta (`dimensionsWithin`, `durationsWithin`); a custom rule is just a
 * function with this signature.
 */
export type MediaRule<Roles extends string = string> = (
  counts: Record<Roles, number>,
  refs: Partial<Record<Roles, MediaRef[]>>,
) => string | string[] | null

/** Pydantic-shaped issue — the same shape backend 422 details use. */
export interface MediaIssue {
  loc: string[]
  msg: string
}

export interface MediaConfig {
  field: string
  format: MediaFormat
  roles: readonly string[]
  /** Per-role cardinality: `min >= 1` makes the role required; `max` caps it. */
  counts?: Partial<Record<string, { min?: number, max?: number }>>
  /** Cross-role rules, checked on submit after cardinality. */
  rules?: readonly MediaRule[]
}

/** Cross-role combinator: `role`, when present, needs at least one of `anyOf`. */
export function requiresOneOf<R extends string>(role: R, anyOf: readonly R[]): MediaRule<R> {
  return (counts) => {
    if ((counts[role] ?? 0) === 0)
      return null
    return anyOf.some(dep => (counts[dep] ?? 0) > 0)
      ? null
      : `media role '${role}' requires one of: ${anyOf.join(', ')}`
  }
}

/** Cross-role combinator: at least one of `roles` must be present. */
export function atLeastOneOf<R extends string>(roles: readonly R[]): MediaRule<R> {
  return counts => roles.some(role => (counts[role] ?? 0) > 0)
    ? null
    : `at least one of media roles is required: ${roles.join(', ')}`
}

/** Cross-role combinator: the refs across `roles` may not exceed `max` in total. */
export function maxTotal<R extends string>(roles: readonly R[], max: number): MediaRule<R> {
  return (counts) => {
    const total = roles.reduce((sum, role) => sum + (counts[role] ?? 0), 0)
    return total <= max ? null : `media roles ${roles.join('+')} take at most ${max} ref(s) in total, got ${total}`
  }
}

// ── meta rules ──
//
// These judge `MediaRef.meta` (intrinsic size/duration). A ref whose meta is
// missing is SKIPPED — meta is local knowledge, not a requirement; the backend
// re-validates regardless. Opt in to `resolveMediaMeta` before checking when
// you want every ref measured.

export interface DimensionLimits {
  /** Both sides must be at least this many pixels. */
  minSide?: number
  /** Neither side may exceed this many pixels. */
  maxSide?: number
  /** Total pixel floor (width × height) — fnf applies it to video inputs. */
  minPixels?: number
  /** Allowed width/height ratio window, e.g. [0.4, 2.5] (2:5 … 5:2). */
  ratio?: readonly [number, number]
}

/** Meta combinator: refs in `roles` whose known size violates `limits`. */
export function dimensionsWithin<R extends string>(roles: readonly R[], limits: DimensionLimits): MediaRule<R> {
  return (_counts, refs) => {
    const problems: string[] = []
    for (const { label, ref } of labeled(roles, refs)) {
      const { width, height } = ref.meta ?? {}
      if (width == null || height == null)
        continue // unknown size — nothing to judge locally
      // The else-if chain below is DELIBERATE — one issue per ref, first
      // violated constraint wins, mirroring fnf-web's getMediaConstraintError
      // (built.ts early-returns in the same order). Don't flatten into
      // independent ifs: issue counts/messages would diverge from the product.
      if (limits.minSide != null && (width < limits.minSide || height < limits.minSide))
        problems.push(`${label} is too small — the minimum dimension is ${limits.minSide}px`)
      else if (limits.maxSide != null && (width > limits.maxSide || height > limits.maxSide))
        problems.push(`${label} is too large — the maximum dimension is ${limits.maxSide}px`)
      else if (limits.minPixels != null && width * height < limits.minPixels)
        problems.push(`${label} resolution is too low — at least ${limits.minPixels} pixels are required`)
      else if (limits.ratio && (width / height < limits.ratio[0] || width / height > limits.ratio[1]))
        problems.push(`${label} aspect ratio must be between ${limits.ratio[0]} and ${limits.ratio[1]}`)
    }
    return problems.length > 0 ? problems : null
  }
}

/** Meta combinator: per-ref duration bounds and/or a combined budget across `roles`. */
export function durationsWithin<R extends string>(
  roles: readonly R[],
  bounds: { each?: readonly [number, number], total?: number },
): MediaRule<R> {
  return (_counts, refs) => {
    const problems: string[] = []
    let combined = 0
    for (const { label, ref } of labeled(roles, refs)) {
      const seconds = ref.meta?.durationSec
      if (seconds == null)
        continue // unknown duration — nothing to judge locally
      combined += seconds
      if (bounds.each && (seconds < bounds.each[0] || seconds > bounds.each[1]))
        problems.push(`${label} must be between ${bounds.each[0]} and ${bounds.each[1]} seconds`)
    }
    if (bounds.total != null && combined > bounds.total)
      problems.push(`combined ${roles.join(' + ')} duration must be at most ${bounds.total}s, got ${round1(combined)}s`)
    return problems.length > 0 ? problems : null
  }
}

/** Flatten role buckets into human-labeled refs: ('start_image', 2nd) → "Start image 2". */
function* labeled<R extends string>(roles: readonly R[], refs: Partial<Record<R, MediaRef[]>>): Generator<{ label: string, ref: MediaRef }> {
  for (const role of roles) {
    const bucket = refs[role] ?? []
    for (let i = 0; i < bucket.length; i++) {
      const name = role.replace(/_/g, ' ')
      yield { label: `${name.charAt(0).toUpperCase()}${name.slice(1)}${bucket.length > 1 ? ` ${i + 1}` : ''}`, ref: bucket[i] }
    }
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Validate cardinality + cross-role rules against a submit's media input.
 * Pure — returns ALL problems (not first-throw); the codec stays a dumb mapper.
 */
export function checkMedia(cfg: MediaConfig, media: MediaInput | undefined): MediaIssue[] {
  const counts: Record<string, number> = {}
  const refs: Record<string, MediaRef[]> = {}
  for (const role of cfg.roles) {
    refs[role] = asArray(media?.[role])
    counts[role] = refs[role].length
  }

  const issues: MediaIssue[] = []
  for (const [role, limit] of Object.entries(cfg.counts ?? {})) {
    const count = counts[role] ?? 0
    if (limit?.min != null && count < limit.min)
      issues.push({ loc: ['media', role], msg: `media role '${role}' requires at least ${limit.min} ref(s), got ${count}` })
    if (limit?.max != null && count > limit.max)
      issues.push({ loc: ['media', role], msg: `media role '${role}' takes at most ${limit.max} ref(s), got ${count}` })
  }
  for (const rule of cfg.rules ?? []) {
    const problems = rule(counts, refs)
    for (const msg of problems == null ? [] : Array.isArray(problems) ? problems : [problems])
      issues.push({ loc: ['media'], msg })
  }
  return issues
}

interface WireData {
  id: string
  type: string
  url?: string
}

function toData(ref: MediaRef): WireData {
  const data: WireData = { id: ref.id, type: ref.type }
  if (ref.url !== undefined)
    data.url = ref.url
  return data
}

function asArray(value: MediaRef | MediaRef[] | undefined): MediaRef[] {
  if (!value)
    return []
  return Array.isArray(value) ? value : [value]
}

function pushRole(media: MediaInput, role: string, ref: MediaRef): void {
  const existing = media[role]
  if (Array.isArray(existing))
    existing.push(ref)
  else media[role] = [ref]
}

export function mediaCodec(cfg: MediaConfig): Codec<MediaInput> {
  return {
    wireKeys: [cfg.field],
    serialize(media) {
      // Loud, not lossy: a role outside the declaration would be silently
      // dropped by the role loop below (typos, or a ref parsed from a newer
      // backend) — reject it instead so get-then-resubmit can't lose media.
      const undeclared = Object.keys(media ?? {}).filter(role => media[role] !== undefined && !cfg.roles.includes(role))
      if (undeclared.length > 0)
        throw new ValidationError(`Media role(s) not declared by this job: ${undeclared.join(', ')} (allowed: ${cfg.roles.join(', ')})`)

      const items: { role: string, ref: MediaRef }[] = []
      for (const role of cfg.roles) {
        for (const ref of asArray(media?.[role])) items.push({ role, ref })
      }
      if (items.length === 0)
        return {}
      if (cfg.format === 'single') {
        if (items.length > 1)
          throw new ValidationError(`Media format 'single' takes exactly one ref, got ${items.length}`)
        return { [cfg.field]: toData(items[0].ref) }
      }
      if (cfg.format === 'wrapped') {
        return { [cfg.field]: items.map(i => ({ role: i.role, data: toData(i.ref) })) }
      }
      return { [cfg.field]: items.map(i => toData(i.ref)) }
    },
    parse(wire) {
      const media: MediaInput = {}
      const raw = wire[cfg.field]
      if (raw == null)
        return media
      const arr = Array.isArray(raw) ? raw : [raw]
      for (const entry of arr) {
        if (cfg.format === 'wrapped') {
          const w = entry as { role?: string, data?: WireData }
          const role = w.role ?? cfg.roles[0]
          const data = w.data ?? ({} as WireData)
          pushRole(media, role, { ...data, role })
        }
        else {
          const data = entry as WireData
          const role = cfg.roles[0]
          pushRole(media, role, { ...data, role })
        }
      }
      return media
    },
  }
}
