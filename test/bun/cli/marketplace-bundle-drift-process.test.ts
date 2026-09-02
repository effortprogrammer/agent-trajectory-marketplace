import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
const decoder = new TextDecoder();
const transitionPtyDriver = `
import base64, os, pty, select, signal, sys, time
initial, marker, continuation = [base64.b64decode(value) for value in sys.argv[1:4]]
mode, path, replacement = sys.argv[4], sys.argv[5], base64.b64decode(sys.argv[6])
pid, descriptor = pty.fork()
if pid == 0:
    os.execvp(sys.argv[7], sys.argv[7:])
os.write(descriptor, initial)
captured = b""
transitioned = False
finished = 0
status = 0
deadline = time.monotonic() + 5
while time.monotonic() < deadline:
    readable, _, _ = select.select([descriptor], [], [], 0.1)
    if readable:
        try:
            data = os.read(descriptor, 4096)
        except OSError:
            break
        captured += data
        os.write(1, data)
    if not transitioned and marker in captured:
        if mode == "replace" or mode == "create":
            with open(path, "wb") as target:
                target.write(replacement)
        elif mode == "delete":
            os.unlink(path)
        os.write(descriptor, continuation)
        transitioned = True
    finished, status = os.waitpid(pid, os.WNOHANG)
    if finished != 0:
        break
if finished == 0:
    os.kill(pid, signal.SIGKILL)
    _, status = os.waitpid(pid, 0)
    if not transitioned:
        raise SystemExit(124)
raise SystemExit(os.waitstatus_to_exitcode(status))
`;

type TransitionMutation = Readonly<{
  readonly kind: "create" | "delete" | "none" | "replace";
  readonly path: string;
  readonly replacement?: Uint8Array;
}>;

type TransitionInput = Readonly<{
  readonly argumentsList: readonly string[];
  readonly initialInput: string;
  readonly marker: string;
  readonly continuationInput: string;
  readonly mutation: TransitionMutation;
}>;

const fixtureRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "trajectory-bundle-drift-"));
  roots.push(root);
  return root;
};

const traceBytes = (runtime: string): Uint8Array => new TextEncoder().encode(JSON.stringify({
  runtime,
  status: "collected",
  formatVersion: 2,
  eventCount: 1,
  events: [{
    kind: "message",
    name: "assistant",
    timestamp: "2026-09-01T00:00:00.000Z",
    sourceEventId: "usage-0",
    payload: {
      usage: {
        model: "claude-fable-5",
        inputTokens: 1,
        outputTokens: 1,
      },
    },
  }],
}));

const selectorFor = (relativePath: string): string =>
  `s-${createHash("sha256").update(relativePath).digest("hex")}`;

const runTransition = (input: TransitionInput) => Bun.spawnSync([
  "python3", "-c", transitionPtyDriver,
  Buffer.from(input.initialInput).toString("base64"),
  Buffer.from(input.marker).toString("base64"),
  Buffer.from(input.continuationInput).toString("base64"),
  input.mutation.kind,
  input.mutation.path,
  Buffer.from(input.mutation.replacement ?? new Uint8Array()).toString("base64"),
  process.execPath, "src/cli/index.ts", ...input.argumentsList,
], { cwd: process.cwd(), stderr: "pipe", stdout: "pipe" });

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("candidate bundle snapshot drift process boundary", () => {
  test("Given a frozen interactive snapshot, When a new trace appears before approval, Then it never enters the ZIP", () => {
    // Given
    const root = fixtureRoot();
    const originalPath = join(root, "original.atf.json");
    writeFileSync(originalPath, traceBytes("codex"));
    const output = join(root, "stable.zip");
    const originalSelector = selectorFor("original.atf.json");

    // When
    const result = runTransition({
      argumentsList: ["marketplace", "seller", "candidate", "bundle", "--root", root, "--out", output],
      initialInput: "included\n",
      marker: `included: ${originalSelector}`,
      continuationInput: "write\nyes\n",
      mutation: { kind: "create", path: join(root, "new.atf.json"), replacement: traceBytes("opencode") },
    });

    // Then
    expect(result.exitCode).toBe(0);
    expect(existsSync(output)).toBe(true);
    const entries = Bun.spawnSync(["unzip", "-Z1", output], { stdout: "pipe" });
    expect(decoder.decode(entries.stdout)).toContain(originalSelector);
    expect(decoder.decode(entries.stdout)).not.toContain(selectorFor("new.atf.json"));
  });

  test("Given selected frozen bytes, When the file mutates or disappears before approval, Then drift leaves no output", () => {
    // Given
    const cases = ["replace", "delete"] as const;

    // When
    const results = cases.map((kind) => {
      const root = fixtureRoot();
      const selectedPath = join(root, "selected.atf.json");
      writeFileSync(selectedPath, traceBytes("codex"));
      const output = join(root, `${kind}.zip`);
      const result = runTransition({
        argumentsList: ["marketplace", "seller", "candidate", "bundle", "--root", root, "--out", output],
        initialInput: "included\n",
        marker: `included: ${selectorFor("selected.atf.json")}`,
        continuationInput: "write\nyes\n",
        mutation: { kind, path: selectedPath, replacement: traceBytes("claude-code") },
      });
      return { output, result, root };
    });

    // Then
    expect(results.map(({ result }) => result.exitCode)).toEqual([1, 1]);
    expect(results.every(({ output }) => !existsSync(output))).toBe(true);
    expect(results.every(({ root }) =>
      Array.from(new Bun.Glob("*.trajectory-tmp-*").scanSync({ cwd: root })).length === 0,
    )).toBe(true);
    expect(results.map(({ result }) => decoder.decode(result.stdout))).toEqual([
      expect.stringContaining('{"error":"trace_drift"}'),
      expect.stringContaining('{"error":"trace_drift"}'),
    ]);
  });

  test("Given a live review, When repeated interrupts arrive after snapshot readiness, Then no output or temp survives", () => {
    // Given
    const root = fixtureRoot();
    writeFileSync(join(root, "selected.atf.json"), traceBytes("codex"));
    const output = join(root, "interrupted.zip");

    // When
    const result = runTransition({
      argumentsList: ["marketplace", "seller", "candidate", "bundle", "--root", root, "--out", output],
      initialInput: "included\n",
      marker: `included: ${selectorFor("selected.atf.json")}`,
      continuationInput: "\u0003\u0003",
      mutation: { kind: "none", path: "" },
    });

    // Then
    expect([0, 130, 137]).toContain(result.exitCode);
    expect(existsSync(output)).toBe(false);
    expect(Array.from(new Bun.Glob("*.trajectory-tmp-*").scanSync({ cwd: root }))).toEqual([]);
  });
});
