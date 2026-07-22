import type { Command } from "commander"
import { join } from "node:path"

import { createRegistryDatabase } from "../registry/database"
import { EmailAuthRateLimiter } from "../registry/email-auth"
import { createRegistryAccountMailer } from "../registry/email-delivery"
import { createRegistryLogger } from "../registry/logger"
import { parseRegistryEmailAuthEnvConfig } from "../registry/email-delivery"
import { readRegistryOperatorState } from "../registry/operator"
import { rebuildRawPackages } from "../registry/raw-package-rebuild"
import {
  parseHostedRegistryServeEnvConfig,
  parseRegistryEscrowEnvConfig,
  parseRegistryEscrowS3EnvConfig,
  parseRegistryLoggingEnvConfig,
  parseRegistryServeConfig,
  runRegistryServerProcess,
} from "../registry/server"
import { createRegistryStorage, type RegistryStorageBackend } from "../registry/storage"
import { backupRegistryStorage, restoreRegistryStorage } from "../registry/storage-backup"
import { AuthAttemptRateLimiter } from "../registry/server-account-auth"
import { FailedAttemptRateLimiter } from "../registry/server-config"
import type { RegistryRuntime } from "../registry/server-runtime"
import { createRegistryTelemetry } from "../registry/telemetry"
import { registerOperatorCommand } from "./operator"

type RegistryServeOptions = Readonly<{
  accessRecords?: string
  auditLog?: string
  db?: string
  host?: string
  hosted?: boolean
  port?: string
  sellerKey: readonly string[]
  operatorKey: readonly string[]
  storage?: string
  storageBackend?: string
  tmp?: string
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

type RegistryRawPackageRebuildOptions = Readonly<{
  db: string
  storage: string
  storageBackend?: string
  tmp?: string
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

const openRegistryRuntime = (options: RegistryRawPackageRebuildOptions): RegistryRuntime => {
  const localEscrow = parseRegistryEscrowEnvConfig(process.env, false)
  const config = parseRegistryServeConfig({
    emailAuth: parseRegistryEmailAuthEnvConfig(process.env, "local"),
    host: "127.0.0.1",
    port: 0,
    db: options.db,
    storage: options.storage,
    tmp: options.tmp ?? join(options.storage, "raw-package-rebuild-tmp"),
    sellerKey: "operator-rebuild:local",
    ...(options.storageBackend === undefined ? {} : { storageBackend: options.storageBackend }),
    ...(localEscrow === undefined ? {} : { escrow: localEscrow }),
  })
  const database = createRegistryDatabase({ dbPath: config.dbPath })
  return {
    authRateLimiter: new AuthAttemptRateLimiter(),
    config,
    database,
    emailAuthRateLimiter: new EmailAuthRateLimiter(),
    logger: createRegistryLogger({
      level: "error",
      format: "text",
      stdout: false,
      rotation: { maxSizeBytes: 1024, maxBackups: 1 },
    }),
    mailer: createRegistryAccountMailer(config.emailAuth),
    rateLimiter: new FailedAttemptRateLimiter(),
    storage: createRegistryStorage({
      backend: config.storageBackend,
      database,
      storageRoot: config.storageRoot,
      ...(config.escrowS3 === undefined ? {} : { escrowS3: config.escrowS3 }),
    }),
    telemetry: createRegistryTelemetry(),
  }
}

const accessRecordsFromOption = (path: string | undefined) =>
  path === undefined ? undefined : readRegistryOperatorState(path).records

const accessRecordsLoaderFromOption = (path: string | undefined) =>
  path === undefined ? undefined : () => readRegistryOperatorState(path).records

export const registerRegistryCommand = (trajectoryCommand: Command) => {
  const registryCommand = trajectoryCommand
    .command("registry")
    .description("Run and inspect the marketplace registry")

  registryCommand
    .command("serve")
    .description("Run the local marketplace registry server")
    .option("--host <host>", "Registry bind host")
    .option("--port <port>", "Registry bind port; use 0 for a random port")
    .option("--db <path>", "Registry SQLite database path")
    .option("--storage <path>", "Registry package storage root")
    .option("--storage-backend <backend>", "Registry storage backend: local or hosted", "local")
    .option("--tmp <path>", "Registry temporary upload root")
    .option("--audit-log <path>", "Append structured registry audit events to an NDJSON file")
    .option("--hosted", "Load hosted registry config from REGISTRY_* environment variables")
    .option("--access-records <path>", "Closed-alpha operator access state JSON path")
    .option("--seller-key <sellerId:key>", "Seller API key mapping", collectSellerKey, [])
    .option(
      "--operator-key <operatorId:key>",
      "Operator API key mapping for operator-only surfaces",
      collectSellerKey,
      [],
    )
    .action(async (options: RegistryServeOptions) => {
      if (options.hosted === true) {
        await runRegistryServerProcess(parseHostedRegistryServeEnvConfig(process.env))
        return
      }
      const accessRecords = accessRecordsFromOption(options.accessRecords)
      const accessRecordsLoader = accessRecordsLoaderFromOption(options.accessRecords)
      // Local serve: an absent master key falls back to the local/test default.
      const localEscrow = parseRegistryEscrowEnvConfig(process.env, false)
      const localEscrowS3 = parseRegistryEscrowS3EnvConfig(process.env)
      const localLogging = parseRegistryLoggingEnvConfig(process.env)
      await runRegistryServerProcess(
        parseRegistryServeConfig({
          emailAuth: parseRegistryEmailAuthEnvConfig(process.env, "local"),
          logging: localLogging.logging,
          ...(localLogging.metricsToken === undefined
            ? {}
            : { metricsToken: localLogging.metricsToken }),
          ...(options.host === undefined ? {} : { host: options.host }),
          ...(options.port === undefined ? {} : { port: options.port }),
          ...(options.db === undefined ? {} : { db: options.db }),
          ...(accessRecords === undefined ? {} : { accessRecords }),
          ...(accessRecordsLoader === undefined ? {} : { accessRecordsLoader }),
          ...(options.accessRecords === undefined ? {} : { operatorState: options.accessRecords }),
          ...(options.auditLog === undefined ? {} : { auditLog: options.auditLog }),
          ...(options.storage === undefined ? {} : { storage: options.storage }),
          ...(options.tmp === undefined ? {} : { tmp: options.tmp }),
          sellerKey: options.sellerKey,
          operatorKey: options.operatorKey,
          ...(options.storageBackend === undefined
            ? {}
            : { storageBackend: options.storageBackend }),
          ...(localEscrow === undefined ? {} : { escrow: localEscrow }),
          ...(localEscrowS3 === undefined ? {} : { escrowS3: localEscrowS3 }),
        }),
      )
    })

  registerOperatorCommand(registryCommand)

  registryCommand
    .command("rebuild-raw-packages")
    .description("Operator rebuild of Marketplace raw packages from durable private custody")
    .requiredOption("--db <path>", "Registry SQLite database path")
    .requiredOption("--storage <path>", "Registry package storage root")
    .option("--storage-backend <backend>", "Registry storage backend: local or hosted", "local")
    .option("--tmp <path>", "Registry temporary upload root")
    .action(async (options: RegistryRawPackageRebuildOptions) => {
      const runtime = openRegistryRuntime(options)
      try {
        printJson(await rebuildRawPackages({ now: () => new Date().toISOString(), runtime }))
      } finally {
        runtime.database.close()
      }
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
