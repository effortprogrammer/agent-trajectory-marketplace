import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { validateEscrowArchive } from "../src/registry/escrow-intake"
import { inspectTraceFile } from "../src/trajectory/evidence"
import { filterExistingTrace } from "../src/trajectory/privacy/retrofit"
import { createSellerPackage } from "../src/trajectory/seller-package"
import { buildEscrowDatasetArchive } from "./escrow-zip-fixtures"
import { noopPrivacyFilter, stampPrivacyForTest } from "./privacy-fixtures"
import { cleanupSellerWorkspaces, writeTraceFixture } from "./trajectory-seller-fixtures"

// The fail-closed privacy gate: collected traces without the ML privacy-pass
// stamp must be rejected at every surface — inspect, seller package, and
// escrow intake. Instrumented prototype traces stay exempt.

const collectedEvents = [
  { kind: "session_start", name: "s1", detail: "hermes 1.0" },
  { kind: "llm_call", name: "claude-sonnet-5", detail: "Working on it." },
  { kind: "tool_call", name: "run_tests", detail: "exit 0" },
]

const unstampedCollectedTrace = {
  runtime: "hermes",
  status: "collected",
  eventCount: collectedEvents.length,
  events: collectedEvents,
}

afterEach(cleanupSellerWorkspaces)

describe("privacy stamp gate", () => {
  test("inspect marks unstamped collected traces below marketplace-ready", () => {
    const { tracePath } = writeTraceFixture(unstampedCollectedTrace)
    const inspection = inspectTraceFile(tracePath)
    expect(inspection.checks.privacyFiltered).toBe(false)
    expect(inspection.marketplaceReady).toBe(false)
  })

  test("inspect accepts stamped collected traces and surfaces the stamp", () => {
    const { tracePath } = writeTraceFixture(stampPrivacyForTest(unstampedCollectedTrace))
    const inspection = inspectTraceFile(tracePath)
    expect(inspection.checks.privacyFiltered).toBe(true)
    expect(inspection.marketplaceReady).toBe(true)
    expect(inspection.privacy?.modelId).toBe("openai/privacy-filter")
  })

  test("instrumented prototype traces stay exempt from the stamp requirement", () => {
    const { tracePath } = writeTraceFixture({
      runtime: "python",
      status: "instrumented",
      eventCount: 5,
      events: [
        { kind: "function_enter", name: "run", detail: "start" },
        { kind: "function_exit", name: "run", detail: "end" },
        { kind: "llm_call", name: "model", detail: "call" },
        { kind: "tool_call", name: "tool", detail: "call" },
        { kind: "verification", name: "check", detail: "passed" },
      ],
    })
    const inspection = inspectTraceFile(tracePath)
    // Exempt status: the gate predicate is satisfied without a stamp.
    expect(inspection.checks.privacyFiltered).toBe(true)
    expect(inspection.marketplaceReady).toBe(true)
  })

  test("escrow intake fails closed for invented statuses without a stamp", () => {
    expect(() =>
      validateEscrowArchive({
        archive: buildEscrowDatasetArchive([
          {
            name: "traces/relabeled.atf.json",
            trace: { ...unstampedCollectedTrace, status: "definitely-not-collected" },
          },
        ]),
      }),
    ).toThrow("privacy_stamp_missing")
  })

  test("the retrofit filter stamps an existing unstamped trace into readiness", async () => {
    const { workspace, tracePath } = writeTraceFixture(unstampedCollectedTrace)
    const exportPath = join(workspace, "stamped.atf.json")
    const result = await filterExistingTrace(
      { tracePath, exportPath },
      { filter: noopPrivacyFilter },
    )
    expect(result.eventCount).toBe(collectedEvents.length)
    const inspection = inspectTraceFile(exportPath)
    expect(inspection.checks.privacyFiltered).toBe(true)
    expect(inspection.marketplaceReady).toBe(true)
  })

  test("seller package creation refuses unstamped collected traces", () => {
    const { workspace, tracePath } = writeTraceFixture(unstampedCollectedTrace)
    expect(() =>
      createSellerPackage({
        tracePath,
        outDir: join(workspace, "seller-package"),
        sellerId: "agent-local",
        title: "Unstamped trace",
      }),
    ).toThrow("trace_not_marketplace_ready")
  })

  test("escrow report policy audits unstamped traces instead of failing", () => {
    const result = validateEscrowArchive({
      archive: buildEscrowDatasetArchive([
        { name: "traces/prestamp.atf.json", trace: unstampedCollectedTrace },
      ]),
      privacyStampPolicy: "report",
    })
    expect(result.privacyStampMissing).toEqual(["traces/prestamp.atf.json"])
    expect(result.totalEventCount).toBe(collectedEvents.length)
  })

  test("escrow intake rejects archives carrying unstamped collected traces", () => {
    expect(() =>
      validateEscrowArchive({
        archive: buildEscrowDatasetArchive([
          { name: "traces/unstamped.atf.json", trace: unstampedCollectedTrace },
        ]),
      }),
    ).toThrow("privacy_stamp_missing")
  })
})
