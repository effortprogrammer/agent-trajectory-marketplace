import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs"
import type { Stats } from "node:fs"
import { dirname, join, parse, relative, resolve, sep } from "node:path"

export const authStoreErrorCodes = [
  "invalid_auth_store",
  "unsafe_auth_store_path",
  "auth_store_write_failed",
] as const

export type AuthStoreErrorCode = (typeof authStoreErrorCodes)[number]

export class AuthStoreError extends Error {
  readonly name = "AuthStoreError"

  constructor(readonly code: AuthStoreErrorCode) {
    super(code)
  }
}

export type AuthStoreReadOperations = Readonly<{
  readonly close: (descriptor: number) => void
  readonly currentUserId: () => number | undefined
  readonly fstat: (descriptor: number) => Stats
  readonly lstat: (path: string) => Stats
  readonly openReadOnly: (path: string) => number
  readonly read: (descriptor: number) => string
}>

export const nodeAuthStoreReadOperations: AuthStoreReadOperations = Object.freeze({
  close: (descriptor): void => closeSync(descriptor),
  currentUserId: (): number | undefined =>
    typeof process.getuid === "function" ? process.getuid() : undefined,
  fstat: (descriptor): Stats => fstatSync(descriptor),
  lstat: (path): Stats => lstatSync(path),
  openReadOnly: (path): number => openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW),
  read: (descriptor): string => readFileSync(descriptor, "utf8"),
})

export const sameAuthStoreFile = (left: Stats, right: Stats): boolean =>
  left.dev === right.dev && left.ino === right.ino

const isMissing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT"

const lstatIfPresent = (path: string): Stats | undefined => {
  try {
    return lstatSync(path)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw new AuthStoreError("unsafe_auth_store_path")
  }
}

const unsafeDirectory = (status: Stats): boolean => {
  const userId = typeof process.getuid === "function" ? process.getuid() : undefined
  return status.isSymbolicLink() || !status.isDirectory() ||
    (userId !== undefined && (status.uid !== userId || (status.mode & 0o022) !== 0))
}

const assertSafeOriginalPath = (path: string): void => {
  const absolute = resolve(path)
  const root = parse(absolute).root
  let current = root
  for (const segment of relative(root, absolute).split(sep)) {
    current = join(current, segment)
    const status = lstatIfPresent(current)
    if (status === undefined) return
    const parent = lstatSync(dirname(current))
    if (status.isDirectory() && (status.mode & 0o022) !== 0 && (status.mode & 0o1000) === 0) {
      throw new AuthStoreError("unsafe_auth_store_path")
    }
    if (status.isSymbolicLink() && (status.uid !== 0 || (parent.mode & 0o022) !== 0)) {
      throw new AuthStoreError("unsafe_auth_store_path")
    }
  }
}

const assertSafeAncestorChain = (path: string): void => {
  let current = realpathSync(path)
  while (true) {
    const status = lstatSync(current)
    const sharedWithoutSticky = (status.mode & 0o022) !== 0 && (status.mode & 0o1000) === 0
    if (!status.isDirectory() || status.isSymbolicLink() || sharedWithoutSticky) {
      throw new AuthStoreError("unsafe_auth_store_path")
    }
    const parent = dirname(current)
    if (parent === current) return
    current = parent
  }
}

export const assertSafeExistingAuthStorePath = (path: string): void => {
  const directory = dirname(path)
  const configHome = dirname(directory)
  assertSafeOriginalPath(configHome)
  const configStatus = lstatIfPresent(configHome)
  if (configStatus !== undefined && unsafeDirectory(configStatus)) {
    throw new AuthStoreError("unsafe_auth_store_path")
  }
  if (configStatus !== undefined) assertSafeAncestorChain(configHome)
  const directoryStatus = lstatIfPresent(directory)
  if (directoryStatus !== undefined && unsafeDirectory(directoryStatus)) {
    throw new AuthStoreError("unsafe_auth_store_path")
  }
  const fileStatus = lstatIfPresent(path)
  if (fileStatus?.isSymbolicLink() || (fileStatus !== undefined && !fileStatus.isFile())) {
    throw new AuthStoreError("unsafe_auth_store_path")
  }
}

export function readAuthStoreFile(
  path: string,
  operations: AuthStoreReadOperations = nodeAuthStoreReadOperations,
): string | undefined {
  assertSafeExistingAuthStorePath(path)
  if (lstatIfPresent(path) === undefined) return undefined
  const descriptor = operations.openReadOnly(path)
  try {
    let descriptorStatus: Stats
    let pathStatus: Stats
    try {
      descriptorStatus = operations.fstat(descriptor)
      pathStatus = operations.lstat(path)
    } catch (error) {
      if (error instanceof Error) throw new AuthStoreError("unsafe_auth_store_path")
      throw error
    }
    const currentUserId = operations.currentUserId()
    const owned = currentUserId === undefined || descriptorStatus.uid === currentUserId
    if (!descriptorStatus.isFile() || !owned || (descriptorStatus.mode & 0o077) !== 0 ||
      pathStatus.isSymbolicLink() || !sameAuthStoreFile(descriptorStatus, pathStatus)) {
      throw new AuthStoreError("unsafe_auth_store_path")
    }
    return operations.read(descriptor)
  } finally {
    operations.close(descriptor)
  }
}
