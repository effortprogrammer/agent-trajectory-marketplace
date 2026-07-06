import type { Command } from "commander"

import {
  downloadRegistryListingPackage,
  inspectRegistryListing,
  listRegistryListings,
} from "../registry/client"
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

export const registerMarketplaceCommand = (trajectoryCommand: Command) => {
  const marketplaceCommand = trajectoryCommand
    .command("marketplace")
    .description("Browse and download registry marketplace listings")

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
