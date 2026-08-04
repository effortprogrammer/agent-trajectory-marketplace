export interface FieldDef {
  wire: string
}

export function field(wire: string): FieldDef {
  return { wire }
}

export interface Codec<T> {
  serialize: (value: T) => Record<string, unknown>
  parse: (wire: Record<string, unknown>) => T
  wireKeys: string[]
}

export function group<M extends Record<string, FieldDef>>(
  map: M,
): Codec<{ [K in keyof M]?: unknown }> {
  const entries = Object.entries(map)
  const wireKeys = entries.map(([, def]) => def.wire)

  return {
    wireKeys,
    serialize(value) {
      const out: Record<string, unknown> = {}
      for (const [key, def] of entries) {
        const v = (value as Record<string, unknown> | null | undefined)?.[key]
        if (v !== undefined)
          out[def.wire] = v
      }
      return out
    },
    parse(wire) {
      const out: Record<string, unknown> = {}
      for (const [key, def] of entries) {
        if (wire[def.wire] !== undefined)
          out[key] = wire[def.wire]
      }
      return out as { [K in keyof M]?: unknown }
    },
  }
}
