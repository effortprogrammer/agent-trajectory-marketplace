import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"

export const packageOutputSchema = z.object({
  packageDir: z.string(),
  manifestPath: z.string(),
  datasetPath: z.string(),
  metadataPath: z.string().optional(),
  sellerPath: z.string(),
  tracePath: z.string(),
  listingReady: z.boolean(),
  eventCount: z.number(),
})

export const packageInspectSchema = z.object({
  valid: z.boolean(),
  listingReady: z.boolean(),
  sellerId: z.string(),
  datasetId: z.string(),
  eventCount: z.number(),
  metadata: z
    .object({
      price: z.object({ mode: z.string(), display: z.string() }),
      license: z.object({ name: z.string(), url: z.string().optional() }),
      usageTerms: z.object({
        allowed: z.array(z.string()),
        prohibited: z.array(z.string()),
      }),
      sellerProfile: z.object({
        displayName: z.string(),
        supportUrl: z.string().optional(),
      }),
      sample: z.object({ summary: z.string(), maxPreviewEvents: z.number() }),
      accessPolicy: z.string(),
    })
    .optional(),
  filesVerified: z.array(z.string()),
})

export const sellerSchema = z.object({
  sellerId: z.string(),
  rights: z.literal("self_generated_agent_log"),
})

export const datasetSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("agent-log-dataset"),
  datasetId: z.string(),
  title: z.string(),
  runtime: z.string(),
  status: z.string(),
  eventCount: z.number(),
  eventKinds: z.array(z.string()),
  traceSha256: z.string(),
  purpose: z.string(),
})

export const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("trajectory-seller-package"),
  packageId: z.string(),
  createdAt: z.string(),
  files: z.array(z.object({ path: z.string(), sha256: z.string() })),
  checks: z.object({
    listingReady: z.boolean(),
    marketplaceReady: z.boolean(),
    redactionClean: z.boolean(),
  }),
  marketplace: z
    .object({
      price: z.object({ mode: z.string(), display: z.string() }),
      license: z.object({ name: z.string(), url: z.string().optional() }),
      usageTerms: z.object({
        allowed: z.array(z.string()),
        prohibited: z.array(z.string()),
      }),
      sellerProfile: z.object({
        displayName: z.string(),
        supportUrl: z.string().optional(),
      }),
      sample: z.object({ summary: z.string(), maxPreviewEvents: z.number() }),
      accessPolicy: z.string(),
    })
    .optional(),
})

export const traceSchema = z.object({
  runtime: z.string(),
  status: z.string(),
  eventCount: z.number(),
  events: z.array(z.object({ kind: z.string(), name: z.string(), detail: z.string() })),
})

type CliResult = Readonly<{
  stderr: string
  stdout: string
  success: boolean
}>

const workspaces: string[] = []

export const cleanupSellerWorkspaces = () => {
  while (workspaces.length > 0) {
    const workspace = workspaces.pop()
    if (workspace) {
      rmSync(workspace, { force: true, recursive: true })
    }
  }
}

export const parseJson = (value: string): unknown => JSON.parse(value)

export const sha256File = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex")

const inheritedEnvironment = () => {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value
    }
  }
  return env
}

export const runCli = async (
  args: readonly string[],
  extraEnv: Readonly<Record<string, string>> = {},
): Promise<CliResult> => {
  const result = Bun.spawn({
    cmd: [process.execPath, "src/cli/index.ts", ...args],
    cwd: process.cwd(),
    env: { ...inheritedEnvironment(), ...extraEnv, LANG: "en_US.UTF-8" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(result.stdout).text(),
    new Response(result.stderr).text(),
    result.exited,
  ])
  return { success: exitCode === 0, stdout: stdout.trim(), stderr: stderr.trim() }
}

export const createWorkspacePath = () => {
  const parentRoot = join(process.cwd(), ".tmp")
  mkdirSync(parentRoot, { recursive: true })
  const parentDir = mkdtempSync(join(parentRoot, "trajectory-seller-"))
  workspaces.push(parentDir)
  return join(parentDir, "workspace")
}

const assertCliSuccess = (result: CliResult, commandName: string) => {
  if (!result.success) {
    throw new Error(`${commandName} failed: ${result.stderr}`)
  }
}

export const prepareTrace = async () => {
  const workspace = createWorkspacePath()
  const exportPath = join(workspace, "artifacts", "trace.atf.json")
  assertCliSuccess(
    await runCli(["trajectory", "init", "hermes", "--workspace", workspace]),
    "trajectory init",
  )
  assertCliSuccess(
    await runCli([
      "trajectory",
      "demo",
      "hermes",
      "--workspace",
      workspace,
      "--export",
      exportPath,
    ]),
    "trajectory demo",
  )
  return { workspace, exportPath }
}

export const packageArgs = (tracePath: string, outDir: string) =>
  [
    "trajectory",
    "seller",
    "package",
    "--trace",
    tracePath,
    "--out",
    outDir,
    "--seller",
    "agent-local",
    "--title",
    "Hermes demo self-log",
  ] as const

export const rewriteManifestHashes = (packageDir: string) => {
  const manifestPath = join(packageDir, "manifest.json")
  const manifest = manifestSchema.parse(parseJson(readFileSync(manifestPath, "utf8")))
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        ...manifest,
        files: manifest.files.map((file) => ({
          ...file,
          sha256: sha256File(join(packageDir, file.path)),
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
}
