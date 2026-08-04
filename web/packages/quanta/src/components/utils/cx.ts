export type ClassValue = string | false | null | undefined

/**
 * Minimal class-name joiner. No tailwind-merge: components apply a single
 *  composite `menu-*` class plus an optional caller `className`.
 */
export function cx(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ')
}
