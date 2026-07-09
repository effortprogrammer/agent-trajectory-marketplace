import { readFileSync } from "node:fs"

import type { Command } from "commander"
import { z } from "zod"

import {
  createWantedDatasetInRegistry,
  downloadRegistryListingPackage,
  inspectRegistryListing,
  inspectRegistrySupplyRecord,
  listRegistryListings,
  listRegistrySupply,
  listRegistryWantedDatasets,
  submitSupplyCandidateToRegistry,
  submitSupplyCommitmentToRegistry,
} from "../registry/client"
import {
  supplyCandidateRequestSchema,
  supplyCommitmentRequestSchema,
  supplyCommitmentTermsSchema,
  supplyIdSchema,
  supplyTimestampSchema,
  wantedDatasetRequestSchema,
} from "../registry/supply-contract"
import { readStoredRegistrySession } from "./auth-store"

type MarketplaceListOptions = Readonly<{
  apiKey?: string
  json?: boolean
  registry: string
}>

type MarketplaceInspectOptions = Readonly<{
  apiKey?: string
  json?: boolean
  registry: string
}>

type MarketplaceDownloadOptions = Readonly<{
  apiKey?: string
  json?: boolean
  out: string
  registry: string
}>

const printJson = (value: unknown) => {
  console.log(JSON.stringify(value, null, 2))
}

const marketplaceBuyerApiKey = (
  options: MarketplaceListOptions | MarketplaceInspectOptions | MarketplaceDownloadOptions,
) => {
  const { TRAJECTORY_REGISTRY_BUYER_API_KEY: envApiKey } = process.env
  const apiKey =
    options.apiKey ?? envApiKey ?? readStoredRegistrySession(options.registry)?.accessToken
  return apiKey === undefined || apiKey.trim().length === 0 ? undefined : apiKey
}

type SupplyFixtureOptions = Readonly<{
  apiKey?: string
  fixture: string
  json?: boolean
  registry: string
}>

type CommitmentSubmitOptions = SupplyFixtureOptions & Readonly<{ supplyId?: string }>

const marketplaceSellerApiKey = (options: { apiKey?: string; registry: string }) => {
  const { TRAJECTORY_REGISTRY_API_KEY: envApiKey } = process.env
  const apiKey =
    options.apiKey ?? envApiKey ?? readStoredRegistrySession(options.registry)?.accessToken
  return apiKey === undefined || apiKey.trim().length === 0 ? undefined : apiKey
}

const readFixtureJson = (fixturePath: string): unknown =>
  JSON.parse(readFileSync(fixturePath, "utf8"))

// A candidate fixture may carry an optional commitment block so a seller can
// submit proof and immediately promote it. The block is validated up front:
// missing reserve/SLA/proof-profile/consequence fields fail before anything
// is sent to the registry.
const candidateSubmitFixtureSchema = z
  .object({
    commitment: z
      .object({
        terms: supplyCommitmentTermsSchema,
        auctionDeadline: supplyTimestampSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .passthrough()
  .transform(({ commitment, ...candidate }) => ({
    candidate: supplyCandidateRequestSchema.parse(candidate),
    commitment,
  }))

const commitmentSubmitFixtureSchema = supplyCommitmentRequestSchema

export const registerMarketplaceCommand = (trajectoryCommand: Command) => {
  const marketplaceCommand = trajectoryCommand
    .command("marketplace")
    .description("Browse seller-custodied supply and legacy registry listings")

  const wantedCommand = marketplaceCommand
    .command("wanted")
    .description("Buyer wanted-dataset demand signals (never inventory)")

  wantedCommand
    .command("create")
    .description("Post one wanted-dataset demand signal from a JSON fixture")
    .requiredOption("--registry <url>", "Marketplace registry base URL")
    .requiredOption("--fixture <path>", "Wanted dataset JSON fixture")
    .option("--api-key <key>", "Buyer registry API key; prefer TRAJECTORY_REGISTRY_BUYER_API_KEY")
    .option("--json", "Print the stored wanted record as JSON")
    .action(async (options: SupplyFixtureOptions) => {
      const wanted = wantedDatasetRequestSchema.parse(readFixtureJson(options.fixture))
      const apiKey = marketplaceBuyerApiKey(options)
      printJson(
        await createWantedDatasetInRegistry({
          ...(apiKey === undefined ? {} : { apiKey }),
          registryUrl: options.registry,
          wanted,
        }),
      )
    })

  wantedCommand
    .command("list")
    .description("List wanted-dataset demand signals")
    .requiredOption("--registry <url>", "Marketplace registry base URL")
    .option("--api-key <key>", "Buyer registry API key; prefer TRAJECTORY_REGISTRY_BUYER_API_KEY")
    .option("--json", "Print wanted records as JSON")
    .action(async (options: Omit<SupplyFixtureOptions, "fixture">) => {
      const apiKey = marketplaceBuyerApiKey(options)
      printJson(
        await listRegistryWantedDatasets({
          ...(apiKey === undefined ? {} : { apiKey }),
          registryUrl: options.registry,
        }),
      )
    })

  const supplyCommand = marketplaceCommand
    .command("supply")
    .description("Browse seller-custodied supply records (metadata, proof, and state only)")

  supplyCommand
    .command("list")
    .description("List supply records and wanted demand signals")
    .requiredOption("--registry <url>", "Marketplace registry base URL")
    .option("--api-key <key>", "Registry API key; prefer TRAJECTORY_REGISTRY_BUYER_API_KEY")
    .option("--json", "Print supply records as JSON")
    .action(async (options: Omit<SupplyFixtureOptions, "fixture">) => {
      const apiKey = marketplaceBuyerApiKey(options)
      printJson(
        await listRegistrySupply({
          ...(apiKey === undefined ? {} : { apiKey }),
          registryUrl: options.registry,
        }),
      )
    })

  supplyCommand
    .command("inspect <supplyRecordId>")
    .description(
      "Inspect one supply record or wanted post; there is no download surface before fulfillment",
    )
    .requiredOption("--registry <url>", "Marketplace registry base URL")
    .option("--api-key <key>", "Registry API key; prefer TRAJECTORY_REGISTRY_BUYER_API_KEY")
    .option("--json", "Print the supply record as JSON")
    .action(async (supplyRecordId: string, options: Omit<SupplyFixtureOptions, "fixture">) => {
      const apiKey = marketplaceBuyerApiKey(options)
      printJson(
        await inspectRegistrySupplyRecord({
          ...(apiKey === undefined ? {} : { apiKey }),
          registryUrl: options.registry,
          supplyRecordId,
        }),
      )
    })

  const supplySellerCommand = marketplaceCommand
    .command("seller")
    .description("Seller-custodied supply submissions")

  const candidateCommand = supplySellerCommand
    .command("candidate")
    .description("Candidate dataset proof records (non-binding)")

  candidateCommand
    .command("submit")
    .description("Submit one candidate dataset with bounded JSON proof")
    .requiredOption("--registry <url>", "Marketplace registry base URL")
    .requiredOption("--fixture <path>", "Candidate JSON fixture (proof, optional commitment block)")
    .option("--api-key <key>", "Seller registry API key; prefer TRAJECTORY_REGISTRY_API_KEY")
    .option("--json", "Print the stored supply record as JSON")
    .action(async (options: SupplyFixtureOptions) => {
      const fixture = candidateSubmitFixtureSchema.parse(readFixtureJson(options.fixture))
      const apiKey = marketplaceSellerApiKey(options)
      const submitted = await submitSupplyCandidateToRegistry({
        ...(apiKey === undefined ? {} : { apiKey }),
        candidate: fixture.candidate,
        registryUrl: options.registry,
      })
      if (fixture.commitment === undefined) {
        printJson(submitted)
        return
      }
      printJson(
        await submitSupplyCommitmentToRegistry({
          ...(apiKey === undefined ? {} : { apiKey }),
          commitment: {
            supplyId: submitted.supply.supplyId,
            terms: fixture.commitment.terms,
            ...(fixture.commitment.auctionDeadline === undefined
              ? {}
              : { auctionDeadline: fixture.commitment.auctionDeadline }),
          },
          registryUrl: options.registry,
        }),
      )
    })

  const commitmentCommand = supplySellerCommand
    .command("commitment")
    .description("Committed dataset promotions (binding terms)")

  commitmentCommand
    .command("submit")
    .description("Promote a candidate to committed with reserve, SLA, and consequences")
    .requiredOption("--registry <url>", "Marketplace registry base URL")
    .requiredOption("--fixture <path>", "Commitment JSON fixture (supplyId + terms)")
    .option("--supply-id <id>", "Override the fixture supplyId")
    .option("--api-key <key>", "Seller registry API key; prefer TRAJECTORY_REGISTRY_API_KEY")
    .option("--json", "Print the committed supply record as JSON")
    .action(async (options: CommitmentSubmitOptions) => {
      const raw = readFixtureJson(options.fixture)
      const overridden =
        options.supplyId === undefined
          ? raw
          : {
              ...(raw as Record<string, unknown>),
              supplyId: supplyIdSchema.parse(options.supplyId),
            }
      const commitment = commitmentSubmitFixtureSchema.parse(overridden)
      const apiKey = marketplaceSellerApiKey(options)
      printJson(
        await submitSupplyCommitmentToRegistry({
          ...(apiKey === undefined ? {} : { apiKey }),
          commitment,
          registryUrl: options.registry,
        }),
      )
    })

  marketplaceCommand
    .command("list")
    .description("List closed-alpha marketplace registry listings")
    .requiredOption("--registry <url>", "Marketplace registry base URL")
    .option("--api-key <key>", "Buyer registry API key; prefer TRAJECTORY_REGISTRY_BUYER_API_KEY")
    .option("--json", "Print listings as JSON")
    .action(async (options: MarketplaceListOptions) => {
      const apiKey = marketplaceBuyerApiKey(options)
      printJson(
        apiKey === undefined
          ? await listRegistryListings({ registryUrl: options.registry })
          : await listRegistryListings({ apiKey, registryUrl: options.registry }),
      )
    })

  marketplaceCommand
    .command("inspect <listingId>")
    .description("Inspect one marketplace registry listing")
    .requiredOption("--registry <url>", "Marketplace registry base URL")
    .option("--api-key <key>", "Buyer registry API key; prefer TRAJECTORY_REGISTRY_BUYER_API_KEY")
    .option("--json", "Print listing detail as JSON")
    .action(async (listingId: string, options: MarketplaceInspectOptions) => {
      const apiKey = marketplaceBuyerApiKey(options)
      printJson(
        apiKey === undefined
          ? await inspectRegistryListing({ listingId, registryUrl: options.registry })
          : await inspectRegistryListing({ apiKey, listingId, registryUrl: options.registry }),
      )
    })

  marketplaceCommand
    .command("download <listingId>")
    .description("Download a marketplace listing as a local seller package")
    .requiredOption("--registry <url>", "Marketplace registry base URL")
    .requiredOption("--out <path>", "Output seller package directory")
    .option("--api-key <key>", "Buyer registry API key; prefer TRAJECTORY_REGISTRY_BUYER_API_KEY")
    .option("--json", "Print download result as JSON")
    .action(async (listingId: string, options: MarketplaceDownloadOptions) => {
      const apiKey = marketplaceBuyerApiKey(options)
      printJson(
        apiKey === undefined
          ? await downloadRegistryListingPackage({
              listingId,
              registryUrl: options.registry,
              outDir: options.out,
            })
          : await downloadRegistryListingPackage({
              apiKey,
              listingId,
              registryUrl: options.registry,
              outDir: options.out,
            }),
      )
    })
}
