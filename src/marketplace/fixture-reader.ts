import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs"

export class FixtureReadError extends Error {
  public readonly name = "FixtureReadError"
  public constructor(public readonly path: string, public readonly reason: string) {
    super(`${path}: ${reason}`)
  }
}

export type FixtureReadOptions = Readonly<{ readonly afterOpen?: () => void }>

export const readFixtureFile = (path: string, maximumBytes: number, options: FixtureReadOptions = {}): Buffer => {
  const invalid = (reason: string): never => {
    throw new FixtureReadError(path, reason)
  }
  let descriptor: number | undefined
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const before = fstatSync(descriptor, { bigint: true })
    if (!before.isFile() || before.size > BigInt(maximumBytes)) return invalid("not a bounded regular file")
    options.afterOpen?.()
    const bytes = Buffer.allocUnsafeSlow(Number(before.size))
    let offset = 0
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset)
      if (count <= 0) return invalid("short read")
      offset += count
    }
    const after = fstatSync(descriptor, { bigint: true })
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs
    ) return invalid("file changed during read")
    return bytes
  } catch (error) {
    if (error instanceof FixtureReadError) throw error
    return invalid("unreadable")
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}
