#!/usr/bin/env bun

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import {
  type HostedSummary,
  runFakeHostedRegistrySmoke,
  runHostedRegistrySmoke,
  validateHostedEnv,
} from "../src/registry/hosted-e2e"

const defaultSummaryPath =
  ".omo/evidence/marketplace-prelaunch-roadmap/task-11-hosted-e2e-summary.json"
const fakeLocalRoot = ".tmp/hosted-registry-e2e-local-work"

type CliOptions = Readonly<{
  fakeLocal: boolean
  help: boolean
  summaryPath: string
  validateEnv: boolean
}>

class HostedE2eError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "HostedE2eError"
  }
}

const printHelp = () => {
  console.log(`Usage: bun scripts/hosted-registry-e2e.ts [options]

Options:
  --validate-env     Verify hosted staging env vars without publishing
  --fake-local       Run against a temporary in-process registry for local tests
  --summary <path>   Write summary JSON (default: ${defaultSummaryPath})
  --help             Show this help

Hosted env:
  HOSTED_REGISTRY_E2E_ENABLED=true
  HOSTED_REGISTRY_URL=<staging registry URL>
  HOSTED_REGISTRY_API_KEY=<seller API key>
  HOSTED_REGISTRY_E2E_ALLOW_PROD=true   Override production-host guard`)
}

const parseOptions = (args: readonly string[]): CliOptions => {
  let fakeLocal = false
  let help = false
  let summaryPath = defaultSummaryPath
  let validateEnv = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    switch (arg) {
      case "--fake-local":
        fakeLocal = true
        break
      case "--help":
        help = true
        break
      case "--summary": {
        const value = args[index + 1]
        if (value === undefined || value.startsWith("--")) {
          throw new HostedE2eError("invalid_args", "--summary requires a path")
        }
        summaryPath = value
        index += 1
        break
      }
      case "--validate-env":
        validateEnv = true
        break
      default:
        throw new HostedE2eError("invalid_args", `unknown option: ${arg}`)
    }
  }

  return { fakeLocal, help, summaryPath, validateEnv }
}

const writeSummary = (summaryPath: string, summary: HostedSummary) => {
  mkdirSync(dirname(summaryPath), { recursive: true })
  const payload = `${JSON.stringify(summary, null, 2)}\n`
  writeFileSync(summaryPath, payload, "utf8")
  console.log(payload.trim())
}

const main = async (args: readonly string[]) => {
  const options = parseOptions(args)
  if (options.help) {
    printHelp()
    return
  }
  if (options.fakeLocal) {
    writeSummary(options.summaryPath, await runFakeHostedRegistrySmoke(fakeLocalRoot))
    return
  }

  const env = validateHostedEnv(process.env)
  if (options.validateEnv) {
    console.log(JSON.stringify({ ok: true, registryUrl: env.registryUrl }))
    return
  }

  mkdirSync(".tmp", { recursive: true })
  const localRoot = mkdtempSync(join(resolve(".tmp"), "hosted-registry-e2e-"))
  try {
    writeSummary(options.summaryPath, await runHostedRegistrySmoke({ ...env, localRoot }))
  } finally {
    rmSync(localRoot, { force: true, recursive: true })
  }
}

await main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message)
  } else {
    console.error("unknown hosted registry e2e failure")
  }
  process.exitCode = 1
})
