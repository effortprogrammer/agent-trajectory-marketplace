import { Buffer } from "node:buffer"
import { readFileSync } from "node:fs"

import type { Command } from "commander"

import { createRegistryDatabase, type RegistryDatabase } from "../registry/database"
import {
  decryptEscrowArchive,
  escrowMasterKeyFromHex,
  rewrapEscrowDek,
} from "../registry/escrow-crypto"
import { validateEscrowArchive } from "../registry/escrow-intake"
import { grantOperatorEntitlement, mutateRegistryOperatorState } from "../registry/operator"
import { createRegistryStorage, type RegistryStorage } from "../registry/storage"
import {
  buildFulfillmentTransactionId,
  type SupplyDeliveryManifest,
  type SupplyValidationReport,
  supplyDeliveryManifestSchema,
  supplyValidationReportSchema,
} from "../registry/supply-contract"
import { supplyEscrowPolicy } from "../registry/supply-escrow-contract"

const printJson = (value: unknown) => {
  console.log(JSON.stringify(value, null, 2))
}

type FulfillmentDbOptions = Readonly<{
  db: string
  actor: string
  json?: boolean
}>

type FulfillmentTransactionOptions = FulfillmentDbOptions &
  Readonly<{
    state: string
    transactionId: string
  }>

const withDatabase = <T>(dbPath: string, action: (database: RegistryDatabase) => T): T => {
  const database = createRegistryDatabase({ dbPath })
  try {
    return action(database)
  } finally {
    database.close()
  }
}

// Escrow object storage is async (S3-compatible); these commands close the
// database only after the async work settles.
const withDatabaseAsync = async <T>(
  dbPath: string,
  action: (database: RegistryDatabase) => Promise<T>,
): Promise<T> => {
  const database = createRegistryDatabase({ dbPath })
  try {
    return await action(database)
  } finally {
    database.close()
  }
}

const readJsonFixture = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"))

// Escrowed supply (encrypted custody at publish) needs no seller delivery:
// the dataset was validated and stored at candidate intake, so an opened
// transaction passes through the transient delivery states as event-log
// entries and rests at fulfilled with machine-generated artifacts.
const activeSupplyEscrow = (database: RegistryDatabase, supplyId: string) => {
  const escrow = database.getSupplyEscrow(supplyId)
  return escrow === undefined || escrow.deletedAt !== undefined ? undefined : escrow
}

const escrowMasterKeyFromEnv = (name = "REGISTRY_ESCROW_MASTER_KEY"): Buffer => {
  const value = process.env[name]
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`invalid_request: ${name} is required`)
  }
  return escrowMasterKeyFromHex(value)
}

const escrowRetentionDays = (): number => {
  const { REGISTRY_ESCROW_RETENTION_DAYS: raw } = process.env
  if (raw === undefined || raw.trim().length === 0) {
    return supplyEscrowPolicy.defaultRetentionDays
  }
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("invalid_request: REGISTRY_ESCROW_RETENTION_DAYS must be a positive integer")
  }
  return parsed
}

type EscrowStorageOptions = Readonly<{ storage: string; storageBackend?: string }>

const escrowStorageFor = (
  database: RegistryDatabase,
  options: EscrowStorageOptions,
): RegistryStorage =>
  createRegistryStorage({
    backend: options.storageBackend === "hosted" ? "hosted" : "local",
    database,
    storageRoot: options.storage,
  })

// Cross-check a delivery manifest against the committed proof profile: when
// the seller committed to mustMatchProofHashes, every proof hash must appear
// among the delivered artifacts. This runs regardless of what the operator's
// validation report claims, so a "match" report cannot paper over a missing
// artifact.
const proofHashMismatches = (
  database: RegistryDatabase,
  supplyId: string,
  manifest: SupplyDeliveryManifest | undefined,
): readonly string[] => {
  const supply = database.getSupplyRecord(supplyId)
  if (supply === undefined || supply.state === "candidate" || supply.terms === undefined) {
    return []
  }
  if (!supply.terms.proofProfile.mustMatchProofHashes) {
    return []
  }
  const deliveredHashes = new Set((manifest?.artifacts ?? []).map((artifact) => artifact.sha256))
  return (supply.proof.hashes ?? [])
    .filter((proofHash) => !deliveredHashes.has(proofHash.sha256))
    .map((proofHash) => `missing delivered artifact for proof hash ${proofHash.label}`)
}

export const registerOperatorFulfillmentCommands = (operatorCommand: Command) => {
  const fulfillmentCommand = operatorCommand
    .command("fulfillment")
    .description("Drive seller-custodied fulfillment transactions after a winning commitment")

  fulfillmentCommand
    .command("open")
    .description(
      "Confirm a winning commitment and open the fulfillment transaction (starts the SLA clock)",
    )
    .requiredOption("--db <path>", "Registry SQLite database path")
    .requiredOption("--commitment-id <id>", "Committed supply commitment id")
    .requiredOption("--buyer-access-id <id>", "Winning buyer access record id")
    .requiredOption(
      "--listing-id <id>",
      "Entitlement listing id (listing-<hex16>) released at fulfillment",
    )
    .requiredOption("--actor <id>", "Operator actor id")
    .option("--manual", "Open a manual (non-auction) fulfillment for a committed record")
    .option("--json", "Print the fulfillment transaction as JSON")
    .action(
      (
        options: FulfillmentDbOptions &
          Readonly<{
            commitmentId: string
            buyerAccessId: string
            listingId: string
            manual?: boolean
          }>,
      ) => {
        withDatabase(options.db, (database) => {
          const auction = database.getSupplyAuctionSummary(options.commitmentId)
          if (auction === undefined) {
            throw new Error(`supply_not_found: ${options.commitmentId}`)
          }
          if (options.manual !== true) {
            if (auction.state !== "closed" || auction.winningBidId === undefined) {
              throw new Error(
                "supply_state_invalid: fulfillment requires a closed auction with a reserve-met winning bid (or --manual)",
              )
            }
          }
          const supply = database.getSupplyRecord(auction.supplyId)
          if (supply === undefined || supply.state !== "committed") {
            throw new Error(`supply_state_invalid: ${auction.supplyId} is not committed supply`)
          }
          // One live attempt per commitment: a stale duplicate transaction
          // could later be timed out and demote supply that was actually
          // fulfilled through its sibling.
          const openTransactionId = database.findOpenFulfillmentTransactionId(options.commitmentId)
          if (openTransactionId !== undefined) {
            throw new Error(
              `fulfillment_state_invalid: ${options.commitmentId} already has live transaction ${openTransactionId}; resolve it before opening another`,
            )
          }
          const now = new Date()
          // The delivery SLA clock starts here — at operator confirmation —
          // never from a watch/interest/request signal.
          const slaDeadline = new Date(
            now.getTime() + supply.terms.deliverySlaHours * 3_600_000,
          ).toISOString()
          const transaction = database.createFulfillmentTransaction({
            transactionId: buildFulfillmentTransactionId({
              commitmentId: options.commitmentId,
              nonce: now.toISOString(),
            }),
            commitmentId: options.commitmentId,
            supplyId: auction.supplyId,
            ...(auction.winningBidId === undefined ? {} : { winningBidId: auction.winningBidId }),
            slaDeadline,
            buyerAccessId: options.buyerAccessId,
            entitlementListingId: options.listingId,
            actorId: options.actor,
            now: now.toISOString(),
          })

          // Encrypted custody: the dataset is already escrowed and validated,
          // so the transaction rests at fulfilled immediately. The transient
          // delivery states land in the event log only, and the delivery
          // manifest / validation report are machine-generated.
          const escrow = activeSupplyEscrow(database, auction.supplyId)
          if (escrow === undefined) {
            printJson({ actor: options.actor, fulfillment: transaction })
            return
          }
          const generatedManifest: SupplyDeliveryManifest = {
            deliveredAt: escrow.uploadedAt,
            artifacts: (supply.proof.hashes ?? []).map((proofHash) => ({
              label: proofHash.label,
              sha256: proofHash.sha256,
            })),
            notes: "escrowed at publish; delivery satisfied by encrypted custody",
          }
          database.updateFulfillmentTransaction({
            actorId: options.actor,
            deliveryManifest: generatedManifest,
            detail: `escrowed dataset on record (${escrow.artifactCount} artifacts, ${escrow.byteCount} ciphertext bytes)`,
            expectedCurrentStates: ["seller_delivery_requested"],
            now: new Date().toISOString(),
            state: "delivered",
            transactionId: transaction.transactionId,
          })
          database.updateFulfillmentTransaction({
            actorId: options.actor,
            detail: "escrow validation carried from publish intake",
            expectedCurrentStates: ["delivered"],
            now: new Date().toISOString(),
            state: "validation_pending",
            transactionId: transaction.transactionId,
          })
          const fulfilled = database.updateFulfillmentTransaction({
            actorId: options.actor,
            detail: "escrowed dataset validated at publish; awaiting payment confirmation",
            expectedCurrentStates: ["validation_pending"],
            now: new Date().toISOString(),
            state: "fulfilled",
            transactionId: transaction.transactionId,
            validationReport: {
              validatedAt: escrow.uploadedAt,
              result: "match",
              notes: "auto-validated at publish intake (hash recomputation over real bytes)",
            },
          })
          printJson({
            actor: options.actor,
            fulfillment: fulfilled,
            escrow: { state: "escrowed", uploadedAt: escrow.uploadedAt },
            entitlement: "releasable",
          })
        })
      },
    )

  fulfillmentCommand
    .command("mark-delivered")
    .description("Record the seller delivery manifest for one fulfillment transaction")
    .requiredOption("--db <path>", "Registry SQLite database path")
    .requiredOption("--state <path>", "Operator access state JSON path")
    .requiredOption("--transaction-id <id>", "Fulfillment transaction id")
    .requiredOption("--delivery-manifest <path>", "Seller delivery manifest JSON")
    .requiredOption("--actor <id>", "Operator actor id")
    .option("--json", "Print the updated fulfillment transaction as JSON")
    .action((options: FulfillmentTransactionOptions & Readonly<{ deliveryManifest: string }>) => {
      const manifest = supplyDeliveryManifestSchema.parse(readJsonFixture(options.deliveryManifest))
      withDatabase(options.db, (database) => {
        const current = database.getFulfillmentTransaction(options.transactionId)
        if (current !== undefined && activeSupplyEscrow(database, current.supplyId) !== undefined) {
          throw new Error(
            "invalid_request: escrowed supply needs no manual delivery; fulfillment open records it automatically",
          )
        }
        const transaction = database.updateFulfillmentTransaction({
          actorId: options.actor,
          deliveryManifest: manifest,
          detail: `seller delivery manifest recorded (${manifest.artifacts.length} artifacts)`,
          expectedCurrentStates: ["seller_delivery_requested"],
          now: new Date().toISOString(),
          state: "delivered",
          transactionId: options.transactionId,
        })
        printJson({ actor: options.actor, fulfillment: transaction })
      })
    })

  fulfillmentCommand
    .command("validate")
    .description(
      "Validate a delivery against the committed proof profile; mismatch blocks entitlement release",
    )
    .requiredOption("--db <path>", "Registry SQLite database path")
    .requiredOption("--state <path>", "Operator access state JSON path")
    .requiredOption("--transaction-id <id>", "Fulfillment transaction id")
    .requiredOption("--validation-report <path>", "Operator validation report JSON")
    .requiredOption("--actor <id>", "Operator actor id")
    .option("--json", "Print the validation outcome as JSON")
    .action((options: FulfillmentTransactionOptions & Readonly<{ validationReport: string }>) => {
      const report: SupplyValidationReport = supplyValidationReportSchema.parse(
        readJsonFixture(options.validationReport),
      )
      withDatabase(options.db, (database) => {
        const current = database.getFulfillmentTransaction(options.transactionId)
        if (current === undefined) {
          throw new Error(`fulfillment_not_found: ${options.transactionId}`)
        }
        if (activeSupplyEscrow(database, current.supplyId) !== undefined) {
          throw new Error(
            "invalid_request: escrowed supply is auto-validated at publish; use fulfillment escrow revalidate for audits",
          )
        }
        const hashMismatches = proofHashMismatches(
          database,
          current.supplyId,
          current.deliveryManifest,
        )
        const mismatches = [...(report.mismatches ?? []), ...hashMismatches]
        const failed = report.result === "mismatch" || mismatches.length > 0
        const now = new Date().toISOString()
        const transaction = database.updateFulfillmentTransaction({
          actorId: options.actor,
          detail: failed
            ? `validation failed: ${mismatches.join("; ") || "operator reported mismatch"}`
            : "validation matched the committed proof profile",
          expectedCurrentStates: ["delivered", "validation_pending"],
          now,
          state: failed ? "validation_failed" : "fulfilled",
          transactionId: options.transactionId,
          validationReport: {
            ...report,
            result: failed ? "mismatch" : "match",
            ...(mismatches.length === 0 ? {} : { mismatches }),
          },
          ...(failed
            ? {
                disputeReason: mismatches.join("; ") || "operator validation reported a mismatch",
              }
            : {}),
        })
        // A mismatch demotes the supply record into the operator-reviewable
        // disputed state; entitlement release stays blocked.
        const supply = failed
          ? database.setSupplyRecordState({
              now,
              state: "disputed",
              stateReason: transaction.disputeReason ?? "validation mismatch",
              supplyId: transaction.supplyId,
            })
          : database.getSupplyRecord(transaction.supplyId)
        printJson({
          actor: options.actor,
          fulfillment: transaction,
          supplyState: supply?.state,
          entitlement: failed ? "blocked" : "releasable",
        })
      })
    })

  fulfillmentCommand
    .command("timeout")
    .description("Apply the missed-SLA rule: move an overdue transaction to timeout/unavailable")
    .requiredOption("--db <path>", "Registry SQLite database path")
    .requiredOption("--transaction-id <id>", "Fulfillment transaction id")
    .requiredOption("--actor <id>", "Operator actor id")
    .option(
      "--outcome <state>",
      "Configured missed-SLA rule: timed_out or unavailable",
      "timed_out",
    )
    .option("--json", "Print the updated fulfillment transaction as JSON")
    .action((options: Omit<FulfillmentTransactionOptions, "state"> & { outcome: string }) => {
      const outcome = options.outcome === "unavailable" ? "unavailable" : "timed_out"
      withDatabase(options.db, (database) => {
        const current = database.getFulfillmentTransaction(options.transactionId)
        if (current === undefined) {
          throw new Error(`fulfillment_not_found: ${options.transactionId}`)
        }
        const now = new Date().toISOString()
        if (Date.parse(now) < Date.parse(current.slaDeadline)) {
          throw new Error(
            `fulfillment_state_invalid: SLA deadline ${current.slaDeadline} has not passed`,
          )
        }
        const transaction = database.updateFulfillmentTransaction({
          actorId: options.actor,
          detail: `missed delivery SLA ${current.slaDeadline}; applied ${outcome} rule`,
          expectedCurrentStates: ["seller_delivery_requested", "delivered", "validation_pending"],
          now,
          state: outcome,
          transactionId: options.transactionId,
        })
        const supply = database.setSupplyRecordState({
          now,
          state: outcome === "timed_out" ? "failed" : "unavailable",
          stateReason: `fulfillment ${transaction.transactionId} missed its delivery SLA`,
          supplyId: transaction.supplyId,
        })
        printJson({ actor: options.actor, fulfillment: transaction, supplyState: supply.state })
      })
    })

  fulfillmentCommand
    .command("dispute")
    .description("Open an operator-reviewable dispute on one fulfillment transaction")
    .requiredOption("--db <path>", "Registry SQLite database path")
    .requiredOption("--transaction-id <id>", "Fulfillment transaction id")
    .requiredOption("--reason <text>", "Dispute reason")
    .requiredOption("--actor <id>", "Operator actor id")
    .option("--json", "Print the updated fulfillment transaction as JSON")
    .action((options: Omit<FulfillmentTransactionOptions, "state"> & { reason: string }) => {
      withDatabase(options.db, (database) => {
        const now = new Date().toISOString()
        const transaction = database.updateFulfillmentTransaction({
          actorId: options.actor,
          detail: `dispute opened: ${options.reason}`,
          disputeReason: options.reason,
          expectedCurrentStates: [
            "seller_delivery_requested",
            "delivered",
            "validation_pending",
            "validation_failed",
            "fulfilled",
          ],
          now,
          state: "disputed",
          transactionId: options.transactionId,
        })
        const supply = database.setSupplyRecordState({
          now,
          state: "disputed",
          stateReason: options.reason,
          supplyId: transaction.supplyId,
        })
        printJson({ actor: options.actor, fulfillment: transaction, supplyState: supply.state })
      })
    })

  fulfillmentCommand
    .command("release-entitlement")
    .description(
      "Release buyer access for one fulfilled transaction (idempotent by transaction id)",
    )
    .requiredOption("--db <path>", "Registry SQLite database path")
    .requiredOption("--state <path>", "Operator access state JSON path")
    .requiredOption("--transaction-id <id>", "Fulfillment transaction id")
    .requiredOption("--buyer-access-id <id>", "Approved buyer access record id")
    .requiredOption("--listing-id <id>", "Entitlement listing id (listing-<hex16>)")
    .requiredOption("--actor <id>", "Operator actor id")
    .option(
      "--payment-ref <text>",
      "Off-platform payment reference recorded with the release event",
    )
    .option("--json", "Print the release outcome as JSON")
    .action(
      (
        options: FulfillmentTransactionOptions &
          Readonly<{ buyerAccessId: string; listingId: string; paymentRef?: string }>,
      ) => {
        withDatabase(options.db, (database) => {
          const current = database.getFulfillmentTransaction(options.transactionId)
          if (current === undefined) {
            throw new Error(`fulfillment_not_found: ${options.transactionId}`)
          }
          // The transaction's recorded participants are authoritative: a
          // typo'd CLI flag must not grant access to a different buyer or
          // rewrite what the transaction recorded at open time.
          if (
            current.buyerAccessId !== undefined &&
            current.buyerAccessId !== options.buyerAccessId
          ) {
            throw new Error(
              `invalid_request: --buyer-access-id ${options.buyerAccessId} does not match the transaction's recorded buyer ${current.buyerAccessId}`,
            )
          }
          if (
            current.entitlementListingId !== undefined &&
            current.entitlementListingId !== options.listingId
          ) {
            throw new Error(
              `invalid_request: --listing-id ${options.listingId} does not match the transaction's recorded listing ${current.entitlementListingId}`,
            )
          }

          // A fully released transaction is a no-op: re-running the command
          // must never re-grant an entitlement an operator later revoked.
          if (current.state === "entitlement_released") {
            printJson({
              actor: options.actor,
              fulfillment: current,
              grantApplied: false,
              idempotent: true,
            })
            return
          }

          // Two-phase idempotent release keyed by the fulfillment transaction
          // id: SQLite marks the release pending, the operator-state file
          // grants the existing entitlement under its cross-process lock, and
          // SQLite then records the release. A crash between the phases is
          // recovered by re-running this command: the pending SQLite row is
          // found again and the JSON grant is reattempted (or skipped when the
          // entitlement already exists) without duplicating anything.
          const now = new Date().toISOString()
          if (current.state === "fulfilled") {
            database.updateFulfillmentTransaction({
              actorId: options.actor,
              buyerAccessId: options.buyerAccessId,
              detail: "entitlement release started",
              entitlementListingId: options.listingId,
              expectedCurrentStates: ["fulfilled"],
              now,
              state: "entitlement_release_pending",
              transactionId: options.transactionId,
            })
          } else if (current.state !== "entitlement_release_pending") {
            throw new Error(
              `fulfillment_state_invalid: ${options.transactionId} is ${current.state}; release requires a fulfilled transaction`,
            )
          }

          // The grant decision runs inside the operator-state lock so two
          // concurrent releases cannot both observe "not granted" and write
          // duplicate audit events.
          let grantApplied = false
          mutateRegistryOperatorState(options.state, (state) => {
            const record = state.records.find(
              (candidate) => candidate.accessId === options.buyerAccessId,
            )
            const active = (record?.entitlements ?? []).some(
              (entitlement) =>
                entitlement.listingId === options.listingId && entitlement.state === "active",
            )
            if (active) {
              return state
            }
            grantApplied = true
            return grantOperatorEntitlement(state, {
              accessId: options.buyerAccessId,
              actorId: options.actor,
              listingId: options.listingId,
            })
          })

          const releaseDetail = grantApplied
            ? "entitlement granted in operator state and release recorded"
            : "entitlement already present in operator state; release recorded idempotently"
          const released = database.updateFulfillmentTransaction({
            actorId: options.actor,
            buyerAccessId: options.buyerAccessId,
            detail:
              options.paymentRef === undefined
                ? releaseDetail
                : `${releaseDetail}; payment-ref ${options.paymentRef}`,
            entitlementListingId: options.listingId,
            expectedCurrentStates: ["entitlement_release_pending"],
            now: new Date().toISOString(),
            state: "entitlement_released",
            transactionId: options.transactionId,
          })

          // Escrowed datasets get their retention clock: the buyer's
          // re-download window starts at release, and gc deletes after it.
          let escrowDeleteAfter: string | undefined
          if (activeSupplyEscrow(database, released.supplyId) !== undefined) {
            escrowDeleteAfter = new Date(
              Date.parse(released.updatedAt) + escrowRetentionDays() * 86_400_000,
            ).toISOString()
            database.setSupplyEscrowDeleteAfter({
              supplyId: released.supplyId,
              deleteAfter: escrowDeleteAfter,
            })
          }

          printJson({
            actor: options.actor,
            fulfillment: released,
            grantApplied,
            idempotent: false,
            ...(escrowDeleteAfter === undefined ? {} : { escrowDeleteAfter }),
          })
        })
      },
    )

  const escrowCommand = fulfillmentCommand
    .command("escrow")
    .description("Operate the encrypted supply escrow: inspect, gc, revalidate, key rotation")

  escrowCommand
    .command("inspect")
    .description("Show the escrow key row and stored object for one supply record")
    .requiredOption("--db <path>", "Registry SQLite database path")
    .requiredOption("--storage <path>", "Registry storage root")
    .requiredOption("--supply-id <id>", "Supply record id")
    .option("--storage-backend <backend>", "Registry storage backend: local or hosted", "local")
    .option("--json", "Print the escrow status as JSON")
    .action(
      async (
        options: Readonly<{ db: string; supplyId: string; json?: boolean }> & EscrowStorageOptions,
      ) => {
        await withDatabaseAsync(options.db, async (database) => {
          const escrow = database.getSupplyEscrow(options.supplyId)
          if (escrow === undefined) {
            throw new Error(`supply_not_found: no escrow for ${options.supplyId}`)
          }
          const storage = escrowStorageFor(database, options)
          const { wrappedDek: _redactedDek, nonce: _nonce, tag: _tag, ...visible } = escrow
          printJson({
            escrow: visible,
            object: (await storage.statEscrowObject(options.supplyId)) ?? null,
            supplyState: database.getSupplyRecord(options.supplyId)?.state,
          })
        })
      },
    )

  escrowCommand
    .command("gc")
    .description(
      "Delete escrow objects past their retention window or behind terminal listings; disputes defer",
    )
    .requiredOption("--db <path>", "Registry SQLite database path")
    .requiredOption("--storage <path>", "Registry storage root")
    .requiredOption("--actor <id>", "Operator actor id")
    .option("--storage-backend <backend>", "Registry storage backend: local or hosted", "local")
    .option("--dry-run", "Report deletions without applying them")
    .option("--json", "Print the gc outcome as JSON")
    .action(
      async (
        options: Readonly<{ db: string; actor: string; dryRun?: boolean; json?: boolean }> &
          EscrowStorageOptions,
      ) => {
        await withDatabaseAsync(options.db, async (database) => {
          const storage = escrowStorageFor(database, options)
          const now = new Date().toISOString()
          const deleted: string[] = []
          const deferred: { supplyId: string; reason: string }[] = []
          for (const escrow of database.listSupplyEscrows()) {
            if (escrow.deletedAt !== undefined) {
              continue
            }
            const supply = database.getSupplyRecord(escrow.supplyId)
            if (supply?.state === "disputed") {
              deferred.push({ supplyId: escrow.supplyId, reason: "disputed" })
              continue
            }
            const retentionPassed =
              escrow.deleteAfter !== undefined && Date.parse(now) > Date.parse(escrow.deleteAfter)
            const terminalListing =
              supply !== undefined &&
              (supply.state === "expired" ||
                supply.state === "failed" ||
                supply.state === "unavailable")
            if (!retentionPassed && !terminalListing) {
              continue
            }
            if (options.dryRun !== true) {
              await storage.deleteEscrowObject(escrow.supplyId)
              database.markSupplyEscrowDeleted({ supplyId: escrow.supplyId, deletedAt: now })
            }
            deleted.push(escrow.supplyId)
          }
          printJson({ actor: options.actor, dryRun: options.dryRun === true, deleted, deferred })
        })
      },
    )

  escrowCommand
    .command("revalidate")
    .description(
      "Decrypt one escrow object and re-run the intake validation for audits and disputes",
    )
    .requiredOption("--db <path>", "Registry SQLite database path")
    .requiredOption("--storage <path>", "Registry storage root")
    .requiredOption("--supply-id <id>", "Supply record id")
    .option("--storage-backend <backend>", "Registry storage backend: local or hosted", "local")
    .option("--json", "Print the revalidation outcome as JSON")
    .action(
      async (
        options: Readonly<{ db: string; supplyId: string; json?: boolean }> & EscrowStorageOptions,
      ) => {
        const masterKey = escrowMasterKeyFromEnv()
        await withDatabaseAsync(options.db, async (database) => {
          const escrow = database.getSupplyEscrow(options.supplyId)
          if (escrow === undefined || escrow.deletedAt !== undefined) {
            throw new Error(`supply_not_found: no live escrow for ${options.supplyId}`)
          }
          const storage = escrowStorageFor(database, options)
          const ciphertext = await storage.readEscrowObject({
            supplyId: options.supplyId,
            expectedSha256: escrow.ciphertextSha256,
          })
          const plaintext = decryptEscrowArchive(
            masterKey,
            {
              ciphertext: Buffer.from(ciphertext),
              wrappedDek: escrow.wrappedDek,
              nonce: escrow.nonce,
              tag: escrow.tag,
            },
            options.supplyId,
          )
          // Re-runs the exact publish-intake validation; a human-authored
          // "match" is never accepted here. The privacy stamp is reported
          // rather than required: archives escrowed before the stamp existed
          // were valid when lodged and must stay auditable, not crash.
          const intake = validateEscrowArchive({
            archive: plaintext,
            privacyStampPolicy: "report",
          })
          const lodged = new Set(
            (database.getSupplyRecord(options.supplyId)?.proof.hashes ?? []).map(
              (proofHash) => proofHash.sha256,
            ),
          )
          const mismatches = intake.proofHashes
            .filter((recomputed) => !lodged.has(recomputed.sha256))
            .map((recomputed) => `recomputed hash for ${recomputed.label} is not in proof.hashes`)
          printJson({
            supplyId: options.supplyId,
            result: mismatches.length === 0 ? "match" : "mismatch",
            artifactCount: intake.proofHashes.length,
            totalEventCount: intake.totalEventCount,
            mismatches,
            privacyStampMissing: intake.privacyStampMissing,
          })
          if (mismatches.length > 0) {
            process.exitCode = 1
          }
        })
      },
    )

  escrowCommand
    .command("rewrap-master-key")
    .description(
      "Rotate the escrow master key: re-wrap every DEK under REGISTRY_ESCROW_NEXT_MASTER_KEY and verify a decrypt probe per object",
    )
    .requiredOption("--db <path>", "Registry SQLite database path")
    .requiredOption("--storage <path>", "Registry storage root")
    .requiredOption("--actor <id>", "Operator actor id")
    .option("--storage-backend <backend>", "Registry storage backend: local or hosted", "local")
    .option("--json", "Print the rotation outcome as JSON")
    .action(
      async (
        options: Readonly<{ db: string; actor: string; json?: boolean }> & EscrowStorageOptions,
      ) => {
        const currentKey = escrowMasterKeyFromEnv("REGISTRY_ESCROW_MASTER_KEY")
        const nextKey = escrowMasterKeyFromEnv("REGISTRY_ESCROW_NEXT_MASTER_KEY")
        await withDatabaseAsync(options.db, async (database) => {
          const storage = escrowStorageFor(database, options)
          const rewrapped: string[] = []
          for (const escrow of database.listSupplyEscrows()) {
            if (escrow.deletedAt !== undefined) {
              continue
            }
            const nextWrappedDek = rewrapEscrowDek(
              currentKey,
              nextKey,
              escrow.wrappedDek,
              escrow.supplyId,
            )
            // Decrypt probe before committing the row: the rotated DEK must
            // open the stored object or the rotation aborts.
            const ciphertext = await storage.readEscrowObject({
              supplyId: escrow.supplyId,
              expectedSha256: escrow.ciphertextSha256,
            })
            decryptEscrowArchive(
              nextKey,
              {
                ciphertext: Buffer.from(ciphertext),
                wrappedDek: nextWrappedDek,
                nonce: escrow.nonce,
                tag: escrow.tag,
              },
              escrow.supplyId,
            )
            database.updateSupplyEscrowWrappedDek({
              supplyId: escrow.supplyId,
              wrappedDek: nextWrappedDek,
            })
            rewrapped.push(escrow.supplyId)
          }
          printJson({ actor: options.actor, rewrapped, count: rewrapped.length })
        })
      },
    )
}
