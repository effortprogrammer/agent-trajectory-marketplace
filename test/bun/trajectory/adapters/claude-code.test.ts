import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { claudeCodeAdapter } from "../../../../src/trajectory/adapters/claude-code";
import { TrajectoryAdapterError } from "../../../../src/trajectory/adapters/contract";

const timestamp = (seconds: number): string => `2026-07-18T12:34:${String(seconds).padStart(2, "0")}.000Z`;
const temporaryRoots: string[] = [];
const temporaryRoot = (prefix: string): string => {
  const root = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", prefix));
  temporaryRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const writeSession = (root: string, project: string, session: string, lines: readonly string[]): string => {
  const projectDir = join(root, project);
  mkdirSync(projectDir, { recursive: true });
  const sessionPath = join(projectDir, `${session}.jsonl`);
  writeFileSync(sessionPath, `${lines.join("\n")}\n`, "utf8");
  return sessionPath;
};

describe("native Claude Code JSONL adapter", () => {
  test("discovers nested project sessions newest-first and exposes the default tree", () => {
    const sourceDir = temporaryRoot("claude-source-");
    const older = writeSession(sourceDir, "repo-a", "older", [JSON.stringify({ type: "user", sessionId: "older", message: { content: "old" } })]);
    const newer = writeSession(sourceDir, "repo-b", "newer", [JSON.stringify({ type: "user", sessionId: "newer", message: { content: "new" } })]);
    utimesSync(older, new Date("2026-07-18T12:00:00Z"), new Date("2026-07-18T12:00:00Z"));
    utimesSync(newer, new Date("2026-07-18T13:00:00Z"), new Date("2026-07-18T13:00:00Z"));
    const refs = claudeCodeAdapter.listSessions(sourceDir);
    expect(refs.map((ref) => ref.sessionId)).toEqual(["newer", "older"]);
    expect(refs[0]?.projectDir).toBe("repo-b");
    expect(claudeCodeAdapter.defaultSourceDir()).toBe(join(homedir(), ".claude", "projects"));
  });

  test("maps native user, assistant, tool use, and tool result records with provenance", () => {
    const sourceDir = temporaryRoot("claude-session-");
    const sessionPath = writeSession(sourceDir, "repo", "sess-1", [
      JSON.stringify({ type: "user", sessionId: "sess-1", isMeta: true, message: { content: "meta-secret" } }),
      JSON.stringify({ type: "user", sessionId: "sess-1", timestamp: timestamp(1), cwd: "/repo", version: "1.0", gitBranch: "main", message: { id: "u1", content: "Fix bug" } }),
      JSON.stringify({ type: "assistant", sessionId: "sess-1", isSidechain: true, message: { id: "side", model: "claude-3", content: [{ type: "text", text: "sidechain-secret" }] } }),
      JSON.stringify({ type: "assistant", sessionId: "sess-1", timestamp: timestamp(2), message: { id: "a1", model: "claude-3", content: [{ type: "thinking", thinking: "private reasoning" }, { type: "text", text: "I will fix it" }, { type: "tool_use", id: "tool1", name: "Bash", input: { command: "API_KEY=abcdefghijklmnop" } }], usage: { input_tokens: 2, output_tokens: 3 } } }),
      JSON.stringify({ type: "user", sessionId: "sess-1", timestamp: timestamp(3), message: { content: [{ type: "tool_result", tool_use_id: "tool1", content: "done" }] } }),
    ]);
    const document = claudeCodeAdapter.convertSession({ sessionPath });
    const byKind = (kind: string) => document.events.filter((event) => event.kind === kind);
    expect(document.runtime).toBe("claude-code");
    expect(byKind("function_enter")[0]?.detail).toBe("Fix bug");
    expect(byKind("llm_call")[0]).toMatchObject({ name: "claude-3", sourceEventId: "claude-code:message:a1", timestamp: timestamp(2) });
    expect(byKind("tool_call")[0]).toMatchObject({ name: "Bash", sourceEventId: "claude-code:tool:tool1", parentSourceEventId: "claude-code:message:a1", timestamp: timestamp(2) });
    expect(byKind("tool_result")[0]).toMatchObject({ sourceEventId: "claude-code:result:tool1", parentSourceEventId: "claude-code:tool:tool1", timestamp: timestamp(3) });
    expect(JSON.stringify(document)).not.toContain("private reasoning");
    expect(JSON.stringify(document)).not.toContain("meta-secret");
    expect(JSON.stringify(document)).not.toContain("sidechain-secret");
    expect(JSON.stringify(document)).not.toContain("abcdefghijklmnop");
  });

  test("does not fall back to generic events-array fixtures", () => {
    // Given: a JSONL file that belongs to another adapter's generic contract.
    const sourceDir = temporaryRoot("claude-generic-");
    const sessionPath = writeSession(sourceDir, "repo", "generic", [JSON.stringify({ events: [{ kind: "user", name: "prompt", detail: "wrong format" }] })]);

    // When: the file is converted as a Claude Code transcript.
    const convert = () => claudeCodeAdapter.convertSession({ sessionPath });

    // Then: it is rejected instead of silently interpreting another schema.
    expect(convert).toThrow(TrajectoryAdapterError);
    expect(convert).toThrow(/no conversational records/);
  });

  test("skips malformed lines and rejects an unusable native session", () => {
    const sourceDir = temporaryRoot("claude-invalid-");
    const sessionPath = writeSession(sourceDir, "repo", "valid", ["{malformed", JSON.stringify({ type: "user", sessionId: "valid", message: { content: "ok" } })]);
    const unusablePath = writeSession(sourceDir, "repo", "unusable", [JSON.stringify({ type: "system", sessionId: "unusable" })]);
    const converted = claudeCodeAdapter.convertSession({ sessionPath });
    const convertUnusable = () => claudeCodeAdapter.convertSession({ sessionPath: unusablePath });
    expect(converted.eventCount).toBeGreaterThan(0);
    expect(convertUnusable).toThrow(TrajectoryAdapterError);
    expect(convertUnusable).toThrow(/no conversational records/);
  });
});
