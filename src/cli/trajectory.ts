import type { Command } from "commander"

import { publishSellerPackageToRegistry, RegistryClientError } from "../registry/client"
import { bundleTrace, inspectTrace } from "../trajectory/evidence"
import { initPrototypeWorkspace, runPrototypeDemo } from "../trajectory/prototype"
import { createSellerPackage, inspectSellerPackage } from "../trajectory/seller-package"
import { registerAuthCommand } from "./auth"
import { registerMarketplaceCommand } from "./marketplace"
import { registerRegistryCommand } from "./registry"

type InitOptions = Readonly<{
  workspace: string
}>

type DemoOptions = Readonly<{
  export: string
  pattern?: string
  workspace: string
}>

type InspectOptions = Readonly<{
  json?: boolean
  trace: string
}>

type BundleOptions = Readonly<{
  out: string
  trace: string
}>

type SellerPackageOptions = Readonly<{
  json?: boolean
  metadata?: string
  out: string
  seller: string
  title: string
  trace: string
}>

type SellerInspectOptions = Readonly<{
  json?: boolean
  path: string
}>

type SellerPublishOptions = Readonly<{
  apiKey?: string
  json?: boolean
  path: string
  registry: string
}>

const printJson = (value: unknown) => {
  console.log(JSON.stringify(value, null, 2))
}

const sellerPublishApiKey = (options: SellerPublishOptions) => {
  const { TRAJECTORY_REGISTRY_API_KEY: envApiKey } = process.env
  const apiKey = options.apiKey ?? envApiKey
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new RegistryClientError(
      "missing_registry_api_key",
      "missing_registry_api_key: pass --api-key or set TRAJECTORY_REGISTRY_API_KEY",
      0,
    )
  }
  return apiKey
}

export const registerTrajectoryCommand = (program: Command) => {
  const trajectoryCommand = program
    .command("trajectory")
    .description("Bootstrap and verify the trajectory collector prototype")

  trajectoryCommand
    .command("init <runtime>")
    .description("Generate a local trajectory collector prototype workspace")
    .requiredOption("--workspace <path>", "Prototype workspace directory")
    .action((runtime: string, options: InitOptions) => {
      printJson(
        initPrototypeWorkspace({
          runtime,
          workspace: options.workspace,
        }),
      )
    })

  trajectoryCommand
    .command("demo <runtime>")
    .description("Run the generated trajectory collector prototype and export an ATF trace")
    .requiredOption("--workspace <path>", "Prototype workspace directory")
    .requiredOption("--export <path>", "Output path for the exported ATF JSON trace")
    .option("--pattern <path>", "Override the pattern YAML used for this demo run")
    .action((runtime: string, options: DemoOptions) => {
      printJson(
        runPrototypeDemo({
          runtime,
          workspace: options.workspace,
          exportPath: options.export,
          ...(options.pattern === undefined ? {} : { patternPath: options.pattern }),
        }),
      )
    })

  trajectoryCommand
    .command("inspect")
    .description("Inspect an ATF trace for marketplace readiness")
    .requiredOption("--trace <path>", "ATF JSON trace to inspect")
    .option("--json", "Print the inspection result as JSON")
    .action((options: InspectOptions) => {
      const result = inspectTrace({ tracePath: options.trace })
      printJson(result)
    })

  trajectoryCommand
    .command("bundle")
    .description("Create a local data-only evidence bundle from a marketplace-ready trace")
    .requiredOption("--trace <path>", "ATF JSON trace to bundle")
    .requiredOption("--out <path>", "Evidence bundle output directory")
    .action((options: BundleOptions) => {
      printJson(
        bundleTrace({
          tracePath: options.trace,
          outDir: options.out,
        }),
      )
    })

  const sellerCommand = trajectoryCommand
    .command("seller")
    .description("Package and inspect self-generated agent logs for marketplace listing")

  sellerCommand
    .command("package")
    .description("Create a listing-ready seller package from a marketplace-ready trace")
    .requiredOption("--trace <path>", "ATF JSON trace to package")
    .requiredOption("--out <path>", "Seller package output directory")
    .requiredOption("--seller <id>", "Seller agent identity")
    .requiredOption("--title <title>", "Dataset listing title")
    .option("--metadata <path>", "Closed-alpha marketplace metadata JSON")
    .option("--json", "Print the package result as JSON")
    .action((options: SellerPackageOptions) => {
      printJson(
        createSellerPackage({
          tracePath: options.trace,
          outDir: options.out,
          sellerId: options.seller,
          title: options.title,
          ...(options.metadata === undefined ? {} : { metadataPath: options.metadata }),
        }),
      )
    })

  sellerCommand
    .command("inspect")
    .description("Inspect a seller package for listing readiness")
    .requiredOption("--path <path>", "Seller package directory")
    .option("--json", "Print the inspection result as JSON")
    .action((options: SellerInspectOptions) => {
      printJson(inspectSellerPackage({ packageDir: options.path }))
    })

  sellerCommand
    .command("publish")
    .description("Publish a listing-ready seller package to a marketplace registry")
    .requiredOption("--path <path>", "Seller package directory")
    .requiredOption("--registry <url>", "Marketplace registry base URL")
    .option("--api-key <key>", "Seller registry API key; prefer TRAJECTORY_REGISTRY_API_KEY")
    .option("--json", "Print the publish result as JSON")
    .action(async (options: SellerPublishOptions) => {
      printJson(
        await publishSellerPackageToRegistry({
          packageDir: options.path,
          registryUrl: options.registry,
          apiKey: sellerPublishApiKey(options),
        }),
      )
    })

  registerAuthCommand(trajectoryCommand)

  registerRegistryCommand(trajectoryCommand)
  registerMarketplaceCommand(trajectoryCommand)
}
