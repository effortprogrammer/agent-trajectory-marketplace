import type { Command } from "commander"

import { createRegistryDatabase } from "../registry/database"
import { parseRegistryServeConfig, runRegistryServerProcess } from "../registry/server"
import { createRegistryStorage, type RegistryStorageBackend } from "../registry/storage"
import { backupRegistryStorage, restoreRegistryStorage } from "../registry/storage-backup"

type RegistryServeOptions = Readonly<{
  db: string
  host: string
  port: string
  sellerKey: readonly string[]
  storage: string
  storageBackend?: string
  tmp: string
}>

type RegistryBackupOptions = Readonly<{
  db: string
  out: string
  storage: string
  storageBackend?: string
}>

type RegistryRestoreOptions = Readonly<{
  backup: string
  db: string
  storage: string
  storageBackend?: string
}>

const printJson = (value: unknown) => {
  console.log(JSON.stringify(value, null, 2))
}

const collectSellerKey = (value: string, previous: readonly string[]) => [...previous, value]

const parseRegistryStorageBackendOption = (value: string | undefined): RegistryStorageBackend =>
  parseRegistryServeConfig({
    host: "127.0.0.1",
    port: 0,
    db: ".",
    storage: ".",
    tmp: ".",
    sellerKey: "agent-local:unused",
    ...(value === undefined ? {} : { storageBackend: value }),
  }).storageBackend

const openRegistryStorage = (options: {
  readonly db: string
  readonly storage: string
  readonly storageBackend?: string
}) => {
  const database = createRegistryDatabase({ dbPath: options.db })
  return {
    database,
    storage: createRegistryStorage({
      backend: parseRegistryStorageBackendOption(options.storageBackend),
      database,
      storageRoot: options.storage,
    }),
  }
}

export const registerRegistryCommand = (trajectoryCommand: Command) => {
  const registryCommand = trajectoryCommand
    .command("registry")
    .description("Run and inspect the marketplace registry")

  registryCommand
    .command("serve")
    .description("Run the local marketplace registry server")
    .requiredOption("--host <host>", "Registry bind host")
    .requiredOption("--port <port>", "Registry bind port; use 0 for a random port")
    .requiredOption("--db <path>", "Registry SQLite database path")
    .requiredOption("--storage <path>", "Registry package storage root")
    .option("--storage-backend <backend>", "Registry storage backend: local or hosted", "local")
    .requiredOption("--tmp <path>", "Registry temporary upload root")
    .option("--seller-key <sellerId:key>", "Seller API key mapping", collectSellerKey, [])
    .action(async (options: RegistryServeOptions) => {
      await runRegistryServerProcess(
        parseRegistryServeConfig({
          host: options.host,
          port: options.port,
          db: options.db,
          storage: options.storage,
          tmp: options.tmp,
          sellerKey: options.sellerKey,
          ...(options.storageBackend === undefined
            ? {}
            : { storageBackend: options.storageBackend }),
        }),
      )
    })

  registryCommand
    .command("backup")
    .description("Back up registry listing metadata and allowlisted package files")
    .requiredOption("--db <path>", "Registry SQLite database path")
    .requiredOption("--storage <path>", "Registry package storage root")
    .option("--storage-backend <backend>", "Registry storage backend: local or hosted", "local")
    .requiredOption("--out <path>", "Backup output directory")
    .action((options: RegistryBackupOptions) => {
      const opened = openRegistryStorage(options)
      try {
        printJson(backupRegistryStorage({ outDir: options.out, storage: opened.storage }))
      } finally {
        opened.database.close()
      }
    })

  registryCommand
    .command("restore")
    .description("Restore registry listing metadata and allowlisted package files")
    .requiredOption("--backup <path>", "Backup directory created by trajectory registry backup")
    .requiredOption("--db <path>", "Registry SQLite database path")
    .requiredOption("--storage <path>", "Registry package storage root")
    .option("--storage-backend <backend>", "Registry storage backend: local or hosted", "local")
    .action((options: RegistryRestoreOptions) => {
      const opened = openRegistryStorage(options)
      try {
        printJson(restoreRegistryStorage({ backupDir: options.backup, storage: opened.storage }))
      } finally {
        opened.database.close()
      }
    })
}
