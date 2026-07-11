import { describe, expect, test } from "bun:test"
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  supplyRecordResponseSchema,
  wantedDatasetListResponseSchema,
  wantedDatasetResponseSchema,
} from "../src/registry/supply-contract"
import { createRegistryApiHarness } from "./registry-api-fixtures"
import { runCli } from "./trajectory-seller-fixtures"

const harness = createRegistryApiHarness()

const registryUrl = () => harness.requireServer().baseUrl

const parseJsonOutput = (stdout: string): unknown => JSON.parse(stdout)

// Publish a candidate through the escrow multipart command: a candidate JSON
// plus `traceCount` trace files bundled into the dataset archive.
const publishCandidateCli = async (
  apiKey: string,
  options: { candidateFixture?: string; traceCount?: number } = {},
) => {
  const workDir = mkdtempSync(join(tmpdir(), "cli-escrow-publish-"))
  const candidatePath = join(workDir, "candidate.json")
  copyFileSync(options.candidateFixture ?? "test/fixtures/candidate-valid.json", candidatePath)
  const traceArgs: string[] = []
  for (let index = 1; index <= (options.traceCount ?? 2); index += 1) {
    const tracePath = join(workDir, `session-${index}.atf.json`)
    writeFileSync(
      tracePath,
      JSON.stringify({
        runtime: "hermes",
        status: "collected",
        eventCount: 3,
        events: [
          { kind: "function_enter", name: "turn-1", detail: `Session ${index} ask.` },
          { kind: "llm_call", name: "claude-sonnet-5", detail: "Working on it." },
          { kind: "tool_call", name: "run_tests", detail: "exit 0" },
        ],
      }),
    )
    traceArgs.push("--trace", tracePath)
  }
  return runCli([
    "trajectory",
    "marketplace",
    "seller",
    "candidate",
    "publish",
    "--registry",
    registryUrl(),
    "--api-key",
    apiKey,
    "--candidate",
    candidatePath,
    ...traceArgs,
    "--json",
  ])
}

describe("trajectory marketplace supply CLI", () => {
  test("creates and lists wanted demand signals from the fixture", async () => {
    const created = await runCli([
      "trajectory",
      "marketplace",
      "wanted",
      "create",
      "--registry",
      registryUrl(),
      "--api-key",
      "buyer-smoke-key",
      "--fixture",
      "test/fixtures/wanted-dataset.json",
      "--json",
    ])
    expect(created.success).toBe(true)
    const wanted = wantedDatasetResponseSchema.parse(parseJsonOutput(created.stdout)).wanted
    expect(wanted.state).toBe("wanted")
    expect(wanted.requesterLabel).toMatch(/^buyer-[a-f0-9]{8}$/)
    // The demand signal is never inventory: no files, no price, no binding.
    expect(created.stdout).not.toContain("files")
    expect(created.stdout).not.toContain("downloadAllowed")

    const listed = await runCli([
      "trajectory",
      "marketplace",
      "wanted",
      "list",
      "--registry",
      registryUrl(),
      "--api-key",
      "buyer-smoke-key",
      "--json",
    ])
    expect(listed.success).toBe(true)
    const list = wantedDatasetListResponseSchema.parse(parseJsonOutput(listed.stdout))
    expect(list.wanted.map((record) => record.wantedId)).toContain(wanted.wantedId)
  })

  test("publishes an escrow candidate and promotes it with full commitment terms", async () => {
    const candidate = await publishCandidateCli("test-key")
    expect(candidate.success).toBe(true)
    const published = parseJsonOutput(candidate.stdout) as {
      supply: { supplyId: string; state: string }
    }
    expect(published.supply.state).toBe("candidate")
    const submitted = published.supply

    const committed = await runCli([
      "trajectory",
      "marketplace",
      "seller",
      "commitment",
      "submit",
      "--registry",
      registryUrl(),
      "--api-key",
      "test-key",
      "--fixture",
      "test/fixtures/commitment-valid.json",
      "--supply-id",
      submitted.supplyId,
      "--json",
    ])
    expect(committed.success).toBe(true)
    const record = supplyRecordResponseSchema.parse(parseJsonOutput(committed.stdout)).supply
    expect(record.state).toBe("committed")
    if (record.state !== "committed") {
      throw new Error("expected committed state")
    }
    expect(record.terms.deliverySlaHours).toBe(168)
    expect(record.commitmentId).toMatch(/^commitment-[a-f0-9]{16}$/)
  })

  test("fails escrow publish for binding-bid fields and unknown seller keys", async () => {
    // A candidate part with binding-bid/auction fields is rejected by the
    // strict candidate schema at intake.
    const bindingBid = await publishCandidateCli("test-key", {
      candidateFixture: "test/fixtures/candidate-binding-bid.json",
    })
    expect(bindingBid.success).toBe(false)

    // An unknown seller key fails closed with unauthorized.
    const wrongKey = await publishCandidateCli("wrong-key")
    expect(wrongKey.success).toBe(false)
    expect(wrongKey.stderr).toContain("unauthorized")
  })
})

describe("trajectory marketplace supply inspect CLI", () => {
  test("shows proof and state for a candidate without any download surface", async () => {
    const candidate = await publishCandidateCli("test-key")
    expect(candidate.success).toBe(true)
    const submitted = (parseJsonOutput(candidate.stdout) as { supply: { supplyId: string } }).supply

    const inspected = await runCli([
      "trajectory",
      "marketplace",
      "supply",
      "inspect",
      submitted.supplyId,
      "--registry",
      registryUrl(),
      "--api-key",
      "buyer-smoke-key",
      "--json",
    ])
    expect(inspected.success).toBe(true)
    const record = supplyRecordResponseSchema.parse(parseJsonOutput(inspected.stdout)).supply
    expect(record.state).toBe("candidate")
    expect(record.proof.hashes).toHaveLength(2)
    // Metadata/proof/state only: no file names, download paths, or urls.
    for (const forbidden of ["files", "urlPath", "download", "trace.atf.json"] as const) {
      expect(inspected.stdout).not.toContain(forbidden)
    }

    const listed = await runCli([
      "trajectory",
      "marketplace",
      "supply",
      "list",
      "--registry",
      registryUrl(),
      "--api-key",
      "buyer-smoke-key",
      "--json",
    ])
    expect(listed.success).toBe(true)
    expect(listed.stdout).toContain(submitted.supplyId)
  })

  test("keeps the legacy marketplace inspect surface retired", async () => {
    const legacy = await runCli([
      "trajectory",
      "marketplace",
      "inspect",
      "listing-0123456789abcdef",
      "--registry",
      registryUrl(),
      "--api-key",
      "buyer-smoke-key",
      "--json",
    ])
    expect(legacy.success).toBe(false)
    expect(legacy.stderr).toContain("gone")
    expect(legacy.stdout).not.toContain("files")
  })
})
