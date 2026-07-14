// The one recursive string-leaf traversal shared by every stage that walks
// arbitrary payload JSON: collection-time credential sanitizing, the ML
// privacy pass, and the escrow intake scan. A single walker guarantees they
// all agree on what counts as a string leaf — a divergence here would let a
// leaf be credential-redacted but never PII-masked, or vice versa.

// Rebuilds the value with each string leaf replaced by visit(leaf).
export const mapStringLeaves = (value: unknown, visit: (text: string) => string): unknown => {
  if (typeof value === "string") {
    return visit(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => mapStringLeaves(item, visit))
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, mapStringLeaves(item, visit)]),
    )
  }
  return value
}

// True when any string leaf satisfies the predicate. Read-only: no rebuild.
export const someStringLeaf = (value: unknown, predicate: (text: string) => boolean): boolean => {
  if (typeof value === "string") {
    return predicate(value)
  }
  if (Array.isArray(value)) {
    return value.some((item) => someStringLeaf(item, predicate))
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).some((item) => someStringLeaf(item, predicate))
  }
  return false
}
