import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import { AuthStoreError, authStorePath, nodeAuthStoreOperations, readStoredAuthSession, removeStoredAuthSession, storedAuthSessionStatus, writeStoredAuthSession } from "../../../src/auth/store"
import type { AuthStoreOperations } from "../../../src/auth/store"
import { nodeAuthStoreReadOperations, readAuthStoreFile } from "../../../src/auth/store-security"
import type { AuthStoreReadOperations } from "../../../src/auth/store-security"

const roots: string[] = []
const tokenOne = "store-secret-one"
const tokenTwo = "store-secret-two"
const accountOne = "acct-0123456789abcdef"
const accountTwo = "acct-fedcba9876543210"
const expiresLater = "2026-07-25T00:00:00.000Z"

const fixtureRoot = (prefix: string): string => {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

const session = (server: string, accessToken = tokenOne, accountId = accountOne) => ({
  accessToken,
  accountId,
  expiresAt: expiresLater,
  server,
  tokenType: "Bearer" as const,
})

const residue = (directory: string): readonly string[] =>
  readdirSync(directory).filter((name) => name.includes(".trajectory-tmp-"))

const storeErrorCode = (action: () => unknown): string => {
  try {
    action()
    return "none"
  } catch (error) {
    if (error instanceof AuthStoreError) return error.code
    throw error
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe("atomic access-token store", () => {
  test("resolves config precedence and platform defaults", () => {
    expect(authStorePath({ environment: { TRAJECTORY_MARKETPLACE_CONFIG_HOME: "/override", XDG_CONFIG_HOME: "/xdg" }, homeDirectory: "/home/user", platform: "linux" })).toBe("/override/agent-trajectory-marketplace/auth.json")
    expect(authStorePath({ environment: { XDG_CONFIG_HOME: "/xdg" }, homeDirectory: "/home/user", platform: "linux" })).toBe("/xdg/agent-trajectory-marketplace/auth.json")
    expect(authStorePath({ environment: {}, homeDirectory: "/home/user", platform: "darwin" })).toBe("/home/user/Library/Application Support/agent-trajectory-marketplace/auth.json")
    expect(authStorePath({ environment: {}, homeDirectory: "/home/user", platform: "linux" })).toBe("/home/user/.config/agent-trajectory-marketplace/auth.json")
    expect(authStorePath({ environment: { APPDATA: "/appdata" }, homeDirectory: "/home/user", platform: "win32" })).toBe("/appdata/agent-trajectory-marketplace/auth.json")
  })

  test("creates, updates, removes, and classifies normalized server sessions with private modes", () => {
    const root = fixtureRoot("trajectory-auth-store-")
    const storePath = join(root, "config", "agent-trajectory-marketplace", "auth.json")
    const firstServer = "HTTPS://AUTH.EXAMPLE.TEST:443/"
    const secondServer = "https://second.example.test"

    writeStoredAuthSession(session(firstServer), { storePath })
    writeStoredAuthSession(session(secondServer, tokenTwo, accountTwo), { storePath })
    writeStoredAuthSession(session("https://auth.example.test", tokenTwo), { storePath })

    const storedFirst = readStoredAuthSession(firstServer, { storePath })
    const storedSecond = readStoredAuthSession(secondServer, { storePath })
    expect([String(storedFirst?.server), String(storedFirst?.accessToken), String(storedFirst?.accountId)]).toEqual(["https://auth.example.test", tokenTwo, accountOne])
    expect([String(storedSecond?.server), String(storedSecond?.accessToken), String(storedSecond?.accountId)]).toEqual([secondServer, tokenTwo, accountTwo])
    expect(storedAuthSessionStatus(session(firstServer), new Date("2026-07-24T00:00:00.000Z"))).toBe("active")
    expect(storedAuthSessionStatus(session(firstServer), new Date(expiresLater))).toBe("expired")
    expect(lstatSync(join(root, "config", "agent-trajectory-marketplace")).mode & 0o777).toBe(0o700)
    expect(lstatSync(storePath).mode & 0o777).toBe(0o600)

    removeStoredAuthSession(firstServer, { storePath })
    expect(readStoredAuthSession(firstServer, { storePath })).toBeUndefined()
    expect(String(readStoredAuthSession(secondServer, { storePath })?.accountId)).toBe(accountTwo)
  })

  test("rejects malformed, duplicate, and non-normalized stored records without resetting state", () => {
    const cases = [
      "{not-json",
      JSON.stringify({ schemaVersion: 2, sessions: [] }),
      JSON.stringify({ schemaVersion: 1, sessions: [session("https://auth.example.test"), session("https://auth.example.test", tokenTwo)] }),
      JSON.stringify({ schemaVersion: 1, sessions: [session("HTTPS://AUTH.EXAMPLE.TEST/")] }),
    ]

    for (const [index, contents] of cases.entries()) {
      const root = fixtureRoot(`trajectory-auth-malformed-${index}-`)
      const storePath = join(root, "agent-trajectory-marketplace", "auth.json")
      mkdirSync(join(root, "agent-trajectory-marketplace"), { mode: 0o700 })
      writeFileSync(storePath, contents, { mode: 0o600 })
      const before = readFileSync(storePath)
      expect(() => readStoredAuthSession("https://auth.example.test", { storePath })).toThrow(new AuthStoreError("invalid_auth_store"))
      expect(() => writeStoredAuthSession(session("https://new.example.test"), { storePath })).toThrow(new AuthStoreError("invalid_auth_store"))
      expect(readFileSync(storePath)).toEqual(before)
    }
  })

  test("rejects symlinked config roots, store directories, store files, and reserved temp paths", () => {
    const outside = fixtureRoot("trajectory-auth-outside-")
    const root = fixtureRoot("trajectory-auth-links-")
    const linkedRoot = join(root, "linked-config")
    symlinkSync(outside, linkedRoot, "dir")
    expect(() => writeStoredAuthSession(session("https://auth.example.test"), { storePath: join(linkedRoot, "agent-trajectory-marketplace", "auth.json") })).toThrow(new AuthStoreError("unsafe_auth_store_path"))

    const directoryLinkRoot = fixtureRoot("trajectory-auth-dir-link-")
    const linkedDirectory = join(directoryLinkRoot, "agent-trajectory-marketplace")
    symlinkSync(outside, linkedDirectory, "dir")
    expect(() => writeStoredAuthSession(session("https://auth.example.test"), { storePath: join(linkedDirectory, "auth.json") })).toThrow(new AuthStoreError("unsafe_auth_store_path"))

    const fileRoot = fixtureRoot("trajectory-auth-file-link-")
    const fileDirectory = join(fileRoot, "agent-trajectory-marketplace")
    const sentinel = join(outside, "sentinel")
    mkdirSync(fileDirectory, { mode: 0o700 })
    writeFileSync(sentinel, "outside")
    symlinkSync(sentinel, join(fileDirectory, "auth.json"))
    expect(() => writeStoredAuthSession(session("https://auth.example.test"), { storePath: join(fileDirectory, "auth.json") })).toThrow(new AuthStoreError("unsafe_auth_store_path"))
    expect(readFileSync(sentinel, "utf8")).toBe("outside")

    const tempRoot = fixtureRoot("trajectory-auth-temp-link-")
    const tempDirectory = join(tempRoot, "agent-trajectory-marketplace")
    const storePath = join(tempDirectory, "auth.json")
    mkdirSync(tempDirectory, { mode: 0o700 })
    const reserved = `${storePath}.trajectory-tmp-fixed`
    symlinkSync(sentinel, reserved)
    const operations: AuthStoreOperations = { ...nodeAuthStoreOperations, temporaryId: (): string => "fixed" }
    expect(() => writeStoredAuthSession(session("https://auth.example.test"), { operations, storePath })).toThrow(new AuthStoreError("unsafe_auth_store_path"))
    expect(lstatSync(reserved).isSymbolicLink()).toBe(true)
  })

  test("preserves the existing store and cleans only owned temporary files across interruptions", () => {
    const stages = ["write", "fsync", "close", "rename"] as const
    for (const stage of stages) {
      const root = fixtureRoot(`trajectory-auth-${stage}-`)
      const storePath = join(root, "agent-trajectory-marketplace", "auth.json")
      writeStoredAuthSession(session("https://auth.example.test"), { storePath })
      const before = readFileSync(storePath)
      const foreign = join(root, "agent-trajectory-marketplace", "foreign.trajectory-tmp-keep")
      writeFileSync(foreign, "keep")
      const operations: AuthStoreOperations = {
        ...nodeAuthStoreOperations,
        close: stage === "close" ? (descriptor): void => { closeSync(descriptor); throw new AuthStoreError("auth_store_write_failed") } : nodeAuthStoreOperations.close,
        fsync: stage === "fsync" ? (): void => { throw new AuthStoreError("auth_store_write_failed") } : nodeAuthStoreOperations.fsync,
        rename: stage === "rename" ? (): void => { throw new AuthStoreError("auth_store_write_failed") } : nodeAuthStoreOperations.rename,
        write: stage === "write" ? (): number => { throw new AuthStoreError("auth_store_write_failed") } : nodeAuthStoreOperations.write,
      }
      expect(() => writeStoredAuthSession(session("https://auth.example.test", tokenTwo), { operations, storePath })).toThrow(new AuthStoreError("auth_store_write_failed"))
      expect(readFileSync(storePath)).toEqual(before)
      expect(residue(join(root, "agent-trajectory-marketplace"))).toEqual(["foreign.trajectory-tmp-keep"])
    }
  })

  test("rejects temp identity replacement and never unlinks the foreign replacement", () => {
    const root = fixtureRoot("trajectory-auth-identity-")
    const directory = join(root, "agent-trajectory-marketplace")
    const storePath = join(directory, "auth.json")
    writeStoredAuthSession(session("https://auth.example.test"), { storePath })
    const before = readFileSync(storePath)
    let temporaryPath: string | undefined
    const operations: AuthStoreOperations = {
      ...nodeAuthStoreOperations,
      openExclusive: (path): number => {
        temporaryPath = path
        return nodeAuthStoreOperations.openExclusive(path)
      },
      close: (descriptor): void => {
        nodeAuthStoreOperations.close(descriptor)
        if (temporaryPath === undefined) throw new AuthStoreError("auth_store_write_failed")
        rmSync(temporaryPath)
        writeFileSync(temporaryPath, "foreign", { mode: 0o600 })
      },
    }
    expect(() => writeStoredAuthSession(session("https://auth.example.test", tokenTwo), { operations, storePath })).toThrow(new AuthStoreError("unsafe_auth_store_path"))
    expect(readFileSync(storePath)).toEqual(before)
    expect(readFileSync(String(temporaryPath), "utf8")).toBe("foreign")
  })

  test("rejects a group-or-world-writable config root before creating a store directory", () => {
    const root = fixtureRoot("trajectory-auth-writable-root-")
    chmodSync(root, 0o777)
    expect(() => writeStoredAuthSession(session("https://auth.example.test"), { storePath: join(root, "agent-trajectory-marketplace", "auth.json") })).toThrow(new AuthStoreError("unsafe_auth_store_path"))
  })

  test("rejects a private config root beneath an attacker-writable ancestor", () => {
    const root = fixtureRoot("trajectory-auth-writable-ancestor-")
    const writableParent = join(root, "shared")
    const configRoot = join(writableParent, "private-config")
    mkdirSync(configRoot, { recursive: true, mode: 0o700 })
    chmodSync(writableParent, 0o777)
    expect(() => writeStoredAuthSession(session("https://auth.example.test"), { storePath: join(configRoot, "agent-trajectory-marketplace", "auth.json") })).toThrow(new AuthStoreError("unsafe_auth_store_path"))
  })

  test("rejects a missing config root beneath an attacker-writable ancestor", () => {
    const root = fixtureRoot("trajectory-auth-missing-under-writable-")
    const writableParent = join(root, "shared")
    mkdirSync(writableParent)
    chmodSync(writableParent, 0o777)
    const configRoot = join(writableParent, "missing-config")
    expect(() => writeStoredAuthSession(session("https://auth.example.test"), { storePath: join(configRoot, "agent-trajectory-marketplace", "auth.json") })).toThrow(new AuthStoreError("unsafe_auth_store_path"))
    expect(existsSync(configRoot)).toBe(false)
  })

  test("rejects an intermediate user-owned symlink before canonical ancestor validation", () => {
    const outside = fixtureRoot("trajectory-auth-alias-target-")
    const root = fixtureRoot("trajectory-auth-alias-parent-")
    const alias = join(root, "alias")
    symlinkSync(outside, alias, "dir")
    expect(() => writeStoredAuthSession(session("https://auth.example.test"), { storePath: join(alias, "private-config", "agent-trajectory-marketplace", "auth.json") })).toThrow(new AuthStoreError("unsafe_auth_store_path"))
  })

  test("preserves the primary typed failure when owned-temp cleanup itself fails", () => {
    const root = fixtureRoot("trajectory-auth-cleanup-failure-")
    const storePath = join(root, "agent-trajectory-marketplace", "auth.json")
    const operations: AuthStoreOperations = {
      ...nodeAuthStoreOperations,
      unlink: (): void => { throw new Error("cleanup seam") },
      write: (): number => { throw new AuthStoreError("auth_store_write_failed") },
    }
    expect(() => writeStoredAuthSession(session("https://auth.example.test"), { operations, storePath })).toThrow(new AuthStoreError("auth_store_write_failed"))
  })

  test("rejects existing stores with group or world permission bits without changing them", () => {
    for (const mode of [0o640, 0o644, 0o660]) {
      const root = fixtureRoot(`trajectory-auth-file-mode-${mode.toString(8)}-`)
      const storePath = join(root, "agent-trajectory-marketplace", "auth.json")
      writeStoredAuthSession(session("https://auth.example.test"), { storePath })
      chmodSync(storePath, mode)
      const before = readFileSync(storePath)
      expect(storeErrorCode(() => readStoredAuthSession("https://auth.example.test", { storePath }))).toBe("unsafe_auth_store_path")
      expect([readFileSync(storePath).equals(before), lstatSync(storePath).mode & 0o777]).toEqual([true, mode])
    }
  })

  test("rejects non-regular, foreign-owner, and replaced descriptor identities before reading", () => {
    const root = fixtureRoot("trajectory-auth-read-identity-")
    const directory = join(root, "agent-trajectory-marketplace")
    const storePath = join(directory, "auth.json")
    const replacement = join(directory, "replacement")
    writeStoredAuthSession(session("https://auth.example.test"), { storePath })
    writeFileSync(replacement, "replacement", { mode: 0o600 })
    const status = lstatSync(storePath)
    const variants: readonly AuthStoreReadOperations[] = [
      { ...nodeAuthStoreReadOperations, fstat: () => lstatSync(directory) },
      { ...nodeAuthStoreReadOperations, currentUserId: () => status.uid + 1 },
      { ...nodeAuthStoreReadOperations, lstat: () => lstatSync(replacement) },
    ]
    for (const variant of variants) {
      let closeCalls = 0
      let readCalls = 0
      const operations: AuthStoreReadOperations = {
        ...variant,
        close: (descriptor): void => { closeCalls += 1; variant.close(descriptor) },
        read: (descriptor): string => { readCalls += 1; return variant.read(descriptor) },
      }
      expect(storeErrorCode(() => readAuthStoreFile(storePath, operations))).toBe("unsafe_auth_store_path")
      expect([closeCalls, readCalls]).toEqual([1, 0])
    }
  })

  test("hardens pre-existing directory permissions before storing", () => {
    const root = fixtureRoot("trajectory-auth-mode-")
    const directory = join(root, "agent-trajectory-marketplace")
    const storePath = join(directory, "auth.json")
    mkdirSync(directory, { mode: 0o755 })
    chmodSync(directory, 0o755)
    writeStoredAuthSession(session("https://auth.example.test"), { storePath })
    expect(lstatSync(directory).mode & 0o777).toBe(0o700)
  })
})
