import { z } from "zod"

// Single shared policy value for the bounded timestamp lexical length. The
// observation policy re-exports this constant so callers keep referring to one
// source of truth (see observation-contract.ts).
export const maxTimestampChars = 64 as const

// Lexical timestamp shape with captured groups used for explicit calendar/time/offset
// bounds (incl. leap years). Date.parse is intentionally avoided: most runtimes
// normalize impossible calendar components rather than rejecting them.
const timestampComponentPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/

type TimestampComponents = Readonly<{
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  offsetHours: number
  offsetMinutes: number
}>

const daysInMonthByOrdinal = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

const isLeapYear = (year: number): boolean =>
  year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0)

const maxDaysInMonth = (year: number, month: number): number => {
  if (month === 2 && isLeapYear(year)) return 29
  return daysInMonthByOrdinal[month - 1] ?? 0
}

const parseTimestampComponents = (value: string): TimestampComponents | null => {
  const match = timestampComponentPattern.exec(value)
  if (match === null) return null
  const [, year, month, day, hour, minute, second, offset] = match
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined ||
    offset === undefined
  ) {
    return null
  }
  const isUtc = offset === "Z"
  return {
    year: Number.parseInt(year, 10),
    month: Number.parseInt(month, 10),
    day: Number.parseInt(day, 10),
    hour: Number.parseInt(hour, 10),
    minute: Number.parseInt(minute, 10),
    second: Number.parseInt(second, 10),
    offsetHours: isUtc ? 0 : Number.parseInt(offset.slice(1, 3), 10),
    offsetMinutes: isUtc ? 0 : Number.parseInt(offset.slice(4, 6), 10),
  }
}

const timestampComponentsAreValid = (components: TimestampComponents): boolean => {
  const { year, month, day, hour, minute, second, offsetHours, offsetMinutes } = components
  if (month < 1 || month > 12) return false
  if (day < 1 || day > maxDaysInMonth(year, month)) return false
  if (hour > 23) return false
  if (minute > 59) return false
  if (second > 59) return false
  // ISO 8601 bounds UTC offsets to ±00:00 through ±14:00.
  if (offsetHours > 14) return false
  if (offsetMinutes > 59) return false
  if (offsetHours === 14 && offsetMinutes > 0) return false
  return true
}

const hasValidIso8601CalendarComponents = (value: string): boolean => {
  const components = parseTimestampComponents(value)
  return components !== null && timestampComponentsAreValid(components)
}

export const atfTimestampSchema = z
  .string()
  .min(1)
  .max(maxTimestampChars)
  .regex(timestampComponentPattern, "invalid_iso_8601_timestamp")
  .refine(hasValidIso8601CalendarComponents, "invalid_iso_8601_timestamp")
