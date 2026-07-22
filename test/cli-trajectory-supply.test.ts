import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Command, CommanderError } from "commander"
import { z } from "zod"

import { registerMarketplaceCommand } from "../src/cli/marketplace"
import {
  supplyListResponseSchema,
  supplyRecordResponseSchema,
  supplyRecordSchema,
} from "../src/registry/supply-contract"
import { stampPrivacyForTest } from "./privacy-fixtures"
import { createRegistryApiHarness } from "./registry-api-fixtures"
import { runCli } from "./trajectory-seller-fixtures"

const harness = createRegistryApiHarness()

const registryUrl = () => harness.requireServer().baseUrl

const parseJsonOutput = (stdout: string): unknown => JSON.parse(stdout)

const escrowPublishOutputSchema = z
  .object({
    supply: supplyRecordSchema,
    archiveByteCount: z.number().int().positive(),
    artifactCount: z.number().int().positive(),
  })
  .strict()

const privateVersionSentinel = "PRIVATE_NORMALIZER_VERSION_SENTINEL"
const fullShaVersionCarrier = "f".repeat(64)

const withRegistrySqlite = (run: (sqlite: Database) => void): void => {
  const sqlite = new Database(harness.requireServer().config.dbPath, { strict: true })
  sqlite.run("PRAGMA busy_timeout = 5000")
  try {
    run(sqlite)
  } finally {
    sqlite.close()
  }
}

const poisonEvidenceVersionProfiles = (supplyId: string): void => {
  withRegistrySqlite((sqlite) => {
    sqlite
      .query<unknown, [string, string, string, string, string, string, string, string, string]>(
        `UPDATE marketplace_supply_evidence SET
          normalizer_version = ?,
          metric_set_version = ?,
          public_evidence_json = json_set(
            public_evidence_json,
            '$.normalizerVersion', ?,
            '$.metricSetVersion', ?
          ),
          internal_evidence_json = json_set(
            internal_evidence_json,
            '$.normalizerVersion', ?,
            '$.metricSetVersion', ?,
            '$.metrics.normalizerVersion', ?,
            '$.metrics.metricSetVersion', ?
          )
        WHERE supply_id = ?`,
      )
      .run(
        privateVersionSentinel,
        fullShaVersionCarrier,
        privateVersionSentinel,
        fullShaVersionCarrier,
        privateVersionSentinel,
        fullShaVersionCarrier,
        privateVersionSentinel,
        fullShaVersionCarrier,
        supplyId,
      )
  })
}

const forgePublicCountAndCommitment = (supplyId: string): void => {
  withRegistrySqlite((sqlite) => {
    sqlite
      .query<unknown, [string]>(
        `UPDATE marketplace_supply_evidence
        SET public_evidence_json = json_set(
          public_evidence_json,
          '$.metrics[0].values[0].value',
          999999,
          '$.derivationHash',
          'sha256:1111111111111111'
        )
        WHERE supply_id = ?`,
      )
      .run(supplyId)
  })
}

// Publish a candidate through the framed escrow command: a candidate JSON plus
// `traceCount` trace files bundled into the dataset archive.
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
      JSON.stringify(
        stampPrivacyForTest({
          runtime: "hermes",
          status: "collected",
          eventCount: 3,
          events: [
            { kind: "function_enter", name: "turn-1", detail: `Session ${index} ask.` },
            { kind: "llm_call", name: "claude-sonnet-5", detail: "Working on it." },
            { kind: "tool_call", name: "run_tests", detail: "exit 0" },
          ],
        }),
      ),
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
  test("omits the retired JSON-only candidate submit command from help", async () => {
    // Given: the real candidate command help surface.
    // When: the user asks which candidate publication commands are available.
    const help = await runCli(["trajectory", "marketplace", "seller", "candidate", "--help"])

    // Then: only the framed publish path is advertised.
    expect(help.success).toBe(true)
    expect(help.stdout).toContain("publish")
    expect(help.stdout).not.toContain("submit")
  })

  test("returns a typed unknown-command error for retired JSON-only candidate submit", async () => {
    // Given: the Commander tree used by the marketplace CLI.
    const command = new Command()
      .name("trajectory")
      .exitOverride()
      .configureOutput({ writeErr: () => {}, writeOut: () => {} })
    registerMarketplaceCommand(command)

    // When: a caller invokes the removed JSON-only command.
    const result = command.parseAsync(["marketplace", "seller", "candidate", "submit"], {
      from: "user",
    })

    // Then: Commander classifies the retired path as an unknown command.
    await expect(result).rejects.toBeInstanceOf(CommanderError)
    await expect(result).rejects.toMatchObject({
      code: "commander.unknownCommand",
      exitCode: 1,
    })
  })

  test("retires the wanted CLI command", async () => {
    const retired = await runCli(["trajectory", "marketplace", "wanted", "list"])
    expect(retired.success).toBe(false)
    expect(retired.stderr).toContain("unknown command")
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

  test("prints buyer-safe evidence for anonymous list and inspect", async () => {
    // Given: an evidence-backed supply record published through the real escrow CLI.
    const candidate = await publishCandidateCli("test-key")
    expect(candidate.success).toBe(true)
    const submitted = escrowPublishOutputSchema.parse(parseJsonOutput(candidate.stdout)).supply

    // When: the marketplace CLI browses anonymously through list and inspect.
    const listed = await runCli([
      "trajectory",
      "marketplace",
      "supply",
      "list",
      "--registry",
      registryUrl(),
      "--json",
    ])
    const inspected = await runCli([
      "trajectory",
      "marketplace",
      "supply",
      "inspect",
      submitted.supplyId,
      "--registry",
      registryUrl(),
      "--json",
    ])

    // Then: both strict client parsers print the same safe DTO without internal fields.
    expect(listed.success).toBe(true)
    expect(inspected.success).toBe(true)
    const listBody = supplyListResponseSchema.parse(parseJsonOutput(listed.stdout))
    const listedRecord = listBody.supply.find((record) => record.supplyId === submitted.supplyId)
    const inspectedRecord = supplyRecordResponseSchema.parse(
      parseJsonOutput(inspected.stdout),
    ).supply
    expect(listedRecord).toBeDefined()
    if (listedRecord === undefined) throw new Error("expected listed supply record")
    expect(listedRecord.evidence).toEqual(inspectedRecord.evidence)
    expect(inspectedRecord.evidence?.metrics.eventCount).toEqual({
      status: "available",
      count: 6,
    })
    expect(inspectedRecord.evidence?.commitment).toMatch(/^sha256:[a-f0-9]{16}$/)
    for (const forbidden of [
      "artifactPath",
      "computedAt",
      "derivationHash",
      "metricId",
      "sourceSetCommitment",
    ]) {
      expect(JSON.stringify(inspectedRecord.evidence)).not.toContain(forbidden)
    }
  })

  test("fails closed for poisoned evidence version carriers without printing them", async () => {
    // Given: an evidence-backed record whose persisted version fields carry private/full-SHA text.
    const candidate = await publishCandidateCli("test-key")
    expect(candidate.success).toBe(true)
    const submitted = escrowPublishOutputSchema.parse(parseJsonOutput(candidate.stdout)).supply
    poisonEvidenceVersionProfiles(submitted.supplyId)

    // When: anonymous CLI list and inspect traverse the real API/client parser path.
    const listed = await runCli([
      "trajectory",
      "marketplace",
      "supply",
      "list",
      "--registry",
      registryUrl(),
      "--json",
    ])
    const inspected = await runCli([
      "trajectory",
      "marketplace",
      "supply",
      "inspect",
      submitted.supplyId,
      "--registry",
      registryUrl(),
      "--json",
    ])

    // Then: both commands fail with bounded stderr and no carrier-bearing stdout.
    for (const result of [listed, inspected]) {
      expect(result.success).toBe(false)
      expect(result.stdout).toBe("")
      expect(result.stderr).toContain("internal_error: unknown registry failure")
      expect(result.stderr).not.toContain(privateVersionSentinel)
      expect(result.stderr).not.toContain(fullShaVersionCarrier)
    }
  })

  test("fails closed for forged evidence counts and commitments", async () => {
    // Given: schema-valid public count and commitment values disagree with authoritative rows.
    const candidate = await publishCandidateCli("test-key")
    expect(candidate.success).toBe(true)
    const submitted = escrowPublishOutputSchema.parse(parseJsonOutput(candidate.stdout)).supply
    forgePublicCountAndCommitment(submitted.supplyId)

    // When: anonymous CLI list and inspect traverse the real API/client parser path.
    const listed = await runCli([
      "trajectory",
      "marketplace",
      "supply",
      "list",
      "--registry",
      registryUrl(),
      "--json",
    ])
    const inspected = await runCli([
      "trajectory",
      "marketplace",
      "supply",
      "inspect",
      submitted.supplyId,
      "--registry",
      registryUrl(),
      "--json",
    ])

    // Then: neither command prints stale or forged JSON.
    for (const result of [listed, inspected]) {
      expect(result.success).toBe(false)
      expect(result.stdout).toBe("")
      expect(result.stderr).toContain("internal_error: unknown registry failure")
    }
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
