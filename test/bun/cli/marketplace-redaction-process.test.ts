import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { datasetManifestSchema } from "../../../src/marketplace/archive-contract";

const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const localEntryBytes = (archive: Uint8Array, suffix: string): Uint8Array => {
  const view = Buffer.from(archive);
  let offset = 0;
  while (view.readUInt32LE(offset) === 0x04034b50) {
    const size = view.readUInt32LE(offset + 18);
    const nameLength = view.readUInt16LE(offset + 26);
    const extraLength = view.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + nameLength + extraLength;
    const name = view.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    if (name.endsWith(suffix)) return new Uint8Array(view.subarray(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  throw new Error(`missing ZIP entry ending in ${suffix}`);
};

test("candidate bundle CLI redacts credentials from archived ATF bytes", () => {
  // Given: an explicit valid ATF containing representative credential values.
  const root = mkdtempSync(join(tmpdir(), "trajectory-cli-redaction-"));
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
  const quotedJsonCredentialValue = "quotedJsonCredentialValueFinal9d7c4";
  const quotedJsonProjectValue = "quotedJsonProjectValueFinal9e8b5";
  const harmlessNeighborValue = "harmlessNeighborValueFinal9f9a6";
  const escapedJsonCredentialHead = "escapedJsonCredentialHeadFinal9a0b7";
  const escapedJsonCredentialTail = "escapedJsonCredentialTailFinal9b1c8";
  const escapedNeighborValue = "escapedNeighborValueFinal9c2d9";
  const escapedOuterCredentialValue = "escapedOuterCredentialValueFinal9d3e0";
  const escapedOuterProjectValue = "escapedOuterProjectValueFinal9e4f1";
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
  const output = join(root, "candidate.zip");
  writeFileSync(join(root, "session.atf.json"), JSON.stringify({
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
  try {
    // When: the real Bun CLI writes an explicit candidate dataset.
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        "src/cli/index.ts",
        "marketplace",
        "seller",
        "candidate",
        "bundle",
        "--root",
        root,
        "--out",
        output,
        "--trace",
        "session.atf.json",
      ],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });

    // Then: the command succeeds and its trace entry contains only redacted values.
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");
    const archive = readFileSync(output);
    const traceBytes = localEntryBytes(archive, ".atf.json");
    const archivedText = new TextDecoder().decode(traceBytes);
    const manifestBytes = localEntryBytes(archive, "dataset-manifest.json");
    const manifest = datasetManifestSchema.parse(JSON.parse(new TextDecoder().decode(manifestBytes)));
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
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
