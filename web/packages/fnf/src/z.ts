import * as base from 'zod/mini'

export type Normalize =
  | { kind: 'aspectRatio', options: readonly string[] }
  | { kind: 'duration', values?: readonly number[], min?: number, max?: number }

/**
 * Side table from a normalized schema object to its descriptor. Keyed on the
 * schema instance via a WeakMap so we never mutate the zod object (no extra
 * own-property, no `as unknown as`) and don't depend on zod tolerating stray
 * properties across versions.
 */
const NORMALIZERS = new WeakMap<object, Normalize>()

/**
 * Look a schema up in a side table, walking zod wrapper chains
 * (`z.optional(...)` / `z._default(...)` expose the tagged inner schema via
 * `_zod.def.innerType`) so wrapping a tagged schema doesn't silently drop
 * its normalizer / wire name.
 */
function lookup<T>(schema: unknown, table: WeakMap<object, T>): T | undefined {
  let current = typeof schema === 'object' && schema !== null ? (schema as object) : undefined
  for (let depth = 0; current && depth < 10; depth++) {
    const hit = table.get(current)
    if (hit !== undefined)
      return hit
    const inner = (current as { _zod?: { def?: { innerType?: unknown } } })._zod?.def?.innerType
    current = typeof inner === 'object' && inner !== null ? (inner as object) : undefined
  }
  return undefined
}

export function getNormalize(schema: unknown): Normalize | undefined {
  return lookup(schema, NORMALIZERS)
}

/**
 * Side table mapping a settings schema to its wire field name. By default a
 * job's settings key IS the wire key; `z.wire('aspect_ratio', schema)` decouples
 * them so the typed API stays camelCase while the wire emits the backend's
 * canonical name. Same WeakMap pattern as the normalizers — no schema mutation.
 */
const WIRE_NAMES = new WeakMap<object, string>()

export function getWireName(schema: unknown): string | undefined {
  return lookup(schema, WIRE_NAMES)
}

/** Tag a settings schema with an explicit wire field name (typed identity). */
export function wire<T extends object>(name: string, schema: T): T {
  WIRE_NAMES.set(schema, name)
  return schema
}

/**
 * Phantom marker that carries the *static* input type of a normalized field —
 * the literal union of allowed values — separate from the runtime schema, which
 * stays permissive so normalization can run. Never present at runtime; read by
 * `SettingsInput` to type the field. See `FieldInput` in define-job.ts.
 */
export declare const NORMALIZE_TYPE: unique symbol
export interface NormalizeType<T> { readonly [NORMALIZE_TYPE]: T }

export function aspectRatio<const O extends readonly string[]>(options: O) {
  // Runtime accepts any ratio string; normalization maps it to the closest
  // allowed option. (An enum would reject inputs like "1920:1081" before we can
  // normalize.) The static type, though, is the literal union `O[number]` so
  // callers get autocomplete on the canonical ratios.
  const schema = base.string()
  NORMALIZERS.set(schema, { kind: 'aspectRatio', options })
  return schema as typeof schema & NormalizeType<O[number]>
}

export function duration<const V extends readonly number[] = never>(
  opts: { values?: V, min?: number, max?: number },
) {
  // Same shape as aspectRatio: permissive `number` at runtime, literal union of
  // `values` at the type level (or plain `number` for a min/max range).
  const schema = base.number()
  NORMALIZERS.set(schema, { kind: 'duration', ...opts })
  return schema as typeof schema & NormalizeType<[V] extends [never] ? number : V[number]>
}

function _default<T extends base.ZodMiniType>(
  innerType: T,
  defaultValue: unknown,
): base.ZodMiniDefault<T> & (T extends NormalizeType<infer U> ? NormalizeType<U | undefined> : object) {
  return base._default(innerType, defaultValue as never) as base.ZodMiniDefault<T> & (T extends NormalizeType<infer U> ? NormalizeType<U | undefined> : object)
}

export const z = { ...base, _default, aspectRatio, duration, wire }
