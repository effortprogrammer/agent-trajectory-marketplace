import { readFileSync } from "node:fs"
import { basename } from "node:path"

import type { Command } from "commander"

import {
  createWantedDatasetInRegistry,
  downloadEscrowDatasetFromRegistry,
  downloadRegistryListingPackage,
  inspectRegistryListing,
  inspectRegistrySupplyRecord,
  listRegistryListings,
  listRegistrySupply,
  listRegistryWantedDatasets,
  publishEscrowCandidateToRegistry,
  submitSupplyCommitmentToRegistry,
} from "../registry/client"
import { buildEscrowDatasetArchive } from "../registry/escrow-archive"
import {
  supplyCandidateRequestSchema,
  supplyCommitmentRequestSchema,
  supplyIdSchema,
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

type CandidatePublishOptions = Readonly<{
  apiKey?: string
  candidate: string
  json?: boolean
  notes?: string
  registry: string
  trace: readonly string[]
}>

type BuyerDownloadOptions = Readonly<{
  apiKey?: string
  json?: boolean
  out: string
  registry: string
}>

const collectRepeated = (value: string, previous: readonly string[]): string[] => [
  ...previous,
  value,
]

// Trace entry label from its filename: "session.atf.json" → "session".
const traceLabelFromPath = (tracePath: string): string =>
  basename(tracePath)
    .replace(/\.atf\.json$/i, "")
    .replace(/\.json$/i, "")

const marketplaceSellerApiKey = (options: { apiKey?: string; registry: string }) => {
  const { TRAJECTORY_REGISTRY_API_KEY: envApiKey } = process.env
  const apiKey =
    options.apiKey ?? envApiKey ?? readStoredRegistrySession(options.registry)?.accessToken
  return apiKey === undefined || apiKey.trim().length === 0 ? undefined : apiKey
}

const readFixtureJson = (fixturePath: string): unknown =>
  JSON.parse(readFileSync(fixturePath, "utf8"))

const commitmentSubmitFixtureSchema = supplyCommitmentRequestSchema

export const registerMarketplaceCommand = (trajectoryCommand: Command) => {
  const marketplaceCommand = trajectoryCommand
    .command("marketplace")
    .description("Browse escrowed supply and legacy registry listings")

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
    .description(
      "Browse anonymous escrowed supply metadata, legacy bounded redacted proof preview, aggregate-only evidence, and state",
    )

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
      "Inspect one anonymous supply proof preview or wanted post; dataset bytes stay gated until fulfillment",
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
    .description("Publish encrypted candidate datasets and submit binding commitments")

  const candidateCommand = supplySellerCommand
    .command("candidate")
    .description("Publish canonical seller ATF datasets into encrypted registry escrow")

  candidateCommand
    .command("publish")
    .description(
      "Publish canonical seller ATF through always-on encrypted length-prefixed framed escrow; JSON-only candidate publishing is retired and rejected; the marketplace stores ciphertext plus metadata and aggregate-only evidence, never public plaintext",
    )
    .requiredOption("--registry <url>", "Marketplace registry base URL")
    .requiredOption(
      "--candidate <path>",
      "Candidate JSON (title, description, proof narrative sections)",
    )
    .requiredOption(
      "--trace <path>",
      "ATF trace to include in the framed escrow dataset; repeat --trace to include several",
      collectRepeated,
      [] as string[],
    )
    .option("--notes <text>", "Optional manifest notes recorded with the archive")
    .option("--api-key <key>", "Seller registry API key; prefer TRAJECTORY_REGISTRY_API_KEY")
    .option("--json", "Print the stored supply record as JSON")
    .action(async (options: CandidatePublishOptions) => {
      if (options.trace.length === 0) {
        throw new Error("escrow publish requires at least one --trace")
      }
      const candidate = supplyCandidateRequestSchema.parse(readFixtureJson(options.candidate))
      const traces = options.trace.map((tracePath) => ({
        label: traceLabelFromPath(tracePath),
        atf: readFileSync(tracePath, "utf8"),
      }))
      const { zip, manifest } = buildEscrowDatasetArchive({
        traces,
        ...(options.notes === undefined ? {} : { notes: options.notes }),
      })
      const apiKey = marketplaceSellerApiKey(options)
      if (apiKey === undefined) {
        throw new Error(
          "escrow publish requires a seller API key (--api-key or TRAJECTORY_REGISTRY_API_KEY)",
        )
      }
      const published = await publishEscrowCandidateToRegistry({
        apiKey,
        candidate,
        zip,
        registryUrl: options.registry,
      })
      printJson({
        supply: published.supply,
        archiveByteCount: zip.length,
        artifactCount: manifest.artifacts.length,
      })
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

  const buyerCommand = marketplaceCommand
    .command("buyer")
    .description("Buyer dataset retrieval for fulfilled escrow transactions")

  buyerCommand
    .command("download <transactionId>")
    .description("Download the entitled escrow dataset zip for a released fulfillment")
    .requiredOption("--registry <url>", "Marketplace registry base URL")
    .requiredOption("--out <path>", "Output path for the dataset zip")
    .option("--api-key <key>", "Buyer registry API key; prefer TRAJECTORY_REGISTRY_BUYER_API_KEY")
    .option("--json", "Print the download result as JSON")
    .action(async (transactionId: string, options: BuyerDownloadOptions) => {
      const apiKey = marketplaceBuyerApiKey(options)
      printJson(
        await downloadEscrowDatasetFromRegistry({
          ...(apiKey === undefined ? {} : { apiKey }),
          transactionId,
          outPath: options.out,
          registryUrl: options.registry,
        }),
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
