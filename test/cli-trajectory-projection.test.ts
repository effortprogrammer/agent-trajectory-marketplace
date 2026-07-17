import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"

import {
  openInferenceProjectionSchema,
  trajectoryProjectionManifestSchema,
  trajectoryProjectionProfiles,
} from "../src/trajectory/projections"

const exportResultSchema = z
  .object({
    profile: z.enum(["otel-genai", "openinference"]),
    profileVersion: z.string(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sourceFormatVersion: z.union([z.literal(1), z.literal(2)]),
    eventCount: z.number().int().nonnegative(),
    projectionPath: z.string(),
    manifestPath: z.string(),
    projectionSha256: z.string().regex(/^[a-f0-9]{64}$/),
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

const workspaces: string[] = []

afterEach(() => {
  while (workspaces.length > 0) {
    const workspace = workspaces.pop()
    if (workspace !== undefined) rmSync(workspace, { force: true, recursive: true })
  }
})

const inheritedEnvironment = (): Record<string, string> => {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  return env
}

const runCli = async (args: readonly string[]) => {
  const child = Bun.spawn({
    cmd: [process.execPath, "src/cli/index.ts", ...args],
    cwd: process.cwd(),
    env: { ...inheritedEnvironment(), LANG: "en_US.UTF-8" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { success: exitCode === 0, exitCode, stdout: stdout.trim(), stderr: stderr.trim() }
}

const createWorkspace = (): string => {
  const root = join(process.cwd(), ".tmp")
  mkdirSync(root, { recursive: true })
  const workspace = mkdtempSync(join(root, "trajectory-projection-"))
  workspaces.push(workspace)
  return workspace
}

const writeCanonicalV2 = (workspace: string): string => {
  const tracePath = join(workspace, "canonical.atf.json")
  writeFileSync(
    tracePath,
    JSON.stringify({
      runtime: "PRIVATE_RUNTIME_SENTINEL",
      status: "collected",
      formatVersion: 2,
      eventCount: 2,
      events: [
        {
          kind: "llm_call",
          name: "PRIVATE_MODEL_SENTINEL",
          detail: "PRIVATE_DETAIL_SENTINEL",
          payload: {
            content: "PRIVATE_PROMPT_SENTINEL",
            usage: { model: "PRIVATE_MODEL_SENTINEL", inputTokens: 8, outputTokens: 3 },
          },
        },
        {
          kind: "tool_call",
          name: "PRIVATE_TOOL_SENTINEL",
          detail: "PRIVATE_DETAIL_SENTINEL",
          payload: { toolUseId: "PRIVATE_LINK_SENTINEL", input: { value: "private" } },
        },
      ],
    }),
    "utf8",
  )
  return tracePath
}

test("exports OpenInference with mapping manifest", async () => {
  // Given: a local canonical ATF file and an empty local output directory.
  const workspace = createWorkspace()
  const tracePath = writeCanonicalV2(workspace)
  const outDir = join(workspace, "projection")

  // When: the real CLI export surface is invoked.
  const result = await runCli([
    "trajectory",
    "projection",
    "export",
    "openinference",
    "--trace",
    tracePath,
    "--out",
    outDir,
  ])

  // Then: stdout is a content-free receipt and both local documents parse.
  expect(result.success).toBe(true)
  expect(result.stderr).toBe("")
  const receipt = exportResultSchema.parse(JSON.parse(result.stdout))
  expect(receipt.profileVersion).toBe(
    trajectoryProjectionProfiles.openInference.specificationVersion,
  )
  const projectionText = readFileSync(receipt.projectionPath, "utf8")
  const manifestText = readFileSync(receipt.manifestPath, "utf8")
  expect(openInferenceProjectionSchema.parse(JSON.parse(projectionText)).spans).toHaveLength(2)
  expect(trajectoryProjectionManifestSchema.parse(JSON.parse(manifestText)).events).toHaveLength(2)
  for (const forbidden of [
    "PRIVATE_RUNTIME_SENTINEL",
    "PRIVATE_MODEL_SENTINEL",
    "PRIVATE_DETAIL_SENTINEL",
    "PRIVATE_PROMPT_SENTINEL",
    "PRIVATE_TOOL_SENTINEL",
    "PRIVATE_LINK_SENTINEL",
  ]) {
    expect(result.stdout).not.toContain(forbidden)
    expect(projectionText).not.toContain(forbidden)
    expect(manifestText).not.toContain(forbidden)
  }
})

test("replaces stale files with a deterministic rerun", async () => {
  // Given: one successful export whose two target files are later corrupted with stale text.
  const workspace = createWorkspace()
  const tracePath = writeCanonicalV2(workspace)
  const outDir = join(workspace, "projection")
  const args = [
    "trajectory",
    "projection",
    "export",
    "otel-genai",
    "--trace",
    tracePath,
    "--out",
    outDir,
  ] as const
  const first = exportResultSchema.parse(JSON.parse((await runCli(args)).stdout))
  const firstProjection = readFileSync(first.projectionPath, "utf8")
  const firstManifest = readFileSync(first.manifestPath, "utf8")
  writeFileSync(first.projectionPath, "STALE_PROJECTION_SENTINEL", "utf8")
  writeFileSync(first.manifestPath, "STALE_MANIFEST_SENTINEL", "utf8")

  // When: the identical export is run again.
  const rerun = await runCli(args)

  // Then: fixed local targets are replaced byte-for-byte with deterministic output.
  expect(rerun.success).toBe(true)
  const second = exportResultSchema.parse(JSON.parse(rerun.stdout))
  expect(readFileSync(second.projectionPath, "utf8")).toBe(firstProjection)
  expect(readFileSync(second.manifestPath, "utf8")).toBe(firstManifest)
  expect(second.projectionSha256).toBe(first.projectionSha256)
  expect(second.manifestSha256).toBe(first.manifestSha256)
})

test("rejects import and network destination configuration", async () => {
  // Given: a valid local source plus collector, network, import, and destination options.
  const workspace = createWorkspace()
  const tracePath = writeCanonicalV2(workspace)
  const outDir = join(workspace, "projection")
  const forbiddenOptions = [
    ["--destination", "https://collector.invalid/v1/traces"],
    ["--collector", "127.0.0.1:4318"],
    ["--network", "otlp-http"],
    ["--import", "otlp"],
  ] as const

  // When: each forbidden runtime configuration is sent to the real CLI surface.
  const results = await Promise.all(
    forbiddenOptions.map((option) =>
      runCli([
        "trajectory",
        "projection",
        "export",
        "otel-genai",
        "--trace",
        tracePath,
        "--out",
        outDir,
        ...option,
      ]),
    ),
  )

  // Then: Commander rejects every option before files or network behavior exist.
  for (const result of results) {
    expect(result.success).toBe(false)
    expect(result.stderr).toContain("unknown option")
  }
  expect(existsSync(outDir)).toBe(false)
})

test("rejects malformed local input without content leakage", async () => {
  // Given: malformed local JSON containing a private sentinel.
  const workspace = createWorkspace()
  const tracePath = join(workspace, "malformed.atf.json")
  const outDir = join(workspace, "projection")
  writeFileSync(tracePath, '{"runtime":"PRIVATE_MALFORMED_SENTINEL"', "utf8")

  // When: the real CLI export surface reads it.
  const result = await runCli([
    "trajectory",
    "projection",
    "export",
    "openinference",
    "--trace",
    tracePath,
    "--out",
    outDir,
  ])

  // Then: the bounded parser error is returned and no output is created.
  expect(result.success).toBe(false)
  expect(result.stderr).toContain("invalid_atf_json")
  expect(result.stderr).not.toContain("PRIVATE_MALFORMED_SENTINEL")
  expect(existsSync(outDir)).toBe(false)
})

test("rejects non-local source URLs", async () => {
  // Given: an HTTP URL where a canonical local file path is required.
  const workspace = createWorkspace()
  const outDir = join(workspace, "projection")

  // When: the URL is passed as the trace input.
  const result = await runCli([
    "trajectory",
    "projection",
    "export",
    "otel-genai",
    "--trace",
    "https://127.0.0.1:4318/private.atf.json",
    "--out",
    outDir,
  ])

  // Then: it is rejected as a path before any output is created.
  expect(result.success).toBe(false)
  expect(result.stderr).toContain("invalid_projection_source_path")
  expect(existsSync(outDir)).toBe(false)
})
