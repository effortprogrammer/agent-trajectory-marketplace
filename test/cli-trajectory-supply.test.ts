import { describe, expect, test } from "bun:test"

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

  test("submits candidate proof and promotes it with full commitment terms", async () => {
    const candidate = await runCli([
      "trajectory",
      "marketplace",
      "seller",
      "candidate",
      "submit",
      "--registry",
      registryUrl(),
      "--api-key",
      "test-key",
      "--fixture",
      "test/fixtures/candidate-valid.json",
      "--json",
    ])
    expect(candidate.success).toBe(true)
    const submitted = supplyRecordResponseSchema.parse(parseJsonOutput(candidate.stdout)).supply
    expect(submitted.state).toBe("candidate")

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

  test("fails candidate submission when the commitment block omits the delivery SLA", async () => {
    const result = await runCli([
      "trajectory",
      "marketplace",
      "seller",
      "candidate",
      "submit",
      "--registry",
      registryUrl(),
      "--api-key",
      "test-key",
      "--fixture",
      "test/fixtures/candidate-missing-sla.json",
      "--json",
    ])
    expect(result.success).toBe(false)
    expect(result.stderr).toContain("deliverySlaHours")
  })

  test("fails candidate submission when proof exceeds the contract bounds", async () => {
    const result = await runCli([
      "trajectory",
      "marketplace",
      "seller",
      "candidate",
      "submit",
      "--registry",
      registryUrl(),
      "--api-key",
      "test-key",
      "--fixture",
      "test/fixtures/candidate-proof-oversized.json",
      "--json",
    ])
    expect(result.success).toBe(false)
  })

  test("fails candidate submission for binding-bid fields and unknown seller keys", async () => {
    const bindingBid = await runCli([
      "trajectory",
      "marketplace",
      "seller",
      "candidate",
      "submit",
      "--registry",
      registryUrl(),
      "--api-key",
      "test-key",
      "--fixture",
      "test/fixtures/candidate-binding-bid.json",
      "--json",
    ])
    expect(bindingBid.success).toBe(false)

    const wrongKey = await runCli([
      "trajectory",
      "marketplace",
      "seller",
      "candidate",
      "submit",
      "--registry",
      registryUrl(),
      "--api-key",
      "wrong-key",
      "--fixture",
      "test/fixtures/candidate-valid.json",
      "--json",
    ])
    expect(wrongKey.success).toBe(false)
    expect(wrongKey.stderr).toContain("unauthorized")
  })
})

describe("trajectory marketplace supply inspect CLI", () => {
  test("shows proof and state for a candidate without any download surface", async () => {
    const candidate = await runCli([
      "trajectory",
      "marketplace",
      "seller",
      "candidate",
      "submit",
      "--registry",
      registryUrl(),
      "--api-key",
      "test-key",
      "--fixture",
      "test/fixtures/candidate-valid.json",
      "--json",
    ])
    expect(candidate.success).toBe(true)
    const submitted = supplyRecordResponseSchema.parse(parseJsonOutput(candidate.stdout)).supply

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
