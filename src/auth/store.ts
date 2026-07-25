import { randomUUID } from "node:crypto"
import { chmodSync, closeSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, renameSync, type Stats, unlinkSync, writeSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join } from "node:path"

import { z } from "zod"

import { authAccessTokenSchema, authAccountIdSchema, authExpirySchema } from "./contract"
import { AuthServerUrlError, normalizeAuthServerUrl } from "./server-url"
import {
  assertSafeExistingAuthStorePath,
  AuthStoreError,
  authStoreErrorCodes,
  readAuthStoreFile,
  sameAuthStoreFile,
} from "./store-security"
import type { AuthStoreErrorCode } from "./store-security"

export { AuthStoreError, authStoreErrorCodes }
export type { AuthStoreErrorCode }

const normalizedServerSchema = z.string().refine((server) => {
  try {
    return normalizeAuthServerUrl(server) === server
  } catch (error) {
    if (error instanceof AuthServerUrlError) return false
    throw error
  }
})

const storedAuthSessionSchema = z.object({
  server: normalizedServerSchema, accessToken: authAccessTokenSchema,
  tokenType: z.literal("Bearer"), expiresAt: authExpirySchema,
  accountId: authAccountIdSchema,
}).strict()

const authStoreSchema = z.object({
  schemaVersion: z.literal(1), sessions: z.array(storedAuthSessionSchema),
}).strict().superRefine((store, context) => {
  const servers = new Set<string>()
  for (const session of store.sessions) {
    if (servers.has(session.server)) context.addIssue({ code: "custom", message: "duplicate server" })
    servers.add(session.server)
  }
})

export type StoredAuthSession = Readonly<z.infer<typeof storedAuthSessionSchema>>
type AuthStore = Readonly<{ readonly schemaVersion: 1; readonly sessions: readonly StoredAuthSession[] }>

export type AuthStoreOperations = Readonly<{
  readonly temporaryId: () => string; readonly openExclusive: (path: string) => number
  readonly fstat: (descriptor: number) => Stats; readonly lstat: (path: string) => Stats
  readonly fchmod: (descriptor: number, mode: number) => void; readonly write: (descriptor: number, bytes: Uint8Array, offset: number) => number
  readonly fsync: (descriptor: number) => void; readonly close: (descriptor: number) => void
  readonly rename: (from: string, to: string) => void; readonly unlink: (path: string) => void
}>

export const nodeAuthStoreOperations: AuthStoreOperations = Object.freeze({
  temporaryId: (): string => randomUUID(), openExclusive: (path: string): number => openSync(path, "wx", 0o600),
  fstat: (descriptor): Stats => fstatSync(descriptor), lstat: (path): Stats => lstatSync(path),
  fchmod: (descriptor, mode): void => fchmodSync(descriptor, mode),
  write: (descriptor, bytes, offset): number => writeSync(descriptor, bytes, offset, bytes.byteLength - offset),
  fsync: (descriptor): void => fsyncSync(descriptor), close: (descriptor): void => closeSync(descriptor),
  rename: (from, to): void => renameSync(from, to), unlink: (path): void => unlinkSync(path),
})

type AuthStorePathOptions = Readonly<{ readonly environment: Readonly<Record<string, string | undefined>>; readonly homeDirectory: string; readonly platform: NodeJS.Platform }>

type AuthStoreOptions = Readonly<{ readonly storePath?: string; readonly operations?: AuthStoreOperations }>

type StoredAuthSessionInput = Readonly<{ readonly server: string; readonly accessToken: string; readonly tokenType: "Bearer"; readonly expiresAt: string; readonly accountId: string }>

const defaultPathOptions = (): AuthStorePathOptions => ({ environment: process.env, homeDirectory: homedir(), platform: process.platform })

export function authStorePath(options: AuthStorePathOptions = defaultPathOptions()): string {
  const override = options.environment["TRAJECTORY_MARKETPLACE_CONFIG_HOME"]
  const xdg = options.environment["XDG_CONFIG_HOME"]
  const platformHome = options.platform === "darwin"
    ? join(options.homeDirectory, "Library", "Application Support")
    : options.platform === "win32"
      ? options.environment["APPDATA"]?.trim() || join(options.homeDirectory, "AppData", "Roaming")
      : join(options.homeDirectory, ".config")
  const configHome = override?.trim() ? override : xdg?.trim() ? xdg : platformHome
  return join(configHome, "agent-trajectory-marketplace", "auth.json")
}

const checkedPath = (options: AuthStoreOptions): string => {
  const path = options.storePath ?? authStorePath()
  if (!isAbsolute(path) || path.includes("\0")) throw new AuthStoreError("unsafe_auth_store_path")
  return path
}

const emptyStore = (): AuthStore => ({ schemaVersion: 1, sessions: [] })

const readStore = (path: string): AuthStore => {
  try {
    const contents = readAuthStoreFile(path)
    if (contents === undefined) return emptyStore()
    return authStoreSchema.parse(JSON.parse(contents))
  } catch (error) {
    if (error instanceof AuthStoreError) throw error
    throw new AuthStoreError("invalid_auth_store")
  }
}

const ensureStoreDirectory = (path: string): Stats => {
  assertSafeExistingAuthStorePath(path)
  const directory = dirname(path)
  try {
    mkdirSync(directory, { mode: 0o700, recursive: true })
    chmodSync(directory, 0o700)
  } catch (error) {
    if (error instanceof AuthStoreError) throw error
    throw new AuthStoreError("unsafe_auth_store_path")
  }
  assertSafeExistingAuthStorePath(path)
  const status = lstatSync(directory)
  if (!status.isDirectory() || status.isSymbolicLink()) throw new AuthStoreError("unsafe_auth_store_path")
  return status
}

const writeStore = (path: string, store: AuthStore, operations: AuthStoreOperations): void => {
  const directoryIdentity = ensureStoreDirectory(path)
  const bytes = Buffer.from(`${JSON.stringify(store, null, 2)}\n`)
  const temporaryPath = `${path}.trajectory-tmp-${operations.temporaryId()}`
  let ownsTemporary = false
  let temporaryIdentity: Stats | undefined
  let failure: AuthStoreError | undefined
  try {
    let descriptor: number
    try {
      descriptor = operations.openExclusive(temporaryPath)
      ownsTemporary = true
      temporaryIdentity = operations.fstat(descriptor)
      if (!temporaryIdentity.isFile() || (typeof process.getuid === "function" && temporaryIdentity.uid !== process.getuid())) throw new AuthStoreError("unsafe_auth_store_path")
    } catch (error) {
      if (error instanceof AuthStoreError) throw error
      throw new AuthStoreError("unsafe_auth_store_path")
    }
    try {
      const directoryStatus = operations.lstat(dirname(path))
      if (!sameAuthStoreFile(directoryIdentity, directoryStatus) || directoryStatus.isSymbolicLink()) {
        throw new AuthStoreError("unsafe_auth_store_path")
      }
      operations.fchmod(descriptor, 0o600)
      let offset = 0
      while (offset < bytes.byteLength) {
        const written = operations.write(descriptor, bytes, offset)
        if (!Number.isSafeInteger(written) || written <= 0 || written > bytes.byteLength - offset) {
          throw new AuthStoreError("auth_store_write_failed")
        }
        offset += written
      }
      operations.fsync(descriptor)
    } finally {
      operations.close(descriptor)
    }
    const temporaryStatus = operations.lstat(temporaryPath)
    const directoryStatus = operations.lstat(dirname(path))
    if (!sameAuthStoreFile(temporaryIdentity, temporaryStatus) || temporaryStatus.isSymbolicLink() ||
      !sameAuthStoreFile(directoryIdentity, directoryStatus) || directoryStatus.isSymbolicLink()) {
      throw new AuthStoreError("unsafe_auth_store_path")
    }
    assertSafeExistingAuthStorePath(path)
    operations.rename(temporaryPath, path)
    ownsTemporary = false
  } catch (error) {
    failure = error instanceof AuthStoreError ? error : new AuthStoreError("auth_store_write_failed")
  }
  if (ownsTemporary && temporaryIdentity !== undefined) {
    try {
      const status = operations.lstat(temporaryPath)
      if (sameAuthStoreFile(temporaryIdentity, status) && !status.isSymbolicLink()) operations.unlink(temporaryPath)
    } catch (error) {
      const missing = error instanceof Error && "code" in error && error.code === "ENOENT"
      if (!missing && failure === undefined) failure = new AuthStoreError("auth_store_write_failed")
    }
  }
  if (failure !== undefined) throw failure
}

export function readStoredAuthSession(
  server: string,
  options: AuthStoreOptions = {},
): StoredAuthSession | undefined {
  const normalized = normalizeAuthServerUrl(server)
  return readStore(checkedPath(options)).sessions.find((session) => session.server === normalized)
}

export function writeStoredAuthSession(
  input: StoredAuthSessionInput,
  options: AuthStoreOptions = {},
): void {
  const path = checkedPath(options)
  const normalized = normalizeAuthServerUrl(input.server)
  const parsed = storedAuthSessionSchema.safeParse({ ...input, server: normalized })
  if (!parsed.success) throw new AuthStoreError("invalid_auth_store")
  const stored = parsed.data
  const store = readStore(path)
  writeStore(path, {
    schemaVersion: 1,
    sessions: [...store.sessions.filter((session) => session.server !== normalized), stored],
  }, options.operations ?? nodeAuthStoreOperations)
}

export function removeStoredAuthSession(server: string, options: AuthStoreOptions = {}): void {
  const path = checkedPath(options)
  const normalized = normalizeAuthServerUrl(server)
  const store = readStore(path)
  writeStore(path, {
    schemaVersion: 1,
    sessions: store.sessions.filter((session) => session.server !== normalized),
  }, options.operations ?? nodeAuthStoreOperations)
}

export function storedAuthSessionStatus(
  session: StoredAuthSessionInput,
  now = new Date(),
): "active" | "expired" {
  return Date.parse(session.expiresAt) > now.getTime() ? "active" : "expired"
}
