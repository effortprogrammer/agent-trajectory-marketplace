import { afterEach, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { z } from "zod"

const inspectOutputSchema = z.object({
  valid: z.boolean(),
  marketplaceReady: z.boolean(),
  runtime: z.string(),
  status: z.string(),
  eventCount: z.number(),
  requiredKinds: z.array(z.string()),
  redactedFindings: z.array(
    z.object({
      kind: z.string(),
      name: z.string(),
    }),
  ),
})

const bundleOutputSchema = z.object({
  bundleDir: z.string(),
  manifestPath: z.string(),
  tracePath: z.string(),
  marketplaceReady: z.boolean(),
  eventCount: z.number(),
})

const bundleManifestSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("trajectory-evidence-bundle"),
  trace: z.object({
    file: z.string(),
    sha256: z.string(),
    eventCount: z.number(),
  }),
  checks: z.object({
    marketplaceReady: z.boolean(),
    requiredKindsPresent: z.boolean(),
    redactionClean: z.boolean(),
  }),
})

const traceSchema = z.object({
  runtime: z.string(),
  status: z.string(),
  eventCount: z.number(),
  events: z.array(
    z.object({
      kind: z.string(),
      name: z.string(),
      detail: z.string(),
    }),
  ),
})

const workspaces: string[] = []

afterEach(() => {
  while (workspaces.length > 0) {
    const workspace = workspaces.pop()
    if (workspace) {
      rmSync(workspace, { force: true, recursive: true })
    }
  }
})

const parseJson = (value: string): unknown => JSON.parse(value)

const inheritedEnvironment = () => {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value
    }
  }
  return env
}

const runCli = async (args: readonly string[]) => {
  const result = Bun.spawn({
    cmd: [process.execPath, "src/cli/index.ts", ...args],
    cwd: process.cwd(),
    env: {
      ...inheritedEnvironment(),
      LANG: "en_US.UTF-8",
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(result.stdout).text(),
    new Response(result.stderr).text(),
    result.exited,
  ])
  return {
    success: exitCode === 0,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  }
}

const createWorkspacePath = () => {
  const parentRoot = join(process.cwd(), ".tmp")
  mkdirSync(parentRoot, { recursive: true })
  const parentDir = mkdtempSync(join(parentRoot, "trajectory-evidence-"))
  workspaces.push(parentDir)
  return join(parentDir, "workspace")
}

const prepareTrace = async () => {
  const workspace = createWorkspacePath()
  const exportPath = join(workspace, "artifacts", "trace.atf.json")
  const initResult = await runCli(["trajectory", "init", "hermes", "--workspace", workspace])
  expect(initResult.success).toBe(true)
  const demoResult = await runCli([
    "trajectory",
    "demo",
    "hermes",
    "--workspace",
    workspace,
    "--export",
    exportPath,
  ])
  expect(demoResult.success).toBe(true)
  return { workspace, exportPath }
}

test("trajectory inspect reports marketplace readiness for an exported trace", async () => {
  const { exportPath } = await prepareTrace()
  const result = await runCli(["trajectory", "inspect", "--trace", exportPath, "--json"])

  expect(result.success).toBe(true)
  expect(result.stderr).toBe("")

  const parsed = inspectOutputSchema.parse(parseJson(result.stdout))
  expect(parsed.valid).toBe(true)
  expect(parsed.marketplaceReady).toBe(true)
  expect(parsed.runtime).toBe("hermes")
  expect(parsed.status).toBe("instrumented")
  expect(parsed.eventCount).toBe(6)
  expect(parsed.requiredKinds).toEqual(
    expect.arrayContaining([
      "function_enter",
      "function_exit",
      "llm_call",
      "tool_call",
      "verification",
    ]),
  )
  expect(parsed.redactedFindings.length).toBeGreaterThanOrEqual(1)
})

test("trajectory bundle writes a data-only evidence manifest", async () => {
  const { workspace, exportPath } = await prepareTrace()
  const bundleDir = join(workspace, "artifacts", "bundle")
  const result = await runCli(["trajectory", "bundle", "--trace", exportPath, "--out", bundleDir])

  expect(result.success).toBe(true)
  expect(result.stderr).toBe("")

  const parsed = bundleOutputSchema.parse(parseJson(result.stdout))
  expect(parsed.bundleDir).toBe(bundleDir)
  expect(parsed.marketplaceReady).toBe(true)
  expect(parsed.eventCount).toBe(6)
  expect(existsSync(parsed.manifestPath)).toBe(true)
  expect(existsSync(parsed.tracePath)).toBe(true)

  const manifest = bundleManifestSchema.parse(parseJson(readFileSync(parsed.manifestPath, "utf8")))
  expect(manifest.trace.file).toBe("trace.atf.json")
  expect(manifest.trace.eventCount).toBe(6)
  expect(manifest.checks.marketplaceReady).toBe(true)
  expect(manifest.checks.requiredKindsPresent).toBe(true)
  expect(manifest.checks.redactionClean).toBe(true)
})

test("trajectory inspect rejects traces with unredacted secret markers", async () => {
  const { exportPath } = await prepareTrace()
  const trace = traceSchema.parse(parseJson(readFileSync(exportPath, "utf8")))

  writeFileSync(
    exportPath,
    JSON.stringify(
      {
        ...trace,
        events: trace.events.map((event) =>
          event.kind === "verification"
            ? { ...event, detail: "authorization bearer sentinel-secret" }
            : event,
        ),
      },
      null,
      2,
    ),
    "utf8",
  )

  const result = await runCli(["trajectory", "inspect", "--trace", exportPath, "--json"])
  expect(result.success).toBe(false)
  expect(result.stderr).toContain("unredacted_secret")
})

test("trajectory bundle rejects trace paths outside the repository", async () => {
  const workspace = createWorkspacePath()
  const tracePath = "/tmp/trajectory-marketplace-outside-root.json"
  const bundleDir = join(workspace, "artifacts", "unsafe-bundle")

  rmSync(tracePath, { force: true })
  writeFileSync(tracePath, JSON.stringify({ events: [] }), "utf8")

  const result = await runCli(["trajectory", "bundle", "--trace", tracePath, "--out", bundleDir])
  rmSync(tracePath, { force: true })

  expect(result.success).toBe(false)
  expect(result.stderr).toContain("invalid_trace_path")
  expect(existsSync(bundleDir)).toBe(false)
})

test("trajectory inspect rejects symlinked trace paths outside the repository", async () => {
  const { workspace, exportPath } = await prepareTrace()
  const outsideTracePath = "/tmp/trajectory-marketplace-symlink-trace.json"
  const symlinkedTracePath = join(workspace, "artifacts", "symlinked-trace.atf.json")

  rmSync(outsideTracePath, { force: true })
  writeFileSync(outsideTracePath, readFileSync(exportPath, "utf8"), "utf8")
  symlinkSync(outsideTracePath, symlinkedTracePath)

  const result = await runCli(["trajectory", "inspect", "--trace", symlinkedTracePath, "--json"])
  rmSync(outsideTracePath, { force: true })

  expect(result.success).toBe(false)
  expect(result.stderr).toContain("invalid_trace_path")
})

test("trajectory bundle rejects symlinked output directories outside the repository", async () => {
  const { workspace, exportPath } = await prepareTrace()
  const outsideBundleDir = "/tmp/trajectory-marketplace-symlink-bundle"
  const symlinkedBundleDir = join(workspace, "artifacts", "symlinked-bundle")

  rmSync(outsideBundleDir, { force: true, recursive: true })
  mkdirSync(outsideBundleDir, { recursive: true })
  symlinkSync(outsideBundleDir, symlinkedBundleDir, "dir")

  const result = await runCli([
    "trajectory",
    "bundle",
    "--trace",
    exportPath,
    "--out",
    symlinkedBundleDir,
  ])
  const manifestEscaped = existsSync(join(outsideBundleDir, "manifest.json"))
  rmSync(outsideBundleDir, { force: true, recursive: true })

  expect(result.success).toBe(false)
  expect(result.stderr).toContain("invalid_output_path")
  expect(manifestEscaped).toBe(false)
})

test("trajectory bundle preserves preexisting non-directory output targets", async () => {
  const { workspace, exportPath } = await prepareTrace()
  const outputPath = join(workspace, "README.md")
  const before = readFileSync(outputPath, "utf8")

  const result = await runCli(["trajectory", "bundle", "--trace", exportPath, "--out", outputPath])

  expect(result.success).toBe(false)
  expect(result.stderr).toContain("invalid_output_path")
  expect(readFileSync(outputPath, "utf8")).toBe(before)
})
