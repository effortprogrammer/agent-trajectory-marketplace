import type { Command } from "commander"

import { bundleTrace, inspectTrace } from "../trajectory/evidence"
import { initPrototypeWorkspace, runPrototypeDemo } from "../trajectory/prototype"

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

const printJson = (value: unknown) => {
  console.log(JSON.stringify(value, null, 2))
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
}
