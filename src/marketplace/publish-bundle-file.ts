import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs"
import { isAbsolute } from "node:path"

import { datasetArchivePolicy } from "./archive-contract"

export class PublishBundleError extends Error {
  readonly name = "PublishBundleError"
  constructor(
    readonly code: "invalid_bundle_request" | "unsupported_model",
  ) {
    super(code)
  }
}

export type PublishBundleReadOptions = Readonly<{ readonly afterInitialStat?: () => void }>

type FileVersion = Readonly<{
  readonly ctimeNs: bigint
  readonly dev: bigint
  readonly ino: bigint
  readonly mtimeNs: bigint
  readonly size: bigint
}>

const invalid = (): never => { throw new PublishBundleError("invalid_bundle_request") }

const sameFile = (left: FileVersion, right: FileVersion): boolean =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs

export const readBundleFile = (path: string, options: PublishBundleReadOptions): Buffer => {
  if (!isAbsolute(path) || path.includes("\0")) return invalid()
  let descriptor: number | undefined
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const before = fstatSync(descriptor, { bigint: true })
    if (
      !before.isFile() ||
      before.size <= 0n ||
      before.size > BigInt(datasetArchivePolicy.maxArchiveBytes)
    ) return invalid()
    options.afterInitialStat?.()
    const bytes = Buffer.allocUnsafeSlow(Number(before.size))
    let offset = 0
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset)
      if (count <= 0) return invalid()
      offset += count
    }
    if (!sameFile(before, fstatSync(descriptor, { bigint: true }))) return invalid()
    return bytes
  } catch (error) {
    if (error instanceof PublishBundleError) throw error
    return invalid()
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}
