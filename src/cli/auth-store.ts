import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { z } from "zod"

import { normalizeRegistryBaseUrl } from "../registry/client-transport"

const storedRegistrySessionSchema = z
  .object({
    registryUrl: z.string().min(1),
    accessToken: z.string().min(1),
    tokenType: z.literal("Bearer"),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict()

const authStoreSchema = z
  .object({
    schemaVersion: z.literal(1),
    sessions: z.array(storedRegistrySessionSchema),
  })
  .strict()

type StoredRegistrySession = z.infer<typeof storedRegistrySessionSchema>
type AuthStore = z.infer<typeof authStoreSchema>

const emptyStore = (): AuthStore => ({ schemaVersion: 1, sessions: [] })

const configHome = (): string => {
  // biome-ignore lint/complexity/useLiteralKeys: ProcessEnv is index-signature typed under noPropertyAccessFromIndexSignature.
  const override = process.env["TRAJECTORY_MARKETPLACE_CONFIG_HOME"]
  if (override !== undefined && override.trim().length > 0) {
    return override
  }
  // biome-ignore lint/complexity/useLiteralKeys: ProcessEnv is index-signature typed under noPropertyAccessFromIndexSignature.
  const xdgConfigHome = process.env["XDG_CONFIG_HOME"]
  if (xdgConfigHome !== undefined && xdgConfigHome.trim().length > 0) {
    return xdgConfigHome
  }
  return join(homedir(), ".config")
}

export const registryAuthStorePath = (): string =>
  join(configHome(), "agent-trajectory-marketplace", "auth.json")

const readStore = (): AuthStore => {
  const path = registryAuthStorePath()
  if (!existsSync(path)) {
    return emptyStore()
  }
  try {
    return authStoreSchema.parse(JSON.parse(readFileSync(path, "utf8")))
  } catch (caught: unknown) {
    if (caught instanceof Error) {
      return emptyStore()
    }
    return emptyStore()
  }
}

const writeStore = (store: AuthStore): void => {
  const path = registryAuthStorePath()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmpPath = `${path}.${process.pid}.tmp`
  writeFileSync(tmpPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmpPath, path)
  chmodSync(path, 0o600)
}

const sessionForRegistry = (
  store: AuthStore,
  registryUrl: string,
): StoredRegistrySession | undefined => {
  const normalized = normalizeRegistryBaseUrl(registryUrl)
  return store.sessions.find((session) => session.registryUrl === normalized)
}

export const readStoredRegistrySession = (registryUrl: string): StoredRegistrySession | undefined =>
  sessionForRegistry(readStore(), registryUrl)

export const writeStoredRegistrySession = (input: {
  readonly accessToken: string
  readonly expiresAt: string
  readonly registryUrl: string
  readonly tokenType: "Bearer"
}): void => {
  const normalized = normalizeRegistryBaseUrl(input.registryUrl)
  const store = readStore()
  writeStore({
    schemaVersion: 1,
    sessions: [
      ...store.sessions.filter((session) => session.registryUrl !== normalized),
      {
        accessToken: input.accessToken,
        expiresAt: input.expiresAt,
        registryUrl: normalized,
        tokenType: input.tokenType,
      },
    ],
  })
}

export const removeStoredRegistrySession = (registryUrl: string): void => {
  const normalized = normalizeRegistryBaseUrl(registryUrl)
  const store = readStore()
  writeStore({
    schemaVersion: 1,
    sessions: store.sessions.filter((session) => session.registryUrl !== normalized),
  })
}
