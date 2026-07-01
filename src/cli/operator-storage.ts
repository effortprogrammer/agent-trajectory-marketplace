import type { Command } from "commander"

import { createRegistryDatabase } from "../registry/database"
import {
  createRegistryStorage,
  type RegistryStorageBackend,
  registryStorageBackendValues,
} from "../registry/storage"
import { restoreRegistryStorage } from "../registry/storage-backup"

type OperatorStorageOptions = Readonly<{
  db: string
  storage: string
  storageBackend?: string
}>

type OperatorListingOptions = OperatorStorageOptions & Readonly<{ listingId: string }>

type OperatorRestoreOptions = OperatorStorageOptions & Readonly<{ backup: string }>

const printJson = (value: unknown) => {
  console.log(JSON.stringify(value, null, 2))
}

const parseStorageBackend = (value: string | undefined): RegistryStorageBackend => {
  if (value === undefined || value.trim().length === 0) {
    return "local"
  }
  const backend = registryStorageBackendValues.find((candidate) => candidate === value)
  if (backend === undefined) {
    throw new Error("invalid_request: --storage-backend must be local or hosted")
  }
  return backend
}

const openOperatorStorage = (options: OperatorStorageOptions) => {
  const database = createRegistryDatabase({ dbPath: options.db })
  return {
    database,
    storage: createRegistryStorage({
      backend: parseStorageBackend(options.storageBackend),
      database,
      storageRoot: options.storage,
    }),
  }
}

export const registerOperatorStorageCommands = (operatorCommand: Command) => {
  operatorCommand
    .command("listing")
    .description("Look up one registry listing from local staging storage")
    .requiredOption("--db <path>", "Registry SQLite database path")
    .requiredOption("--storage <path>", "Registry package storage root")
    .option("--storage-backend <backend>", "Registry storage backend: local or hosted", "local")
    .requiredOption("--listing-id <id>", "Listing id")
    .action((options: OperatorListingOptions) => {
      const opened = openOperatorStorage(options)
      try {
        const listing = opened.storage
          .listListings()
          .find((candidate) => candidate.listingId === options.listingId)
        if (listing === undefined) {
          throw new Error(`listing_not_found: ${options.listingId}`)
        }
        printJson({ ok: true, listing })
      } finally {
        opened.database.close()
      }
    })

  const storageCommand = operatorCommand.command("storage").description("Verify storage recovery")
  storageCommand
    .command("restore-verify")
    .description("Restore a backup into staging storage and verify hashes during restore")
    .requiredOption("--backup <path>", "Backup directory created by trajectory registry backup")
    .requiredOption("--db <path>", "Registry SQLite database path")
    .requiredOption("--storage <path>", "Registry package storage root")
    .option("--storage-backend <backend>", "Registry storage backend: local or hosted", "local")
    .action((options: OperatorRestoreOptions) => {
      const opened = openOperatorStorage(options)
      try {
        printJson({
          ok: true,
          verified: true,
          ...restoreRegistryStorage({
            backupDir: options.backup,
            storage: opened.storage,
          }),
        })
      } finally {
        opened.database.close()
      }
    })
}
