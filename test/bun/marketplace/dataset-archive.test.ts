import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { writeCandidateBundle } from "../../../src/marketplace/bundle-service";
import { datasetManifestSchema } from "../../../src/marketplace/archive-contract";
import {
  buildDatasetArchive,
  inspectTraceAdmission,
} from "../../../src/marketplace/dataset-archive";
import { MarketplaceError } from "../../../src/marketplace/error";
import { fullSelectorSchema, traceHashSchema } from "../../../src/marketplace/session-contract";
import type { FrozenTrace } from "../../../src/marketplace/session-contract";
import { scanSessionSnapshot } from "../../../src/marketplace/session-snapshot";

const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const roots: string[] = [];

const fixtureRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "trajectory-bundle-service-"));
  roots.push(root);
  return root;
};

type UsageFixture = Readonly<{
  readonly attested?: boolean;
  readonly inputTokens?: number;
  readonly latencyMs?: number;
  readonly model?: string;
  readonly outputTokens?: number;
}>;

const atfWithUsage = (
  runtime: string,
  usages: readonly UsageFixture[],
): Uint8Array => new TextEncoder().encode(JSON.stringify({
  runtime,
  status: "collected",
  formatVersion: 2,
  eventCount: usages.length,
  events: usages.map((usage, index) => ({
    kind: "message",
    name: "assistant",
    ...(usage.attested === false
      ? {}
      : {
        timestamp: `2026-09-01T00:00:0${index}.000Z`,
        sourceEventId: `usage-${index}`,
      }),
    payload: {
      usage: {
        ...(usage.model === undefined ? {} : { model: usage.model }),
        ...(usage.inputTokens === undefined
          ? {}
          : { inputTokens: usage.inputTokens }),
        ...(usage.outputTokens === undefined
          ? {}
          : { outputTokens: usage.outputTokens }),
        ...(usage.latencyMs === undefined ? {} : { latencyMs: usage.latencyMs }),
      },
    },
  })),
}));

const validAtf = (runtime: string): Uint8Array => atfWithUsage(runtime, [{
  inputTokens: 2,
  model: "claude-fable-5",
  outputTokens: 1,
}]);

const usageFreeAtf = (runtime: string): Uint8Array => new TextEncoder().encode(
  JSON.stringify({ runtime, status: "collected", eventCount: 0, events: [] }),
);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const frozenTrace = (selectorHex: string, text: string): FrozenTrace => {
  const bytes = new TextEncoder().encode(text);
  return Object.freeze({
    selector: fullSelectorSchema.parse(`s-${selectorHex.padStart(64, "0")}`),
    relativePath: `native/${selectorHex}.atf.json`,
    hash: traceHashSchema.parse(digest(bytes)),
    byteCount: bytes.byteLength,
    runtime: "codex",
    eventCount: 0,
    earliestTimestamp: "unknown",
    get bytes(): Uint8Array {
      return new Uint8Array(bytes);
    },
  });
};

const localEntries = (archive: Uint8Array): ReadonlyMap<string, Uint8Array> => {
  const view = Buffer.from(archive);
  const entries = new Map<string, Uint8Array>();
  let offset = 0;
  while (view.readUInt32LE(offset) === 0x04034b50) {
    const size = view.readUInt32LE(offset + 18);
    const nameLength = view.readUInt16LE(offset + 26);
    const extraLength = view.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + nameLength + extraLength;
    const name = view.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    entries.set(name, new Uint8Array(view.subarray(dataStart, dataStart + size)));
    offset = dataStart + size;
  }
  return entries;
};

describe("selected trace dataset archive", () => {
  test("admits only source-attested compensated model usage", () => {
    // Given: supported, normalized, mixed, unsupported, unattributed, and usage-free traces.
    const supported = frozenTrace(
      "a1",
      new TextDecoder().decode(atfWithUsage("codex", [
        { inputTokens: 3, model: "claude-fable-5", outputTokens: 2 },
        { inputTokens: 5, model: "gpt-5.6-sol", outputTokens: 4 },
        { latencyMs: 9, model: "runtime-only" },
      ])),
    );
    const normalized = frozenTrace(
      "a2",
      new TextDecoder().decode(atfWithUsage("codex", [
        { inputTokens: 1, model: "  CLAUDE-FABLE-5  ", outputTokens: 0 },
      ])),
    );
    const invalid = [
      frozenTrace(
        "a3",
        new TextDecoder().decode(atfWithUsage("codex", [
          { inputTokens: 1, model: "claude-fable-5", outputTokens: 1 },
          { inputTokens: 1, model: "unsupported-model", outputTokens: 1 },
        ])),
      ),
      frozenTrace(
        "a4",
        new TextDecoder().decode(atfWithUsage("codex", [
          { inputTokens: 1, model: "unsupported-model", outputTokens: 1 },
        ])),
      ),
      frozenTrace(
        "a5",
        new TextDecoder().decode(atfWithUsage("codex", [
          { inputTokens: 1, outputTokens: 1 },
        ])),
      ),
      frozenTrace(
        "a6",
        new TextDecoder().decode(atfWithUsage("codex", [
          {
            attested: false,
            inputTokens: 1,
            model: "claude-fable-5",
            outputTokens: 1,
          },
        ])),
      ),
      frozenTrace("a7", new TextDecoder().decode(usageFreeAtf("codex"))),
    ] as const;

    // When: every trace is classified and independently assembled.
    const supportedArchives = [supported, normalized].map((trace) =>
      buildDatasetArchive([trace])
    );
    const blocked = invalid.map((trace) => inspectTraceAdmission(trace));
    const rejectedCodes = invalid.map((trace) => {
      try {
        buildDatasetArchive([trace]);
      } catch (error) {
        return error instanceof Error
            && "code" in error
            && typeof error.code === "string"
          ? error.code
          : error instanceof Error ? error.name : String(error);
      }
      return "admitted";
    });

    // Then: only traces fully attributable to compensated models can become ZIPs.
    expect(supportedArchives.every((archive) => archive.byteLength > 0)).toBe(
      true,
    );
    expect(blocked as unknown).toEqual(invalid.map(() => ({
      reason: "unsupported_model",
      status: "blocked",
    })));
    expect(rejectedCodes).toEqual(invalid.map(() => "unsupported_model"));
  });

  test("admits a latency-only companion when compensated usage is archive-wide", () => {
    // Given: one artifact with the selection's only positive source-attested compensated
    // usage, beside a standalone latency-only companion with no positive tokens.
    const attributed = frozenTrace(
      "b1",
      new TextDecoder().decode(atfWithUsage("codex", [
        { inputTokens: 3, model: "claude-fable-5", outputTokens: 2 },
      ])),
    )
    const latencyOnly = frozenTrace(
      "b2",
      new TextDecoder().decode(atfWithUsage("codex", [
        { latencyMs: 9, model: "runtime-only" },
      ])),
    )

    // When: the whole selection is assembled into one dataset archive.
    const archive = buildDatasetArchive([attributed, latencyOnly])

    // Then: the nonempty compensated-usage requirement is satisfied archive-wide,
    // so the latency-only companion is admitted as an artifact of the same archive.
    expect([...localEntries(archive).keys()]).toEqual([
      "dataset-manifest.json",
      `traces/${attributed.selector}.atf.json`,
      `traces/${latencyOnly.selector}.atf.json`,
    ])
  })

  test("stores unchanged credential-free bytes in opaque paths when input order differs", () => {
    // Given: selected frozen traces supplied in reverse selector order.
    const first = frozenTrace("1", new TextDecoder().decode(validAtf("codex")));
    const second = frozenTrace("2", new TextDecoder().decode(validAtf("opencode")));

    // When: the deterministic dataset archive is assembled.
    const archive = buildDatasetArchive([second, first]);

    // Then: only the manifest and sorted opaque trace entries contain the reviewed bytes.
    const entries = localEntries(archive);
    expect([...entries.keys()]).toEqual([
      "dataset-manifest.json",
      `traces/${first.selector}.atf.json`,
      `traces/${second.selector}.atf.json`,
    ]);
    expect(entries.get(`traces/${first.selector}.atf.json`)).toEqual(first.bytes);
    expect(entries.get(`traces/${second.selector}.atf.json`)).toEqual(second.bytes);
    expect(new TextDecoder().decode(entries.get("dataset-manifest.json"))).not.toContain("native/");
  });

  test("produces byte-identical archives for equivalent selected membership", () => {
    // Given: the same two frozen traces in opposite orders.
    const first = frozenTrace("3", new TextDecoder().decode(validAtf("codex")));
    const second = frozenTrace("4", new TextDecoder().decode(validAtf("opencode")));

    // When: each membership is independently assembled.
    const forward = buildDatasetArchive([first, second]);
    const reverse = buildDatasetArchive([second, first]);

    // Then: every ZIP byte is deterministic.
    expect(forward).toEqual(reverse);
  });

  test("removes credentials from archived traces before hashing the manifest", () => {
    // Given: a schema-valid reviewed trace that still contains credentials.
    const bearer = "Bearer verySensitiveCredentialValue123456";
    const password = "short-password";
    const inlineSecret = "API_KEY=short7";
    const standaloneToken = "token='tiny-token'";
    const shortBearerValue = "tinyBearer7";
    const shortBearer = `Authorization: Bearer ${shortBearerValue}`;
    const punctuationSuffix = "unctuationTail9!";
    const punctuatedPassword = `password=p@${punctuationSuffix}`;
    const credentialValue = "credentialObjectValue93e7";
    const credentialsValue = "credentialsObjectValue93e7";
    const pwdValue = "pwdObjectValue93e7";
    const cookieValue = "cookieObjectValue93e7";
    const inlineCredentialValue = "inlineCredentialValue93e7";
    const inlineCredentialsValue = "inlineCredentialsValue93e7";
    const inlinePwdValue = "inlinePwdValue93e7!";
    const inlineCookieValue = "inlineCookieValue93e7";
    const quotedCredentialValue = "quotedCredentialValue93e7";
    const quotedCredentialSuffix = "quotedCredentialSuffix93e7";
    const projectEqualsValue = "projectEqualsValue93e7";
    const projectColonValue = "projectColonValue93e7";
    const projectObjectValue = "projectObjectValue93e7";
    const quotedJsonCredentialValue = "quotedJsonCredentialValueFinal9a4f1";
    const quotedJsonProjectValue = "quotedJsonProjectValueFinal9b5e2";
    const harmlessNeighborValue = "harmlessNeighborValueFinal9c6d3";
    const escapedJsonCredentialHead = "escapedJsonCredentialHeadFinal9d7e4";
    const escapedJsonCredentialTail = "escapedJsonCredentialTailFinal9e8f5";
    const escapedNeighborValue = "escapedNeighborValueFinal9f9a6";
    const escapedOuterCredentialValue = "escapedOuterCredentialValueFinal9a0b7";
    const escapedOuterProjectValue = "escapedOuterProjectValueFinal9b1c8";
    const command = [
      inlineSecret,
      standaloneToken,
      shortBearer,
      punctuatedPassword,
      `credential=${inlineCredentialValue}`,
      `credentials:'${inlineCredentialsValue}'`,
      `pwd=${inlinePwdValue}`,
      `cookie="${inlineCookieValue}"`,
      `credential="${quotedCredentialValue}"${quotedCredentialSuffix}`,
      `sk-proj=${projectEqualsValue}`,
      `sk-proj:${projectColonValue}`,
      `{"credential":"${quotedJsonCredentialValue}","harmlessNeighbor":"${harmlessNeighborValue}"}`,
      `{'sk-proj':'${quotedJsonProjectValue}','harmlessNeighbor':'${harmlessNeighborValue}'}`,
      `{"credential":"${escapedJsonCredentialHead}\\\"${escapedJsonCredentialTail}","escapedNeighbor":"${escapedNeighborValue}"}`,
      `{\\"credential\\":\\"${escapedOuterCredentialValue}\\",\\"sk-proj\\":\\"${escapedOuterProjectValue}\\",\\"harmlessNeighbor\\":\\"${harmlessNeighborValue}\\"}`,
    ].join(" ");
    const numericApiKey = 314_159_265;
    const numericToken = 271_828_182;
    const projectApiKey = "sk-proj-abcdefghijklmnopqrstuvwx";
    const trace = frozenTrace("7", JSON.stringify({
      runtime: "codex",
      status: "collected",
      formatVersion: 2,
      eventCount: 1,
      events: [{
        kind: "tool_call",
        name: "terminal",
        timestamp: "2026-09-01T00:00:00.000Z",
        sourceEventId: "usage-0",
        payload: {
          input: {
            apiKey: numericApiKey,
            authorization: bearer,
            command: `${command} ${projectApiKey}`,
            cookie: cookieValue,
            credential: credentialValue,
            credentials: credentialsValue,
            nested: { token: numericToken },
            password,
            pwd: pwdValue,
            "sk-proj": projectObjectValue,
          },
          usage: {
            model: "claude-fable-5",
            inputTokens: 1,
            outputTokens: 1,
          },
        },
      }],
    }));

    // When: the reviewed trace becomes a candidate dataset archive.
    const entries = localEntries(buildDatasetArchive([trace]));
    const traceBytes = entries.get(`traces/${trace.selector}.atf.json`);
    const manifestBytes = entries.get("dataset-manifest.json");
    if (traceBytes === undefined || manifestBytes === undefined) {
      throw new Error("expected candidate archive entries");
    }
    const archivedText = new TextDecoder().decode(traceBytes);
    const manifest = datasetManifestSchema.parse(JSON.parse(new TextDecoder().decode(manifestBytes)));

    // Then: the ZIP contains only redacted ATF bytes and hashes those exact bytes.
    const rawMarkers = [
      bearer,
      password,
      inlineSecret,
      standaloneToken,
      shortBearerValue,
      punctuationSuffix,
      numericApiKey.toString(),
      numericToken.toString(),
      projectApiKey,
      credentialValue,
      credentialsValue,
      pwdValue,
      cookieValue,
      inlineCredentialValue,
      inlineCredentialsValue,
      inlinePwdValue,
      inlineCookieValue,
      quotedCredentialValue,
      quotedCredentialSuffix,
      projectEqualsValue,
      projectColonValue,
      projectObjectValue,
      quotedJsonCredentialValue,
      quotedJsonProjectValue,
      escapedJsonCredentialHead,
      escapedJsonCredentialTail,
      escapedOuterCredentialValue,
      escapedOuterProjectValue,
    ];
    expect(rawMarkers.filter((marker) => archivedText.includes(marker))).toEqual([]);
    expect(archivedText).toContain(`\\"harmlessNeighbor\\":\\"${harmlessNeighborValue}\\"`);
    expect(archivedText).toContain(`'harmlessNeighbor':'${harmlessNeighborValue}'`);
    expect(archivedText).toContain(escapedNeighborValue);
    expect(archivedText).toContain("[redacted]");
    expect(manifest.artifacts[0]?.sha256).toBe(digest(traceBytes));
    expect(manifest.artifacts[0]?.byteCount).toBe(traceBytes.byteLength);
  });

  test("rejects residual credential-like tokens after sanitization without rewriting benign credential-adjacent text", () => {
    // Given: sanitized ATF content with a GitHub fine-grained token that the redactor does not recognize,
    // and nearby instructional text that must remain publishable.
    const residual = `github_pat_${"a".repeat(82)}`;
    const unsafe = frozenTrace("8", JSON.stringify({
      runtime: "codex",
      status: "collected",
      formatVersion: 2,
      eventCount: 1,
      events: [{
        kind: "message",
        name: "assistant",
        timestamp: "2026-09-01T00:00:00.000Z",
        sourceEventId: "usage-0",
        payload: {
          content: residual,
          usage: {
            model: "claude-fable-5",
            inputTokens: 1,
            outputTokens: 1,
          },
        },
      }],
    }));
    const benign = frozenTrace("9", JSON.stringify({
      runtime: "codex",
      status: "collected",
      formatVersion: 2,
      eventCount: 1,
      events: [{
        kind: "message",
        name: "assistant",
        timestamp: "2026-09-01T00:00:00.000Z",
        sourceEventId: "usage-0",
        payload: {
          content: "Set GITHUB_TOKEN in your environment; never paste a token value.",
          usage: {
            model: "claude-fable-5",
            inputTokens: 1,
            outputTokens: 1,
          },
        },
      }],
    }));

    // When: candidate archives are assembled from the exact reviewed inputs.
    const reject = (): Buffer => buildDatasetArchive([unsafe]);
    const archive = buildDatasetArchive([benign]);

    // Then: the residual token fails closed while credential-adjacent prose stays unchanged.
    expect(reject).toThrow(new MarketplaceError("invalid_bundle_request"));
    expect(localEntries(archive).get(`traces/${benign.selector}.atf.json`)).toEqual(benign.bytes);
  });

  test("rejects empty, duplicate, and mutated frozen selections", () => {
    // Given: empty, duplicate, post-freeze mismatch, zero-byte, and over-limit memberships.
    const original = frozenTrace("5", new TextDecoder().decode(validAtf("codex")));
    const mutable = original.bytes;
    mutable[0] = 0;
    const mismatched = Object.freeze({ ...original, bytes: mutable });
    const overLimit = Array.from({ length: 101 }, (_, index) =>
      frozenTrace(index.toString(16), JSON.stringify({ index })),
    );
    const memberships = [[], [original, original], [mismatched], [frozenTrace("6", "")], overLimit];

    // When: each invalid membership is assembled.
    const actions = memberships.map((membership) => (): Buffer => buildDatasetArchive(membership));

    // Then: no invalid selection can become a ZIP.
    expect(actions[0]).toThrow(new MarketplaceError("empty_selection"));
    expect(actions[1]).toThrow(new MarketplaceError("duplicate_trace"));
    expect(actions[2]).toThrow(new MarketplaceError("trace_drift"));
    expect(actions[3]).toThrow(new MarketplaceError("invalid_bundle_request"));
    expect(actions[4]).toThrow(new MarketplaceError("invalid_bundle_request"));
  });

  test("rehashes only selected files immediately before output", () => {
    // Given: a reviewed snapshot, a later unrelated file, and a later selected-file mutation.
    const root = fixtureRoot();
    const selectedPath = join(root, "selected.atf.json");
    writeFileSync(selectedPath, validAtf("codex"));
    const snapshot = scanSessionSnapshot(root);
    writeFileSync(join(root, "new.atf.json"), validAtf("opencode"));
    const acceptedOutput = join(root, "accepted.zip");

    // When: the unchanged selection is written, then the reviewed file drifts before another write.
    const result = writeCandidateBundle(snapshot, snapshot.traces, acceptedOutput);
    writeFileSync(selectedPath, validAtf("claude-code"));
    const rejectedOutput = join(root, "rejected.zip");
    const drifted = (): void => {
      writeCandidateBundle(snapshot, snapshot.traces, rejectedOutput);
    };

    // Then: the new file is ignored, while selected drift prevents all output.
    expect(result.traceCount).toBe(1);
    expect(Bun.file(acceptedOutput).size).toBeGreaterThan(0);
    expect(drifted).toThrow(new MarketplaceError("trace_drift"));
    expect(Bun.file(rejectedOutput).size).toBe(0);
    expect(tempResidue(root)).toEqual([]);
  });
});

const tempResidue = (directory: string): readonly string[] =>
  Array.from(new Bun.Glob("*.trajectory-tmp-*").scanSync({ cwd: directory }));
