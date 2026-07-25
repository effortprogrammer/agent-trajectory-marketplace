import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
const decoder = new TextDecoder();
// allow: SIZE_OK — one embedded PTY lifecycle driver stays beside its process-boundary cases.
const pythonPtyDriver = `
import base64, errno, os, pty, select, signal, sys, time
initial, marker, delayed = [base64.b64decode(value) for value in sys.argv[1:4]]
signal_name = sys.argv[4]
pid, descriptor = pty.fork()
if pid == 0:
    os.execvp(sys.argv[5], sys.argv[5:])
if initial:
    os.write(descriptor, initial)
captured = b""
sent = False
terminal_closed = False
finished = 0
status = 0
deadline = time.monotonic() + 5
while time.monotonic() < deadline:
    if terminal_closed:
        select.select([], [], [], 0.01)
    else:
        readable, _, _ = select.select([descriptor], [], [], 0.1)
        if readable:
            try:
                data = os.read(descriptor, 4096)
            except OSError as error:
                if error.errno == errno.EIO:
                    terminal_closed = True
                else:
                    raise
            else:
                if not data:
                    terminal_closed = True
                else:
                    captured += data
                    os.write(1, data)
    if marker and not sent and marker in captured:
        if signal_name:
            os.kill(pid, getattr(signal, signal_name))
        elif delayed:
            os.write(descriptor, delayed)
        sent = True
    finished, status = os.waitpid(pid, os.WNOHANG)
    if finished != 0:
        break
if finished == 0:
    finished, status = os.waitpid(pid, os.WNOHANG)
if finished == 0:
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    _, status = os.waitpid(pid, 0)
    raise SystemExit(124)
raise SystemExit(os.waitstatus_to_exitcode(status))
`;

type PtySignal = "SIGINT" | "SIGTERM";

type PtyInteraction = Readonly<{
  readonly afterMarker?: string;
  readonly initialInput: string;
  readonly marker?: string;
  readonly signal?: PtySignal;
}>;

type PtyCommand = Readonly<{
  readonly argumentsList: readonly string[];
  readonly executable: string;
}>;

const fixtureRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "trajectory-bundle-cli-"));
  roots.push(root);
  return root;
};

const traceBytes = (runtime: string, request: string): Uint8Array => new TextEncoder().encode(JSON.stringify({
  runtime,
  status: "collected",
  formatVersion: 2,
  eventCount: 1,
  events: [{ kind: "function_enter", name: "turn", payload: { role: "user", content: request } }],
}));

const selectorFor = (relativePath: string): string =>
  `s-${createHash("sha256").update(relativePath).digest("hex")}`;

const runCli = (argumentsList: readonly string[]) => Bun.spawnSync(
  [process.execPath, "src/cli/index.ts", ...argumentsList],
  { cwd: process.cwd(), stderr: "pipe", stdin: "ignore", stdout: "pipe" },
);

const runPtyProcess = (command: PtyCommand, interaction: PtyInteraction) => Bun.spawnSync(
  [
    "python3", "-c", pythonPtyDriver,
    Buffer.from(interaction.initialInput).toString("base64"),
    Buffer.from(interaction.marker ?? "").toString("base64"),
    Buffer.from(interaction.afterMarker ?? "").toString("base64"),
    interaction.signal ?? "",
    command.executable, ...command.argumentsList,
  ],
  { cwd: process.cwd(), stderr: "pipe", stdout: "pipe" },
);

const runPtyCli = (argumentsList: readonly string[], input: string | PtyInteraction) => runPtyProcess(
  { executable: process.execPath, argumentsList: ["src/cli/index.ts", ...argumentsList] },
  typeof input === "string" ? { initialInput: input } : input,
);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("marketplace candidate bundle process boundary", () => {
  test("Given explicit root-relative traces, When non-TTY bundle runs, Then only exact selected bytes enter the ZIP", () => {
    // Given
    const root = fixtureRoot();
    mkdirSync(join(root, "nested"));
    const first = traceBytes("codex", "first");
    const second = traceBytes("claude-code", "second");
    writeFileSync(join(root, "a.atf.json"), first);
    writeFileSync(join(root, "nested", "b.atf.json"), second);
    writeFileSync(join(root, "unselected.atf.json"), traceBytes("opencode", "unselected"));
    const output = join(root, "candidate.zip");

    // When
    const result = runCli([
      "marketplace", "seller", "candidate", "bundle",
      "--root", root, "--out", output,
      "--trace", "a.atf.json", "--trace", "nested/b.atf.json",
    ]);

    // Then
    expect({
      exitCode: result.exitCode,
      stderr: decoder.decode(result.stderr),
      stdout: decoder.decode(result.stdout),
    }).toMatchObject({ exitCode: 0 });
    expect(decoder.decode(result.stderr)).toBe("");
    expect(existsSync(output)).toBe(true);
    const entries = Bun.spawnSync(["unzip", "-Z1", output], { stderr: "pipe", stdout: "pipe" });
    expect(entries.exitCode).toBe(0);
    expect(decoder.decode(entries.stdout).trim().split("\n")).toEqual([
      "dataset-manifest.json",
      `traces/${selectorFor("a.atf.json")}.atf.json`,
      `traces/${selectorFor("nested/b.atf.json")}.atf.json`,
    ].toSorted());
    const extracted = Bun.spawnSync(
      ["unzip", "-p", output, `traces/${selectorFor("a.atf.json")}.atf.json`],
      { stderr: "pipe", stdout: "pipe" },
    );
    expect(extracted.stdout).toEqual(Buffer.from(first));
  });

  test("Given a frozen interactive inventory, When inspect exclude receipts write and yes run in a PTY, Then only confirmed bytes enter the ZIP", () => {
    // Given
    const root = fixtureRoot();
    const first = traceBytes("codex", "first");
    const second = traceBytes("claude-code", "second");
    writeFileSync(join(root, "a.atf.json"), first);
    writeFileSync(join(root, "z.atf.json"), second);
    const output = join(root, "reviewed.zip");
    const included = selectorFor("a.atf.json");
    const excluded = selectorFor("z.atf.json");

    // When
    const result = runPtyCli(
      ["marketplace", "seller", "candidate", "bundle", "--root", root, "--out", output],
      `inspect ${included}\nexclude ${excluded}\nincluded\nexcluded\nwrite\nyes\n`,
    );

    // Then
    expect({
      exitCode: result.exitCode,
      stderr: decoder.decode(result.stderr),
      stdout: decoder.decode(result.stdout),
    }).toMatchObject({ exitCode: 0 });
    expect(existsSync(output)).toBe(true);
    const transcript = decoder.decode(result.stdout);
    expect(transcript).toContain(`selector: ${included}`);
    expect(transcript).toContain(`included: ${included}`);
    expect(transcript).toContain(`excluded: ${excluded}`);
    const entries = Bun.spawnSync(["unzip", "-Z1", output], { stdout: "pipe" });
    expect(decoder.decode(entries.stdout)).toContain(`traces/${included}.atf.json`);
    expect(decoder.decode(entries.stdout)).not.toContain(excluded);
  });

  test("Given non-TTY input without explicit traces, When bundle runs, Then it fails without inferring membership", () => {
    // Given
    const root = fixtureRoot();
    writeFileSync(join(root, "available.atf.json"), traceBytes("codex", "available"));
    const output = join(root, "implicit.zip");

    // When
    const result = runCli([
      "marketplace", "seller", "candidate", "bundle", "--root", root, "--out", output,
    ]);

    // Then
    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stdout)).toBe("");
    expect(decoder.decode(result.stderr)).toBe('{"error":"invalid_bundle_request"}\n');
    expect(existsSync(output)).toBe(false);
  });

  test("Given an interactive inventory, When review aborts, Then no ZIP or temporary output remains", () => {
    // Given
    const root = fixtureRoot();
    writeFileSync(join(root, "available.atf.json"), traceBytes("codex", "available"));
    const output = join(root, "aborted.zip");
    const selector = selectorFor("available.atf.json");

    // When
    const result = runPtyCli(
      ["marketplace", "seller", "candidate", "bundle", "--root", root, "--out", output],
      { afterMarker: "abort\n", initialInput: "included\n", marker: `included: ${selector}` },
    );

    // Then
    expect({
      exitCode: result.exitCode,
      stderr: decoder.decode(result.stderr),
      stdout: decoder.decode(result.stdout),
    }).toMatchObject({ exitCode: 0 });
    expect(existsSync(output)).toBe(false);
    expect(Array.from(new Bun.Glob("*.trajectory-tmp-*").scanSync({ cwd: root }))).toEqual([]);
  }, { timeout: 6_000 });

  test("Given every trace is excluded, When write is requested then review aborts, Then empty selection is recoverable and writes nothing", () => {
    // Given
    const root = fixtureRoot();
    writeFileSync(join(root, "available.atf.json"), traceBytes("codex", "available"));
    const output = join(root, "empty.zip");
    const selector = selectorFor("available.atf.json");

    // When
    const result = runPtyCli(
      ["marketplace", "seller", "candidate", "bundle", "--root", root, "--out", output],
      `exclude ${selector}\nwrite\nabort\n`,
    );

    // Then
    expect({
      exitCode: result.exitCode,
      stderr: decoder.decode(result.stderr),
      stdout: decoder.decode(result.stdout),
    }).toMatchObject({ exitCode: 0 });
    expect(decoder.decode(result.stdout)).toContain("error: empty_selection");
    expect(existsSync(output)).toBe(false);
  });

  test("Given unapproved reviews, When decline EOF and malformed input occur, Then every path leaves no output", () => {
    // Given
    const root = fixtureRoot();
    writeFileSync(join(root, "available.atf.json"), traceBytes("codex", "available"));
    const selector = selectorFor("available.atf.json");
    const cases = [
      { name: "declined", input: "write\nno\n", marker: '"status":"declined"' },
      {
        name: "eof",
        input: { afterMarker: "\u0004", initialInput: "included\n", marker: `included: ${selector}` },
        marker: '"status":"eof"',
      },
      { name: "invalid", input: "not-a-command\nabort\n", marker: "error: invalid_review_command" },
    ] as const;

    // When
    const results = cases.map(({ input, name }) => {
      const output = join(root, `${name}.zip`);
      return { output, result: runPtyCli([
        "marketplace", "seller", "candidate", "bundle", "--root", root, "--out", output,
      ], input) };
    });

    // Then
    expect(results.every(({ output }) => !existsSync(output))).toBe(true);
    expect(Array.from(new Bun.Glob("*.trajectory-tmp-*").scanSync({ cwd: root }))).toEqual([]);
    for (const [index, { result }] of results.entries()) {
      const marker = cases[index]?.marker ?? "unreachable";
      if (marker.length > 0) expect(decoder.decode(result.stdout)).toContain(marker);
    }
  });

  test("Given a valid startup exclusion, When review approves, Then the exclusion is applied before user input", () => {
    // Given
    const root = fixtureRoot();
    writeFileSync(join(root, "included.atf.json"), traceBytes("codex", "included"));
    writeFileSync(join(root, "excluded.atf.json"), traceBytes("claude-code", "excluded"));
    const excluded = selectorFor("excluded.atf.json");
    const output = join(root, "pre-excluded.zip");

    // When
    const result = runPtyCli([
      "marketplace", "seller", "candidate", "bundle", "--root", root, "--out", output,
      "--exclude", excluded,
    ], "excluded\nwrite\nyes\n");

    // Then
    expect(result.exitCode).toBe(0);
    expect(decoder.decode(result.stdout)).toContain(`excluded: ${excluded}`);
    const entries = Bun.spawnSync(["unzip", "-Z1", output], { stdout: "pipe" });
    expect(decoder.decode(entries.stdout)).not.toContain(excluded);
  });

  test("Given an existing user output, When explicit bundle runs, Then the file is preserved and no temp remains", () => {
    // Given
    const root = fixtureRoot();
    writeFileSync(join(root, "selected.atf.json"), traceBytes("codex", "selected"));
    const output = join(root, "existing.zip");
    writeFileSync(output, "preserve-user-bytes");

    // When
    const result = runCli([
      "marketplace", "seller", "candidate", "bundle", "--root", root, "--out", output,
      "--trace", "selected.atf.json",
    ]);

    // Then
    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toBe('{"error":"output_exists"}\n');
    expect(readFileSync(output, "utf8")).toBe("preserve-user-bytes");
    expect(Array.from(new Bun.Glob("*.trajectory-tmp-*").scanSync({ cwd: root }))).toEqual([]);
  });

  test.each(["SIGINT", "SIGTERM"] as const)("cancels marketplace review on %s", (signal) => {
    // Given
    const root = fixtureRoot();
    writeFileSync(join(root, "selected.atf.json"), traceBytes("codex", "selected"));
    const output = join(root, `${signal.toLowerCase()}.zip`);
    const selector = selectorFor("selected.atf.json");

    // When
    const result = runPtyCli(
      ["marketplace", "seller", "candidate", "bundle", "--root", root, "--out", output],
      { initialInput: "included\n", marker: `included: ${selector}`, signal },
    );

    // Then
    expect(result.exitCode).toBe(0);
    expect(decoder.decode(result.stdout)).toContain('{"status":"cancelled"}');
    expect(existsSync(output)).toBe(false);
    expect(Array.from(new Bun.Glob("*.trajectory-tmp-*").scanSync({ cwd: root }))).toEqual([]);
  });

  test("Given an unresponsive child, When the PTY deadline expires, Then it is killed and reaped", () => {
    // Given
    const startedAt = performance.now();

    // When
    const result = runPtyProcess(
      { executable: "python3", argumentsList: ["-c", "import time; time.sleep(30)"] },
      { initialInput: "" },
    );

    // Then
    expect(result.exitCode).toBe(124);
    expect(performance.now() - startedAt).toBeLessThan(6_000);
  }, { timeout: 6_000 });
});
