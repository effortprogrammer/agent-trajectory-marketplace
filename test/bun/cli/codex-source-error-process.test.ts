import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("collect export exposes a source failure reason without source text", async () => {
  const root = mkdtempSync(join(tmpdir(), "atm-codex-error-cli-"));
  const source = join(root, "rollout-error.jsonl");
  const raw = '{"type":"session_meta","payload":{"id":"synthetic"}}\n'
    + '{"type":"event_msg","payload":{"type":"user_message","message":"USER_SENTINEL"}}\n'
    + '{"type":"event_msg","PRIVATE_SENTINEL":';
  writeFileSync(source, raw);
  const child = Bun.spawn([
    process.execPath, resolve("src/cli/index.ts"), "collect", "export", "codex",
    "--source", root, "--session", source, "--export", join(root, "output.atf.json"),
  ], {
    stdout: "pipe", stderr: "pipe",
    env: { PATH: process.env.PATH ?? "", HOME: root },
    signal: AbortSignal.timeout(10_000),
  });
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    const value: unknown = JSON.parse(stderr);
    expect(value).toMatchObject({ error: "invalid_session", reason: "malformed_jsonl", sourceLine: 3 });
    expect(stderr).not.toContain("PRIVATE_SENTINEL");
    expect(readFileSync(source, "utf8")).toBe(raw);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await child.exited;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
