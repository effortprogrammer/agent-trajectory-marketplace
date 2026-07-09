import { readFileSync } from "node:fs"

import type { Command } from "commander"

import { createRegistryDatabase, type RegistryDatabase } from "../registry/database"
import {
  grantOperatorEntitlement,
  mutateRegistryOperatorState,
  readRegistryOperatorState,
} from "../registry/operator"
import {
  buildFulfillmentTransactionId,
  type SupplyDeliveryManifest,
  type SupplyValidationReport,
  supplyDeliveryManifestSchema,
  supplyValidationReportSchema,
} from "../registry/supply-contract"

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

const readJsonFixture = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"))

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
          printJson({ actor: options.actor, fulfillment: transaction })
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
    .option("--json", "Print the release outcome as JSON")
    .action(
      (
        options: FulfillmentTransactionOptions &
          Readonly<{ buyerAccessId: string; listingId: string }>,
      ) => {
        withDatabase(options.db, (database) => {
          const current = database.getFulfillmentTransaction(options.transactionId)
          if (current === undefined) {
            throw new Error(`fulfillment_not_found: ${options.transactionId}`)
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
          } else if (
            current.state !== "entitlement_release_pending" &&
            current.state !== "entitlement_released"
          ) {
            throw new Error(
              `fulfillment_state_invalid: ${options.transactionId} is ${current.state}; release requires a fulfilled transaction`,
            )
          }

          const alreadyGranted = () => {
            const record = readRegistryOperatorState(options.state).records.find(
              (candidate) => candidate.accessId === options.buyerAccessId,
            )
            return (record?.entitlements ?? []).some(
              (entitlement) =>
                entitlement.listingId === options.listingId && entitlement.state === "active",
            )
          }

          let grantApplied = false
          if (!alreadyGranted()) {
            mutateRegistryOperatorState(options.state, (state) =>
              grantOperatorEntitlement(state, {
                accessId: options.buyerAccessId,
                actorId: options.actor,
                listingId: options.listingId,
              }),
            )
            grantApplied = true
          }

          const released =
            current.state === "entitlement_released"
              ? current
              : database.updateFulfillmentTransaction({
                  actorId: options.actor,
                  buyerAccessId: options.buyerAccessId,
                  detail: grantApplied
                    ? "entitlement granted in operator state and release recorded"
                    : "entitlement already present in operator state; release recorded idempotently",
                  entitlementListingId: options.listingId,
                  expectedCurrentStates: ["entitlement_release_pending"],
                  now: new Date().toISOString(),
                  state: "entitlement_released",
                  transactionId: options.transactionId,
                })

          printJson({
            actor: options.actor,
            fulfillment: released,
            grantApplied,
            idempotent: !grantApplied && current.state === "entitlement_released",
          })
        })
      },
    )
}
