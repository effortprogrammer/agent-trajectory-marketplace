#!/usr/bin/env bun

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

const evidenceRoot = ".omo/evidence/marketplace-prelaunch-roadmap"
const defaultEnvEvidence = `${evidenceRoot}/task-13-staging-env-template-validation.json`
const defaultRollbackEvidence = `${evidenceRoot}/task-13-rollback-dry-run.json`
const startCommand = "bun src/cli/index.ts trajectory registry serve --hosted"
const templatePath = "docs/railway-staging.env.example"
const safeRedactedSecretPlaceholderPattern = /^<redacted:[a-z0-9]+(?:-[a-z0-9]+)*>$/

const requiredHostedEnvNames = [
  "REGISTRY_ENV",
  "REGISTRY_HOST",
  "REGISTRY_PORT",
  "REGISTRY_PUBLIC_BASE_URL",
  "STAGING_REGISTRY_URL",
  "PRODUCTION_REGISTRY_URL",
  "REGISTRY_DB_BACKEND",
  "REGISTRY_DB_MIGRATIONS_DIR",
  "REGISTRY_DB_PATH",
  "REGISTRY_BACKUP_BUCKET",
  "REGISTRY_PACKAGE_STORAGE_BACKEND",
  "REGISTRY_PACKAGE_BUCKET",
  "REGISTRY_PACKAGE_STORAGE_REGION",
  "REGISTRY_PACKAGE_STORAGE_ACCESS_KEY_ID",
  "REGISTRY_PACKAGE_STORAGE_SECRET_ACCESS_KEY",
  "REGISTRY_TMP_ROOT",
  "REGISTRY_OPERATOR_STATE_PATH",
  "REGISTRY_ACCESS_RECORDS",
  "REGISTRY_ADMIN_KEY_HASHES",
  "REGISTRY_EMAIL_DELIVERY",
  "REGISTRY_EMAIL_AUTH_SECRET",
  "REGISTRY_SMTP_HOST",
  "REGISTRY_SMTP_PORT",
  "REGISTRY_SMTP_USERNAME",
  "REGISTRY_SMTP_PASSWORD",
  "REGISTRY_SMTP_FROM",
  "REGISTRY_SMTP_SECURE",
  "REGISTRY_LOG_LEVEL",
  "REGISTRY_OTEL_EXPORTER_OTLP_ENDPOINT",
] as const

const secretEnvNames = new Set([
  "REGISTRY_PACKAGE_STORAGE_ACCESS_KEY_ID",
  "REGISTRY_PACKAGE_STORAGE_SECRET_ACCESS_KEY",
  "REGISTRY_ACCESS_RECORDS",
  "REGISTRY_ADMIN_KEY_HASHES",
  "REGISTRY_EMAIL_AUTH_SECRET",
  "REGISTRY_SMTP_USERNAME",
  "REGISTRY_SMTP_PASSWORD",
])

type CommandName = "rollback-dry-run" | "validate-env-template"
type CliOptions = Readonly<{
  command: CommandName
  evidencePath: string
  templatePath: string
}>
type TemplateEntry = Readonly<{
  name: string
  value: string
}>
type CommandProbe = Readonly<{
  command: readonly string[]
  exitCode: number
  stderr: string
  stdout: string
}>

class PreflightError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PreflightError"
  }
}

const printHelp = () => {
  console.log(`Usage: bun scripts/railway-staging-preflight.ts <command> [options]

Commands:
  validate-env-template   Validate the redacted Railway staging env template
  rollback-dry-run        Verify local rollback commands without changing Railway state

Options:
  --template <path>       Env template path (default: ${templatePath})
  --evidence <path>       Evidence JSON output path`)
}

const parseArgs = (args: readonly string[]): CliOptions => {
  const command = args[0]
  if (command === undefined || command === "--help") {
    printHelp()
    throw new PreflightError("command is required")
  }
  if (command !== "validate-env-template" && command !== "rollback-dry-run") {
    throw new PreflightError(`unknown command: ${command}`)
  }

  let evidencePath =
    command === "validate-env-template" ? defaultEnvEvidence : defaultRollbackEvidence
  let selectedTemplatePath = templatePath
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index]
    const value = args[index + 1]
    switch (arg) {
      case "--evidence":
        if (value === undefined || value.startsWith("--")) {
          throw new PreflightError("--evidence requires a path")
        }
        evidencePath = value
        index += 1
        break
      case "--template":
        if (value === undefined || value.startsWith("--")) {
          throw new PreflightError("--template requires a path")
        }
        selectedTemplatePath = value
        index += 1
        break
      default:
        throw new PreflightError(`unknown option: ${arg}`)
    }
  }

  return { command, evidencePath, templatePath: selectedTemplatePath }
}

const writeEvidence = (path: string, payload: unknown) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  console.log(path)
}

const parseTemplate = (path: string): readonly TemplateEntry[] =>
  readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const separatorIndex = line.indexOf("=")
      if (separatorIndex < 1) {
        throw new PreflightError(`invalid env template line: ${line}`)
      }
      return {
        name: line.slice(0, separatorIndex),
        value: line.slice(separatorIndex + 1),
      }
    })

const entriesToRecord = (entries: readonly TemplateEntry[]): Readonly<Record<string, string>> => {
  const record: Record<string, string> = {}
  for (const entry of entries) {
    if (record[entry.name] !== undefined) {
      throw new PreflightError(`duplicate env template key: ${entry.name}`)
    }
    record[entry.name] = entry.value
  }
  return record
}

const readTemplateValue = (
  env: Readonly<Record<string, string>>,
  name: (typeof requiredHostedEnvNames)[number],
): string => {
  const value = env[name]
  if (value === undefined) {
    throw new PreflightError(`${name} is required`)
  }
  return value
}

const validateEnvTemplate = (options: CliOptions) => {
  const env = entriesToRecord(parseTemplate(options.templatePath))
  const missingEnvNames = requiredHostedEnvNames.filter((name) => env[name] === undefined)
  const emptyEnvNames = requiredHostedEnvNames.filter((name) => env[name]?.trim().length === 0)
  const unredactedSecretNames = [...secretEnvNames].filter((name) => {
    const value = env[name]
    return value === undefined || !safeRedactedSecretPlaceholderPattern.test(value)
  })
  if (missingEnvNames.length > 0 || emptyEnvNames.length > 0 || unredactedSecretNames.length > 0) {
    throw new PreflightError("staging env template is incomplete or contains unredacted secrets")
  }
  if (readTemplateValue(env, "REGISTRY_ENV") !== "staging") {
    throw new PreflightError("REGISTRY_ENV must be staging")
  }
  if (
    readTemplateValue(env, "REGISTRY_PUBLIC_BASE_URL") !==
    readTemplateValue(env, "STAGING_REGISTRY_URL")
  ) {
    throw new PreflightError("REGISTRY_PUBLIC_BASE_URL must match STAGING_REGISTRY_URL")
  }
  if (readTemplateValue(env, "REGISTRY_PACKAGE_STORAGE_BACKEND") !== "hosted") {
    throw new PreflightError("REGISTRY_PACKAGE_STORAGE_BACKEND must be hosted")
  }
  if (readTemplateValue(env, "REGISTRY_EMAIL_DELIVERY") !== "smtp") {
    throw new PreflightError("REGISTRY_EMAIL_DELIVERY must be smtp in hosted staging/production")
  }
  const smtpSecure = readTemplateValue(env, "REGISTRY_SMTP_SECURE")
  if (smtpSecure !== "starttls" && smtpSecure !== "tls") {
    throw new PreflightError(
      "REGISTRY_SMTP_SECURE must be starttls or tls in hosted staging/production",
    )
  }

  writeEvidence(options.evidencePath, {
    scenario: "Todo 13 Railway staging env template validation",
    command: "validate-env-template",
    productionTargeted: false,
    requiredEnvNames: requiredHostedEnvNames,
    missingEnvNames,
    emptyEnvNames,
    unredactedSecretNames,
    redactedSecretNames: [...secretEnvNames],
    railwayStartCommand: startCommand,
    healthCommand: 'curl --fail --show-error "$STAGING_REGISTRY_URL/health"',
    hostedE2eValidationCommand:
      "HOSTED_REGISTRY_E2E_ENABLED=true HOSTED_REGISTRY_URL=$STAGING_REGISTRY_URL HOSTED_REGISTRY_API_KEY=<redacted:seller-key> HOSTED_REGISTRY_BUYER_API_KEY=<redacted:buyer-key> bun scripts/hosted-registry-e2e.ts --validate-env",
    hostedE2eCommand:
      "HOSTED_REGISTRY_E2E_ENABLED=true HOSTED_REGISTRY_URL=$STAGING_REGISTRY_URL HOSTED_REGISTRY_API_KEY=<redacted:seller-key> HOSTED_REGISTRY_BUYER_API_KEY=<redacted:buyer-key> bun scripts/hosted-registry-e2e.ts --summary .omo/evidence/marketplace-prelaunch-roadmap/task-13-hosted-e2e-summary.json",
    stagingOnlyFilesystemStorage: {
      packageBucket: readTemplateValue(env, "REGISTRY_PACKAGE_BUCKET"),
      note: "The current hosted adapter uses filesystem object layout; use a Railway volume for staging only until object storage credentials are provisioned.",
    },
  })
}

const runProbe = async (command: readonly string[]): Promise<CommandProbe> => {
  const child = Bun.spawn({ cmd: [...command], stderr: "pipe", stdout: "pipe" })
  const timeout = setTimeout(() => child.kill(), 10_000)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (exitCode !== 0) {
      throw new PreflightError(`${command.join(" ")} failed with exit ${exitCode}`)
    }
    return { command, exitCode, stderr: stderr.trim(), stdout: stdout.trim() }
  } finally {
    clearTimeout(timeout)
  }
}

const runRollbackDryRun = async (options: CliOptions) => {
  const probes = await Promise.all([
    runProbe(["railway", "--version"]),
    runProbe(["railway", "status", "--help"]),
    runProbe(["railway", "deployment", "list", "--help"]),
    runProbe(["railway", "down", "--help"]),
  ])
  writeEvidence(options.evidencePath, {
    scenario: "Todo 13 Railway rollback dry-run",
    command: "rollback-dry-run",
    productionTargeted: false,
    destructiveCommandsExecuted: [],
    nonDestructiveCommandsExecuted: probes,
    rollbackCommandReadyButNotExecuted:
      "railway down --service <staging-service> --environment staging --project <staging-project-id>",
    rollbackValidationCommands: [
      "railway status --json",
      "railway deployment list --service <staging-service> --environment staging",
      'curl --fail --show-error "$STAGING_REGISTRY_URL/health"',
      "bun scripts/hosted-registry-e2e.ts --validate-env",
    ],
  })
}

const main = async () => {
  const options = parseArgs(process.argv.slice(2))
  if (options.command === "validate-env-template") {
    validateEnvTemplate(options)
    return
  }
  await runRollbackDryRun(options)
}

await main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message)
  } else {
    console.error("unknown Railway staging preflight failure")
  }
  process.exitCode = 1
})
