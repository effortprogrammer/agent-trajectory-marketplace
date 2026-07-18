import { describe, expect, test } from "bun:test"
import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"

import {
  createTrajectoryEvidenceRecord,
  trajectoryEvidenceClaimAuthorities,
  trajectoryEvidencePolicy,
} from "../src/trajectory/evidence-record"
import { trajectoryMetricIds } from "../src/trajectory/metrics"
import { normalizeAtfObservations } from "../src/trajectory/observation"

const archiveSha256 = "b".repeat(64)
const authoritativeClaims = {
  integrity: "satisfied",
  provenance: "satisfied",
  privacyRedaction: "satisfied",
} as const

const artifact = (artifactPath: string, document: unknown) => {
  const sourceBytes = Buffer.from(JSON.stringify(document), "utf8")
  return {
    artifactPath,
    artifactSha256: createHash("sha256").update(sourceBytes).digest("hex"),
    sourceBytes,
  }
}

const verificationFixture = (passed?: boolean) =>
  normalizeAtfObservations({
    archiveSha256,
    artifacts: [
      artifact("traces/verification.atf.json", {
        runtime: "PRIVATE_RUNTIME_SENTINEL",
        status: "collected",
        formatVersion: 2,
        eventCount: 1,
        events: [
          {
            kind: "verification",
            name: "PRIVATE_VERIFICATION_NAME",
            detail: "PRIVATE_VERIFICATION_DETAIL",
            payload: {
              label: "PRIVATE_VERIFICATION_LABEL",
              ...(passed === undefined ? {} : { passed }),
            },
          },
        ],
      }),
    ],
  })

const collectKeys = (value: unknown, keys: Set<string>): void => {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys)
    return
  }
  if (value === null || typeof value !== "object") return
  for (const [key, child] of Object.entries(value)) {
    keys.add(key)
    collectKeys(child, keys)
  }
}

const captureError = (action: () => unknown): Error => {
  try {
    action()
  } catch (error) {
    if (error instanceof Error) return error
    throw error
  }
  throw new TypeError("expected an error")
}

describe("trajectory evidence record", () => {
  test("does not publish verification claims", () => {
    // Given: a source-labelled verification event with no payload.passed attestation.
    const normalized = verificationFixture()

    // When: the marketplace derives a content-free evidence record.
    const record = createTrajectoryEvidenceRecord({
      observationSet: normalized,
      computedAt: "2026-07-16T01:00:00.000Z",
      authoritativeClaims,
    })

    // Then: verification events remain raw input only and do not become evidence claims.
    expect(record.claims.map(({ id }) => id)).toEqual([
      "integrity",
      "provenance",
      "privacy_redaction",
    ])
    expect(JSON.stringify(record)).not.toContain("verification_label")
    expect(JSON.stringify(record)).not.toContain("verification_passed")
    expect(JSON.stringify(record)).not.toContain("PRIVATE_VERIFICATION_LABEL")
  })

  test("excludes computedAt from deterministic evidence identity", () => {
    // Given: identical normalized observations and claims with different wall-clock timestamps.
    const normalized = verificationFixture(true)

    // When: evidence is derived at two different computedAt values.
    const first = createTrajectoryEvidenceRecord({
      observationSet: normalized,
      computedAt: "2026-07-16T01:00:00.000Z",
      authoritativeClaims,
    })
    const second = createTrajectoryEvidenceRecord({
      observationSet: normalized,
      computedAt: "2026-07-16T02:00:00.000Z",
      authoritativeClaims,
    })

    // Then: wall-clock display differs while all deterministic commitments remain identical.
    expect(first.computedAt).not.toBe(second.computedAt)
    expect(first.derivationHash).toBe(second.derivationHash)
    expect(first.metrics.derivationHash).toBe(second.metrics.derivationHash)
    expect(first.source?.sourceSetCommitment).toBe(second.source?.sourceSetCommitment)
    expect(first.derivationHash).toMatch(/^sha256:[a-f0-9]{16}$/)
  })

  test("assigns authority only to the party that established each claim", () => {
    // Given: one available adapter/seller passed attestation and authoritative intake checks.
    const normalized = verificationFixture(true)

    // When: claims are derived.
    const record = createTrajectoryEvidenceRecord({
      observationSet: normalized,
      computedAt: "2026-07-16T03:00:00.000Z",
      authoritativeClaims,
    })

    // Then: only marketplace-authoritative claims remain public.
    expect(record.claims.map(({ id, authority, status }) => ({ id, authority, status }))).toEqual([
      {
        id: "integrity",
        authority: trajectoryEvidenceClaimAuthorities.marketplaceAuthoritative,
        status: "satisfied",
      },
      {
        id: "provenance",
        authority: trajectoryEvidenceClaimAuthorities.marketplaceAuthoritative,
        status: "satisfied",
      },
      {
        id: "privacy_redaction",
        authority: trajectoryEvidenceClaimAuthorities.marketplaceAuthoritative,
        status: "satisfied",
      },
    ])
  })

  test("serializes only bounded content-free evidence", () => {
    // Given: canonical source bytes containing forbidden content-bearing fields and values.
    const source = artifact("traces/private-path.atf.json", {
      runtime: "PRIVATE_RUNTIME",
      status: "collected",
      formatVersion: 2,
      eventCount: 2,
      events: [
        {
          kind: "tool_call",
          name: "PRIVATE_TOOL",
          detail: "PRIVATE_DETAIL",
          payload: { toolUseId: "private-link", input: { command: "PRIVATE_INPUT" } },
        },
        {
          kind: "tool_result",
          name: "PRIVATE_TOOL",
          detail: "PRIVATE_STDOUT",
          payload: {
            toolUseId: "private-link",
            isError: false,
            output: "PRIVATE_OUTPUT_STDERR",
          },
        },
      ],
    })
    const normalized = normalizeAtfObservations({ archiveSha256, artifacts: [source] })

    // When: the content-free record is serialized directly.
    const record = createTrajectoryEvidenceRecord({
      observationSet: normalized,
      computedAt: "2026-07-16T04:00:00.000Z",
      authoritativeClaims,
    })
    const serialized = JSON.stringify(record)
    const keys = new Set<string>()
    collectKeys(record, keys)

    // Then: only bounded aggregate keys and truncated commitments survive.
    for (const forbiddenKey of ["detail", "input", "output", "stdout", "stderr", "payload"]) {
      expect(keys.has(forbiddenKey)).toBe(false)
    }
    for (const forbiddenValue of [
      "PRIVATE_RUNTIME",
      "PRIVATE_TOOL",
      "PRIVATE_DETAIL",
      "PRIVATE_INPUT",
      "PRIVATE_OUTPUT_STDERR",
      "traces/private-path.atf.json",
      archiveSha256,
      source.artifactSha256,
    ]) {
      expect(serialized).not.toContain(forbiddenValue)
    }
    expect(serialized).not.toMatch(/\b[a-f0-9]{64}\b/)
    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(
      trajectoryEvidencePolicy.maxSerializedBytes,
    )
    expect(record.claims.length).toBeLessThanOrEqual(trajectoryEvidencePolicy.maxClaims)
    expect(record.limitations.length).toBeLessThanOrEqual(trajectoryEvidencePolicy.maxLimitations)
  })

  test("represents unavailable source coverage without false zero values", () => {
    // Given: an evidence derivation whose normalized source is explicitly unavailable.
    const input = {
      computedAt: "2026-07-16T05:00:00.000Z",
      coverage: {
        status: "unavailable",
        reason: "normalized_observations_unavailable",
      },
      authoritativeClaims: {
        integrity: "unavailable",
        provenance: "unavailable",
        privacyRedaction: "unavailable",
      },
    } as const

    // When: the record is created without fabricating an empty observation set.
    const record = createTrajectoryEvidenceRecord(input)

    // Then: source/count fields and metric values are absent, with explicit limitations.
    expect(record.availability).toBe("unavailable")
    expect(Object.hasOwn(record, "source")).toBe(false)
    expect(record.limitations).toContain("analysis_coverage_unavailable")
    for (const result of record.metrics.results) {
      expect(result.status).toBe("unavailable")
      expect(Object.hasOwn(result, "values")).toBe(false)
    }
    expect(JSON.stringify(record)).not.toContain('"value":0')
    expect(JSON.stringify(record)).not.toContain(":false")
  })

  test("propagates malformed function nesting without fabricating depth", () => {
    // Given: a trace with one known depth-one span and one orphan exit.
    const normalized = normalizeAtfObservations({
      archiveSha256,
      artifacts: [
        artifact("traces/unbalanced-depth.atf.json", {
          runtime: "PRIVATE_RUNTIME",
          status: "instrumented",
          eventCount: 3,
          events: [
            { kind: "function_enter", name: "PRIVATE_FUNCTION", detail: "PRIVATE_ENTER" },
            { kind: "function_exit", name: "PRIVATE_FUNCTION", detail: "PRIVATE_EXIT" },
            { kind: "function_exit", name: "PRIVATE_ORPHAN", detail: "PRIVATE_ORPHAN" },
          ],
        }),
      ],
    })

    // When: the content-free evidence record is derived.
    const record = createTrajectoryEvidenceRecord({
      observationSet: normalized,
      computedAt: "2026-07-16T05:30:00.000Z",
      authoritativeClaims,
    })
    const depth = record.metrics.results.find(
      (result) => result.metricId === trajectoryMetricIds.maxFunctionDepth,
    )

    // Then: evidence is partial and publishes only the known lower bound.
    expect(record.availability).toBe("partial")
    expect(record.limitations).toContain("function_boundary_direction_unavailable")
    if (depth === undefined || depth.status !== "partial") {
      throw new TypeError("expected partial function depth")
    }
    expect(depth.values).toEqual([{ dimensions: [], value: 1 }])
    const serialized = JSON.stringify(record)
    expect(serialized).not.toContain("PRIVATE_FUNCTION")
    expect(serialized).not.toContain("PRIVATE_ORPHAN")
  })

  test("rejects malformed evidence input without echoing it", () => {
    // Given: an inconsistent normalized summary and a sensitive malformed timestamp.
    const normalized = verificationFixture(true)
    const malformed = {
      observationSet: {
        ...normalized,
        summary: { ...normalized.summary, observationCount: 0 },
      },
      computedAt: "PRIVATE_NOT_A_TIMESTAMP",
      authoritativeClaims,
    }

    // When: untrusted evidence input crosses the boundary.
    const error = captureError(() => createTrajectoryEvidenceRecord(malformed))

    // Then: the failure is bounded and contains no rejected source content.
    expect(error.message).toBe("invalid_trajectory_evidence_input")
    expect(error.message).not.toContain("PRIVATE_NOT_A_TIMESTAMP")
    expect(error.message).not.toContain("PRIVATE_VERIFICATION_DETAIL")
  })

  test("does not expose verification metrics downstream", () => {
    // Given: a source verification event.
    const record = createTrajectoryEvidenceRecord({
      observationSet: verificationFixture(true),
      computedAt: "2026-07-16T06:00:00.000Z",
      authoritativeClaims,
    })

    // When: a downstream read model inspects the stable metric IDs.
    const metricIds = record.metrics.results.map((result) => result.metricId)

    // Then: the read model receives no verification aggregate metrics.
    expect(metricIds).not.toContain("trajectory.verification.labels.total")
    expect(metricIds).not.toContain("trajectory.verification.passed.total")
    expect(metricIds).not.toContain("trajectory.verification.failed.total")
  })
})
