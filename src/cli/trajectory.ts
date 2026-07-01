import type { Command } from "commander"

import { parseRegistryServeConfig, runRegistryServerProcess } from "../registry/server"
import { bundleTrace, inspectTrace } from "../trajectory/evidence"
import { initPrototypeWorkspace, runPrototypeDemo } from "../trajectory/prototype"
import { createSellerPackage, inspectSellerPackage } from "../trajectory/seller-package"

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
  out: string
  seller: string
  title: string
  trace: string
}>

type SellerInspectOptions = Readonly<{
  json?: boolean
  path: string
}>

type RegistryServeOptions = Readonly<{
  db: string
  host: string
  port: string
  sellerKey: readonly string[]
  storage: string
  tmp: string
}>

const printJson = (value: unknown) => {
  console.log(JSON.stringify(value, null, 2))
}

const collectSellerKey = (value: string, previous: readonly string[]) => [...previous, value]

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
    .action((options: SellerPackageOptions) => {
      printJson(
        createSellerPackage({
          tracePath: options.trace,
          outDir: options.out,
          sellerId: options.seller,
          title: options.title,
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
        }),
      )
    })
}
