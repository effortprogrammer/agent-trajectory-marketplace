import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

const initOutputSchema = z.object({
  runtime: z.string(),
  workspace: z.string(),
  createdFiles: z.array(z.string()),
})

const demoOutputSchema = z.object({
  status: z.string(),
  exportPath: z.string(),
  sqlitePath: z.string(),
  targetResult: z.string(),
  eventCount: z.number(),
})

const traceEventSchema = z.object({
  kind: z.string(),
  name: z.string(),
  detail: z.string(),
})

const traceSchema = z.object({
  runtime: z.string(),
  status: z.string(),
  eventCount: z.number(),
  events: z.array(traceEventSchema),
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

const createWorkspacePath = () => {
  const parentDir = mkdtempSync(join(tmpdir(), "trajectory-marketplace-"))
  const workspace = join(parentDir, "workspace")
  workspaces.push(parentDir)
  return workspace
}

const inheritedEnvironment = () => {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value
    }
  }
  return env
}

const parseJson = (value: string): unknown => JSON.parse(value)

const runCli = async (args: readonly string[], env: Record<string, string> = {}) => {
  const result = Bun.spawn({
    cmd: [process.execPath, "src/cli/index.ts", ...args],
    cwd: process.cwd(),
    env: {
      ...inheritedEnvironment(),
      LANG: "en_US.UTF-8",
      ...env,
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
    exitCode,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  }
}

test("trajectory init hermes creates a prototype workspace", async () => {
  const workspace = createWorkspacePath()
  const result = await runCli(["trajectory", "init", "hermes", "--workspace", workspace])

  expect(result.success).toBe(true)
  expect(result.stderr).toBe("")

  const parsed = initOutputSchema.parse(parseJson(result.stdout))

  expect(parsed.runtime).toBe("hermes")
  expect(parsed.workspace).toBe(workspace)
  expect(parsed.createdFiles.length).toBeGreaterThan(0)

  expect(existsSync(join(workspace, "patterns", "hermes", "dev.yaml"))).toBe(true)
  expect(existsSync(join(workspace, "patterns", "hermes", "mismatch.yaml"))).toBe(true)
  expect(existsSync(join(workspace, "trajectory_collector", "bootstrap.py"))).toBe(true)
  expect(existsSync(join(workspace, "trajectory_collector", "core.py"))).toBe(true)
  expect(existsSync(join(workspace, "fixtures", "demo_target.py"))).toBe(true)
  expect(existsSync(join(workspace, "run_demo.py"))).toBe(true)
})

test("CLI help lists the trajectory command", async () => {
  const result = await runCli(["--help"])

  expect(result.success).toBe(true)
  expect(result.stdout).toContain("trajectory")
})

test("trajectory demo hermes exports an instrumented ATF trace", async () => {
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
  expect(demoResult.stderr).toBe("")

  const parsed = demoOutputSchema.parse(parseJson(demoResult.stdout))

  expect(parsed.status).toBe("instrumented")
  expect(parsed.exportPath).toBe(exportPath)

  const exported = traceSchema.parse(parseJson(readFileSync(exportPath, "utf8")))

  expect(exported.runtime).toBe("hermes")
  expect(exported.status).toBe("instrumented")
  expect(exported.events.map((event) => event.kind)).toEqual(
    expect.arrayContaining([
      "function_enter",
      "function_exit",
      "llm_call",
      "tool_call",
      "verification",
    ]),
  )

  const verificationEvent = exported.events.find((event) => event.kind === "verification")
  expect(verificationEvent?.detail).toBe("[redacted]")
})

test("trajectory demo hermes keeps the target run alive on pattern mismatch", async () => {
  const workspace = createWorkspacePath()
  const exportPath = join(workspace, "artifacts", "mismatch.atf.json")
  const patternPath = join(workspace, "patterns", "hermes", "mismatch.yaml")
  const happyExportPath = join(workspace, "artifacts", "trace.atf.json")

  const initResult = await runCli(["trajectory", "init", "hermes", "--workspace", workspace])
  expect(initResult.success).toBe(true)

  const happyResult = await runCli([
    "trajectory",
    "demo",
    "hermes",
    "--workspace",
    workspace,
    "--export",
    happyExportPath,
  ])
  expect(happyResult.success).toBe(true)

  const demoResult = await runCli([
    "trajectory",
    "demo",
    "hermes",
    "--workspace",
    workspace,
    "--pattern",
    patternPath,
    "--export",
    exportPath,
  ])

  expect(demoResult.success).toBe(true)
  expect(demoResult.stderr).toBe("")

  const parsed = demoOutputSchema.parse(parseJson(demoResult.stdout))

  expect(parsed.status).toBe("skipped_pattern_mismatch")
  expect(parsed.exportPath).toBe(exportPath)
  expect(parsed.targetResult).toBe("demo_target_completed")

  const exported = traceSchema.parse(parseJson(readFileSync(exportPath, "utf8")))

  expect(exported.status).toBe("skipped_pattern_mismatch")
  expect(exported.events).toHaveLength(0)
})

test("trajectory demo ignores a tampered workspace runner and does not leak inherited env", async () => {
  const workspace = createWorkspacePath()
  const exportPath = join(workspace, "artifacts", "trace.atf.json")

  const initResult = await runCli(["trajectory", "init", "hermes", "--workspace", workspace])
  expect(initResult.success).toBe(true)

  writeFileSync(
    join(workspace, "run_demo.py"),
    [
      "import json",
      "import os",
      "",
      'print(json.dumps({"status": "pwned", "targetResult": os.environ.get("REVIEW_SECRET", "")}))',
      "",
    ].join("\n"),
    "utf8",
  )

  const demoResult = await runCli(
    ["trajectory", "demo", "hermes", "--workspace", workspace, "--export", exportPath],
    { REVIEW_SECRET: "sentinel-secret" },
  )

  expect(demoResult.success).toBe(true)

  const parsed = demoOutputSchema.parse(parseJson(demoResult.stdout))

  expect(parsed.status).toBe("instrumented")
  expect(parsed.targetResult).toBe("demo_target_completed")
})

test("trajectory demo rejects export paths outside approved artifact roots", async () => {
  const workspace = createWorkspacePath()
  const exportPath = "/tmp/trajectory-marketplace-outside-root.json"

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

  expect(demoResult.success).toBe(false)
  expect(demoResult.stderr).toContain("invalid_export_path")
  expect(existsSync(exportPath)).toBe(false)
})

test("trajectory demo rejects invalid pattern module paths", async () => {
  const workspace = createWorkspacePath()
  const exportPath = join(workspace, "artifacts", "trace.atf.json")
  const patternPath = join(workspace, "patterns", "hermes", "dev.yaml")

  const initResult = await runCli(["trajectory", "init", "hermes", "--workspace", workspace])
  expect(initResult.success).toBe(true)

  writeFileSync(
    patternPath,
    ["runtime: hermes", "module: ../../../../tmp/pwned", "function: run_demo_task"].join("\n"),
    "utf8",
  )

  const demoResult = await runCli([
    "trajectory",
    "demo",
    "hermes",
    "--workspace",
    workspace,
    "--pattern",
    patternPath,
    "--export",
    exportPath,
  ])

  expect(demoResult.success).toBe(false)
  expect(demoResult.stderr).toContain("invalid_pattern_module")
  expect(existsSync("/tmp/pwned.py")).toBe(false)
})
