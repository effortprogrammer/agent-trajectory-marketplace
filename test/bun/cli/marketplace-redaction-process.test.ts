import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const localEntryText = (archive: Uint8Array, suffix: string): string => {
  const view = Buffer.from(archive);
  let offset = 0;
  while (view.readUInt32LE(offset) === 0x04034b50) {
    const size = view.readUInt32LE(offset + 18);
    const nameLength = view.readUInt16LE(offset + 26);
    const extraLength = view.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + nameLength + extraLength;
    const name = view.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    if (name.endsWith(suffix)) return view.subarray(dataStart, dataStart + size).toString("utf8");
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
  const output = join(root, "candidate.zip");
  writeFileSync(join(root, "session.atf.json"), JSON.stringify({
    runtime: "codex",
    status: "collected",
    formatVersion: 2,
    eventCount: 1,
    events: [{
      kind: "tool_call",
      name: "terminal",
      payload: { input: { authorization: bearer, command: inlineSecret, password } },
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
    const archivedText = localEntryText(readFileSync(output), ".atf.json");
    expect(archivedText).not.toContain(bearer);
    expect(archivedText).not.toContain(password);
    expect(archivedText).not.toContain(inlineSecret);
    expect(archivedText.match(/\[redacted\]/g)?.length).toBe(3);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
