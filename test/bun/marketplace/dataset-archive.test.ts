import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { writeCandidateBundle } from "../../../src/marketplace/bundle-service";
import { datasetManifestSchema } from "../../../src/marketplace/archive-contract";
import { buildDatasetArchive } from "../../../src/marketplace/dataset-archive";
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

const validAtf = (runtime: string): Uint8Array => new TextEncoder().encode(
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
    const command = [
      inlineSecret,
      standaloneToken,
      shortBearer,
      punctuatedPassword,
      `credential=${inlineCredentialValue}`,
      `credentials:'${inlineCredentialsValue}'`,
      `pwd=${inlinePwdValue}`,
      `cookie="${inlineCookieValue}"`,
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
    ];
    expect(rawMarkers.filter((marker) => archivedText.includes(marker))).toEqual([]);
    expect(archivedText.match(/\[redacted\]/g)?.length).toBe(17);
    expect(manifest.artifacts[0]?.sha256).toBe(digest(traceBytes));
    expect(manifest.artifacts[0]?.byteCount).toBe(traceBytes.byteLength);
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
