import type { Command } from "commander"

import { publishSellerPackageToRegistry, RegistryClientError } from "../registry/client"
import {
  exportCollectedSession,
  listCollectRuntimes,
  listCollectSessions,
} from "../trajectory/collect"
import {
  collectWatchServiceStatus,
  installCollectWatchService,
  uninstallCollectWatchService,
} from "../trajectory/collect-service"
import {
  resolveCollectWatchRuntimes,
  runCollectSweep,
  runCollectWatchLoop,
} from "../trajectory/collect-watch"
import { bundleTrace, inspectTrace } from "../trajectory/evidence"
import type { CollectPrivacyOptions } from "../trajectory/privacy/pipeline"
import { filterExistingTrace } from "../trajectory/privacy/retrofit"
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

type CollectSessionsOptions = Readonly<{
  limit?: string
  source?: string
}>

type CollectPrivacyFlagOptions = Readonly<{
  // Commander sets this false for --no-privacy-filter, true otherwise.
  privacyFilter: boolean
  privacyThreshold?: string
}>

type CollectExportOptions = CollectPrivacyFlagOptions &
  Readonly<{
    export: string
    session: string
    source?: string
  }>

type CollectWatchOptions = CollectPrivacyFlagOptions &
  Readonly<{
    intervalSeconds: string
    once?: boolean
    out: string
    runtime?: readonly string[]
    settleSeconds: string
    source?: string
  }>

type CollectServiceInstallOptions = CollectPrivacyFlagOptions &
  Readonly<{
    dryRun?: boolean
    intervalSeconds: string
    out: string
    runtime?: readonly string[]
    settleSeconds: string
    source?: string
  }>

type PrivacyFilterCommandOptions = Readonly<{
  export: string
  json?: boolean
  privacyThreshold?: string
  trace: string
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

const collectPrivacyOptions = (options: CollectPrivacyFlagOptions): CollectPrivacyOptions => ({
  enabled: options.privacyFilter,
  ...(options.privacyThreshold === undefined
    ? {}
    : { threshold: Number(options.privacyThreshold) }),
})

// Shared by collect export / watch / service install so the resident
// collector and the one-shot export advertise the same privacy controls.
const withCollectPrivacyFlags = (command: Command): Command =>
  command
    .option(
      "--no-privacy-filter",
      "Skip the ML privacy pass; unfiltered traces are not marketplace-ready",
    )
    .option(
      "--privacy-threshold <threshold>",
      "Minimum span confidence (0-1) before a detected PII span is masked",
    )

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

  const collectCommand = trajectoryCommand
    .command("collect")
    .description("Collect trajectories from coding-harness session logs")

  collectCommand
    .command("runtimes")
    .description("List coding-harness runtimes with a registered collector adapter")
    .action(() => {
      printJson(listCollectRuntimes())
    })

  collectCommand
    .command("sessions <runtime>")
    .description("List harness sessions discovered under the runtime's log directory")
    .option("--source <dir>", "Harness log directory; defaults to the adapter's known location")
    .option("--limit <count>", "Maximum number of sessions to list", "20")
    .action((runtime: string, options: CollectSessionsOptions) => {
      printJson(
        listCollectSessions({
          runtime,
          ...(options.source === undefined ? {} : { sourceDir: options.source }),
          ...(options.limit === undefined ? {} : { limit: Number(options.limit) }),
        }),
      )
    })

  withCollectPrivacyFlags(
    collectCommand
      .command("export <runtime>")
      .description("Convert one harness session log into a privacy-filtered ATF trace")
      .requiredOption("--session <idOrPath>", "Session id or path to a session log file")
      .requiredOption("--export <path>", "Output path for the exported ATF JSON trace")
      .option("--source <dir>", "Harness log directory; defaults to the adapter's known location"),
  ).action(async (runtime: string, options: CollectExportOptions) => {
    printJson(
      await exportCollectedSession(
        {
          runtime,
          session: options.session,
          exportPath: options.export,
          ...(options.source === undefined ? {} : { sourceDir: options.source }),
        },
        collectPrivacyOptions(options),
      ),
    )
  })

  withCollectPrivacyFlags(
    collectCommand
      .command("watch")
      .description("Run a resident collector that continuously converts harness sessions to ATF")
      .requiredOption("--out <dir>", "Directory for exported ATF traces and the collector state")
      .option("--runtime <runtimes...>", "Runtimes to watch; defaults to every registered adapter")
      .option("--source <dir>", "Harness log directory override; requires exactly one --runtime")
      .option("--interval-seconds <seconds>", "Seconds between collector sweeps", "30")
      .option(
        "--settle-seconds <seconds>",
        "Seconds a session must stay unchanged before it is converted",
        "60",
      )
      .option("--once", "Run a single sweep and exit instead of staying resident"),
  ).action(async (options: CollectWatchOptions) => {
    const runtimes = resolveCollectWatchRuntimes(options.runtime)
    if (options.source !== undefined && runtimes.length !== 1) {
      throw new Error("invalid_request: --source requires exactly one --runtime")
    }
    const config = {
      outDir: options.out,
      runtimes,
      ...(options.source === undefined ? {} : { sourceDir: options.source }),
      settleSeconds: Number(options.settleSeconds),
    }
    const privacy = collectPrivacyOptions(options)
    if (options.once === true) {
      printJson(await runCollectSweep(config, privacy))
      return
    }
    const intervalSeconds = Number(options.intervalSeconds)
    printJson({
      mode: "collect-watch",
      outDir: options.out,
      runtimes,
      intervalSeconds,
      settleSeconds: config.settleSeconds,
      privacyFilter: options.privacyFilter,
    })
    let running = true
    const stop = () => {
      running = false
    }
    process.on("SIGINT", stop)
    process.on("SIGTERM", stop)
    await runCollectWatchLoop({
      config,
      privacy,
      intervalSeconds,
      onSweep: (summary) => {
        console.log(JSON.stringify(summary))
      },
      onSweepError: (error) => {
        console.error(JSON.stringify({ error: error.message }))
      },
      shouldContinue: () => running,
    })
  })

  const collectServiceCommand = collectCommand
    .command("service")
    .description("Manage the resident collector as a macOS launchd LaunchAgent")

  withCollectPrivacyFlags(
    collectServiceCommand
      .command("install")
      .description("Install and start the collector LaunchAgent (RunAtLoad + KeepAlive)")
      .requiredOption("--out <dir>", "Directory for exported ATF traces and the collector state")
      .option("--runtime <runtimes...>", "Runtimes to watch; defaults to every registered adapter")
      .option("--source <dir>", "Harness log directory override; requires exactly one --runtime")
      .option("--interval-seconds <seconds>", "Seconds between collector sweeps", "30")
      .option(
        "--settle-seconds <seconds>",
        "Seconds a session must stay unchanged before it is converted",
        "60",
      )
      .option("--dry-run", "Render the launchd plist without touching launchctl"),
  ).action((options: CollectServiceInstallOptions) => {
    const runtimes = resolveCollectWatchRuntimes(options.runtime)
    if (options.source !== undefined && runtimes.length !== 1) {
      throw new Error("invalid_request: --source requires exactly one --runtime")
    }
    // One flag→config translation for every surface: the same parse the
    // in-process commands use, mapped onto the service config keys.
    const privacy = collectPrivacyOptions(options)
    printJson(
      installCollectWatchService({
        config: {
          outDir: options.out,
          runtimes,
          ...(options.source === undefined ? {} : { sourceDir: options.source }),
          intervalSeconds: Number(options.intervalSeconds),
          settleSeconds: Number(options.settleSeconds),
          privacyFilter: privacy.enabled ?? true,
          ...(privacy.threshold === undefined ? {} : { privacyThreshold: privacy.threshold }),
        },
        ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
      }),
    )
  })

  collectServiceCommand
    .command("uninstall")
    .description("Stop and remove the collector LaunchAgent")
    .action(() => {
      printJson(uninstallCollectWatchService())
    })

  collectServiceCommand
    .command("status")
    .description("Show whether the collector LaunchAgent is installed and running")
    .action(() => {
      printJson(collectWatchServiceStatus())
    })

  const privacyCommand = trajectoryCommand
    .command("privacy")
    .description("Run the ML privacy filter outside the collect pipeline")

  privacyCommand
    .command("filter")
    .description(
      "Run the privacy pass over an existing ATF trace and write a stamped copy (retrofit for pre-stamp exports)",
    )
    .requiredOption("--trace <path>", "Existing ATF JSON trace to filter")
    .requiredOption("--export <path>", "Output path for the filtered, stamped trace")
    .option(
      "--privacy-threshold <threshold>",
      "Minimum span confidence (0-1) before a detected PII span is masked",
    )
    .option("--json", "Print the filter result as JSON")
    .action(async (options: PrivacyFilterCommandOptions) => {
      printJson(
        await filterExistingTrace(
          { tracePath: options.trace, exportPath: options.export },
          options.privacyThreshold === undefined
            ? {}
            : { threshold: Number(options.privacyThreshold) },
        ),
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
