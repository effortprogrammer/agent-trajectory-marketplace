const utf8Bom = [0xef, 0xbb, 0xbf] as const

class JsonPreflightError extends Error {
  public constructor() {
    super("invalid_json_preflight")
    this.name = "JsonPreflightError"
  }
}

const fail = (): never => {
  throw new JsonPreflightError()
}

type ScanState = Readonly<{ text: string; length: number }>

type ScanCursor = { offset: number }

const skipWhitespace = (state: ScanState, cursor: ScanCursor): void => {
  while (cursor.offset < state.length) {
    const code = state.text.charCodeAt(cursor.offset)
    if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return
    cursor.offset += 1
  }
}

const readEscape = (state: ScanState, cursor: ScanCursor): string => {
  cursor.offset += 1
  if (cursor.offset >= state.length) return fail()
  const escaped = state.text[cursor.offset]
  cursor.offset += 1
  switch (escaped) {
    case '"':
    case "\\":
    case "/":
      return escaped
    case "b":
      return "\b"
    case "f":
      return "\f"
    case "n":
      return "\n"
    case "r":
      return "\r"
    case "t":
      return "\t"
    case "u": {
      if (cursor.offset + 4 > state.length) return fail()
      const first = Number.parseInt(state.text.slice(cursor.offset, cursor.offset + 4), 16)
      if (!Number.isInteger(first) || Number.isNaN(first) || /[^0-9a-fA-F]/.test(state.text.slice(cursor.offset, cursor.offset + 4))) return fail()
      cursor.offset += 4
      if (first >= 0xd800 && first <= 0xdbff) {
        if (state.text[cursor.offset] !== "\\" || state.text[cursor.offset + 1] !== "u") return fail()
        const second = Number.parseInt(state.text.slice(cursor.offset + 2, cursor.offset + 6), 16)
        if (
          cursor.offset + 6 > state.length ||
          Number.isNaN(second) ||
          /[^0-9a-fA-F]/.test(state.text.slice(cursor.offset + 2, cursor.offset + 6)) ||
          second < 0xdc00 ||
          second > 0xdfff
        ) return fail()
        cursor.offset += 6
        return String.fromCodePoint((first - 0xd800) * 0x400 + second - 0xdc00 + 0x10000)
      }
      if (first >= 0xdc00 && first <= 0xdfff) return fail()
      return String.fromCharCode(first)
    }
    default:
      return fail()
  }
}

const readString = (state: ScanState, cursor: ScanCursor): string => {
  if (state.text[cursor.offset] !== '"') return fail()
  cursor.offset += 1
  let decoded = ""
  while (cursor.offset < state.length) {
    const code = state.text.charCodeAt(cursor.offset)
    if (code === 0x22) {
      cursor.offset += 1
      return decoded
    }
    if (code === 0x5c) {
      decoded += readEscape(state, cursor)
      continue
    }
    if (code < 0x20) return fail()
    decoded += state.text[cursor.offset]
    cursor.offset += 1
  }
  return fail()
}

const readNumber = (state: ScanState, cursor: ScanCursor): void => {
  const start = cursor.offset
  for (;;) {
    const char = state.text[cursor.offset]
    if (char === undefined || !/[-+0-9.eE]/.test(char)) break
    cursor.offset += 1
  }
  if (cursor.offset === start) return fail()
}

const readLiteral = (state: ScanState, cursor: ScanCursor, literal: string): void => {
  if (!state.text.startsWith(literal, cursor.offset)) return fail()
  cursor.offset += literal.length
}

const readValue = (state: ScanState, cursor: ScanCursor): void => {
  skipWhitespace(state, cursor)
  if (cursor.offset >= state.length) return fail()
  const code = state.text[cursor.offset]
  if (code === "{") return readObject(state, cursor)
  if (code === "[") return readArray(state, cursor)
  if (code === '"') {
    readString(state, cursor)
    return
  }
  if (code === "t") return readLiteral(state, cursor, "true")
  if (code === "f") return readLiteral(state, cursor, "false")
  if (code === "n") return readLiteral(state, cursor, "null")
  return readNumber(state, cursor)
}

const readObject = (state: ScanState, cursor: ScanCursor): void => {
  cursor.offset += 1
  const keys = new Set<string>()
  skipWhitespace(state, cursor)
  if (state.text[cursor.offset] === "}") {
    cursor.offset += 1
    return
  }
  for (;;) {
    skipWhitespace(state, cursor)
    const key = readString(state, cursor)
    if (keys.has(key)) return fail()
    keys.add(key)
    skipWhitespace(state, cursor)
    if (state.text[cursor.offset] !== ":") return fail()
    cursor.offset += 1
    readValue(state, cursor)
    skipWhitespace(state, cursor)
    if (state.text[cursor.offset] === "}") {
      cursor.offset += 1
      return
    }
    if (state.text[cursor.offset] !== ",") return fail()
    cursor.offset += 1
  }
}

const readArray = (state: ScanState, cursor: ScanCursor): void => {
  cursor.offset += 1
  skipWhitespace(state, cursor)
  if (state.text[cursor.offset] === "]") {
    cursor.offset += 1
    return
  }
  for (;;) {
    readValue(state, cursor)
    skipWhitespace(state, cursor)
    if (state.text[cursor.offset] === "]") {
      cursor.offset += 1
      return
    }
    if (state.text[cursor.offset] !== ",") return fail()
    cursor.offset += 1
  }
}

const hasUniqueJsonKeys = (text: string): boolean => {
  try {
    const state: ScanState = { text, length: text.length }
    const cursor: ScanCursor = { offset: 0 }
    readValue(state, cursor)
    skipWhitespace(state, cursor)
    return cursor.offset === state.length
  } catch (error) {
    if (error instanceof JsonPreflightError) return false
    throw error
  }
}

export const parseAdmissionJson = (data: Buffer): unknown => {
  if (
    data.length >= utf8Bom.length &&
    data[0] === utf8Bom[0] &&
    data[1] === utf8Bom[1] &&
    data[2] === utf8Bom[2]
  ) return undefined
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data)
  } catch {
    return undefined
  }
  if (!hasUniqueJsonKeys(text)) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
