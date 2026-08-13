import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readStoredAuthSession, writeStoredAuthSession } from "../../../src/auth/store";
import { officialRegistryOrigin } from "../../../src/auth/official-origin";
import {
  officialGatewayProcessArguments,
  officialGatewayProcessEnvironment,
} from "../fixtures/gateway-process";

const roots: string[] = [];
const servers: Bun.Server<unknown>[] = [];
const token = "process-access-token-secret";
const accountId = "acct-0123456789abcdef";
const challengeId = "chal-0123456789abcdef";
const expiresAt = "2099-07-25T00:00:00.000Z";
const pythonPtyDriver = `
import base64, errno, os, pty, select, signal, sys, time
secret, marker, signal_name = [base64.b64decode(value) for value in sys.argv[1:4]]
pid, descriptor = pty.fork()
if pid == 0:
    os.execvp(sys.argv[4], sys.argv[4:])
captured = b""
sent = False
closed = False
finished = 0
status = 0
deadline = time.monotonic() + 5
while time.monotonic() < deadline:
    if closed:
        time.sleep(0.1)
    else:
        readable, _, _ = select.select([descriptor], [], [], 0.1)
        if readable:
            try:
                if os.environ.get("TRAJECTORY_TEST_PTY_NON_EIO") == "1":
                    raise OSError(errno.EBADF, "injected PTY read failure")
                if os.environ.get("TRAJECTORY_TEST_PTY_EIO") == "1":
                    raise OSError(errno.EIO, "injected PTY EOF")
                data = os.read(descriptor, 4096)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                closed = True
            else:
                captured += data
                os.write(1, data)
    if not sent and marker in captured:
        if signal_name:
            os.kill(pid, getattr(signal, signal_name.decode("ascii")))
        else:
            os.write(descriptor, secret)
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
    finished, status = os.waitpid(pid, 0)
    raise SystemExit(124)
raise SystemExit(os.waitstatus_to_exitcode(status))
`;

type CliResult = Readonly<{ readonly exitCode: number; readonly stderr: string; readonly stdout: string }>;
type CapturedRequest = Readonly<{ readonly authorization?: string; readonly body: unknown; readonly method: string; readonly path: string }>;

const fixtureRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "trajectory-auth-process-"));
  roots.push(root);
  return root;
};

const storePath = (root: string): string => join(root, "agent-trajectory-marketplace", "auth.json");

const json = (value: unknown, status = 200, headers: Readonly<Record<string, string>> = {}): Response =>
  Response.json(value, { headers, status });

const runCli = async (root: string, argumentsList: readonly string[], input?: string): Promise<CliResult> => {
  const serverIndex = argumentsList.indexOf("--server");
  const candidateTarget = serverIndex < 0 ? undefined : argumentsList[serverIndex + 1];
  const targetUrl = candidateTarget === undefined ? undefined : new URL(candidateTarget);
  const target = targetUrl?.hostname === "127.0.0.1" && targetUrl.pathname === "/"
    ? candidateTarget
    : undefined;
  const invocation = officialGatewayProcessArguments(
    [
      process.execPath,
      "src/cli/index.ts",
      ...(target === undefined
        ? argumentsList
        : argumentsList.filter((_, index) => index !== serverIndex && index !== serverIndex + 1)),
    ],
    target,
  );
  const child = Bun.spawn(invocation.argumentsList, {
    cwd: process.cwd(),
    env: { ...process.env, ...officialGatewayProcessEnvironment(invocation.target), TRAJECTORY_MARKETPLACE_CONFIG_HOME: root },
    stderr: "pipe",
    stdin: input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
  });
  if (input !== undefined) {
    const stdin = child.stdin;
    if (stdin === undefined) throw new Error("expected piped child stdin");
    stdin.write(input);
    stdin.end();
  }
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  return { exitCode, stderr, stdout };
};

const parseBody = async (request: Request): Promise<unknown> => {
  if (request.method === "GET") return undefined;
  const body = await request.text();
  return body.length === 0 ? {} : JSON.parse(body);
};

const runPtyProcess = async (
  command: readonly string[],
  secret: string,
  options: Readonly<{ readonly eio?: boolean; readonly marker?: string; readonly nonEio?: boolean; readonly root?: string; readonly signal?: "SIGTERM" }> = {},
): Promise<CliResult> => {
  const serverIndex = command.indexOf("--server");
  const candidateTarget = serverIndex < 0 ? undefined : command[serverIndex + 1];
  const targetUrl = candidateTarget === undefined ? undefined : new URL(candidateTarget);
  const target = targetUrl?.hostname === "127.0.0.1" && targetUrl.pathname === "/"
    ? candidateTarget
    : undefined;
  const invocation = officialGatewayProcessArguments([
    "python3", "-c", pythonPtyDriver,
    Buffer.from(secret).toString("base64"), Buffer.from(options.marker ?? "Verification code: ").toString("base64"),
    Buffer.from(options.signal ?? "").toString("base64"),
    ...(target === undefined
      ? command
      : command.filter((_, index) => index !== serverIndex && index !== serverIndex + 1)),
  ], target);
  const child = Bun.spawn(invocation.argumentsList, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...officialGatewayProcessEnvironment(invocation.target),
      ...(options.root === undefined ? {} : { TRAJECTORY_MARKETPLACE_CONFIG_HOME: options.root }),
      ...(options.eio === true ? { TRAJECTORY_TEST_PTY_EIO: "1" } : {}),
      ...(options.nonEio === true ? { TRAJECTORY_TEST_PTY_NON_EIO: "1" } : {}),
    },
    stderr: "pipe", stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited, new Response(child.stderr).text(), new Response(child.stdout).text(),
  ]);
  return { exitCode, stderr, stdout };
};

const runPtyCli = async (root: string, argumentsList: readonly string[], secret: string): Promise<CliResult> =>
  runPtyProcess([process.execPath, "src/cli/index.ts", ...argumentsList], secret, {
    marker: "Verification code: ",
    root,
  });

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("auth real CLI process boundary", () => {
  test("runs signup, login, one-line stdin verify, status, and remote-first logout without secret output", async () => {
    const root = fixtureRoot();
    const requests: CapturedRequest[] = [];
    const server = Bun.serve({ port: 0, async fetch(request) {
      const url = new URL(request.url);
      requests.push({
        ...(request.headers.get("authorization") === null ? {} : { authorization: "Bearer [REDACTED]" }),
        body: await parseBody(request), method: request.method, path: url.pathname,
      });
      if (url.pathname === "/v1/auth/signup" || url.pathname === "/v1/auth/login") {
        return json({ ok: true, challengeId, expiresAt });
      }
      if (url.pathname === "/v1/auth/verify") {
        return json({ ok: true, accessToken: token, tokenType: "Bearer", expiresAt, accountId });
      }
      if (url.pathname === "/v1/auth/me") {
        return json({ ok: true, account: { accountId, email: "owner@example.test" } });
      }
      return json({ ok: true, revoked: true });
    } });
    servers.push(server);
    const origin = `http://127.0.0.1:${server.port}`;

    const results = [
      await runCli(root, ["auth", "signup", "--server", origin, "--email", "OWNER@example.test", "--accept-terms"]),
      await runCli(root, ["trajectory", "auth", "login", "--server", origin, "--email", "owner@example.test"]),
      await runCli(root, ["auth", "verify", "--server", origin, "--challenge", challengeId, "--code-stdin"], "654321\n999999\n"),
      await runCli(root, ["auth", "status", "--server", origin]),
    ];
    const path = storePath(root);
    expect(lstatSync(join(root, "agent-trajectory-marketplace")).mode & 0o777).toBe(0o700);
    expect(lstatSync(path).mode & 0o777).toBe(0o600);
    expect(String(readStoredAuthSession(officialRegistryOrigin, { storePath: path })?.accessToken)).toBe(token);
    results.push(await runCli(root, ["auth", "logout", "--server", origin]));

    expect(results.map(({ exitCode }) => exitCode)).toEqual([0, 0, 0, 0, 0]);
    expect(results.map(({ stderr }) => stderr)).toEqual(["", "", "", "", ""]);
    const combinedOutput = results.map(({ stdout }) => stdout).join("");
    expect(combinedOutput).not.toContain(token);
    expect(combinedOutput).not.toContain("654321");
    expect(combinedOutput).not.toContain("999999");
    expect(results.map(({ stdout }) => JSON.parse(stdout))).toEqual([
      { challengeId, expiresAt, server: officialRegistryOrigin },
      { challengeId, expiresAt, server: officialRegistryOrigin },
      { accountId, expiresAt, server: officialRegistryOrigin },
      { account: { accountId, email: "owner@example.test" }, expiresAt, server: officialRegistryOrigin },
      { loggedOut: true, revoked: true, server: officialRegistryOrigin },
    ]);
    expect(requests).toEqual([
      { body: { email: "owner@example.test", acceptTerms: true }, method: "POST", path: "/v1/auth/signup" },
      { body: { email: "owner@example.test" }, method: "POST", path: "/v1/auth/login" },
      { body: { challengeId, code: "654321" }, method: "POST", path: "/v1/auth/verify" },
      { authorization: "Bearer [REDACTED]", body: undefined, method: "GET", path: "/v1/auth/me" },
      { authorization: "Bearer [REDACTED]", body: {}, method: "POST", path: "/v1/auth/logout" },
    ]);
    expect(readStoredAuthSession(origin, { storePath: path })).toBeUndefined();
  });

  test("removes expired sessions without network and preserves credentials on logout failure", async () => {
    const root = fixtureRoot();
    let hits = 0; let responseStatus = 429;
    const server = Bun.serve({ port: 0, fetch() {
      hits += 1;
      const code = responseStatus === 401 ? "unauthorized" : "rate_limited";
      return json({ ok: false, error: { code, message: "later" } }, responseStatus);
    } });
    servers.push(server);
    const origin = `http://127.0.0.1:${server.port}`;
    const path = storePath(root);
    writeStoredAuthSession({ server: officialRegistryOrigin, accessToken: token, tokenType: "Bearer", expiresAt: "2020-01-01T00:00:00.000Z", accountId }, { storePath: path });

    const expired = await runCli(root, ["auth", "status", "--server", origin]);
    expect({ hits, result: expired }).toEqual({ hits: 0, result: { exitCode: 0, stderr: "", stdout: `${JSON.stringify({ authenticated: false, server: officialRegistryOrigin })}\n` } });
    expect(readStoredAuthSession(officialRegistryOrigin, { storePath: path })).toBeUndefined();

    writeStoredAuthSession({ server: officialRegistryOrigin, accessToken: token, tokenType: "Bearer", expiresAt, accountId }, { storePath: path });
    const failed = await runCli(root, ["auth", "logout", "--server", origin]);
    expect(failed).toEqual({ exitCode: 1, stdout: "", stderr: `${JSON.stringify({ error: "rate_limited" })}\n` });
    expect(String(readStoredAuthSession(officialRegistryOrigin, { storePath: path })?.accessToken)).toBe(token);
    responseStatus = 401;
    const unauthorized = await runCli(root, ["auth", "status", "--server", origin]);
    expect(unauthorized).toEqual({ exitCode: 0, stderr: "", stdout: `${JSON.stringify({ authenticated: false, server: officialRegistryOrigin })}\n` });
    expect(readStoredAuthSession(origin, { storePath: path })).toBeUndefined();
  });

  test("fails closed for hostile transport, OTP, origin, and store boundaries", async () => {
    const root = fixtureRoot();
    const server = Bun.serve({ port: 0, async fetch(request) {
      const body = await request.text();
      if (body.includes("redirect@example.test")) return new Response(null, { headers: { location: "https://evil.example.test" }, status: 302 });
      if (body.includes("oversize@example.test")) return new Response("x".repeat(65_537));
      if (body.includes("limited@example.test")) return json({ ok: false, error: { code: "rate_limited", message: "secret detail" } }, 429);
      return new Response("{malformed");
    } });
    servers.push(server);
    const origin = `http://127.0.0.1:${server.port}`;
    const cases = [
      await runCli(root, ["auth", "login", "--server", origin, "--email", "redirect@example.test"]),
      await runCli(root, ["auth", "login", "--server", origin, "--email", "oversize@example.test"]),
      await runCli(root, ["auth", "login", "--server", origin, "--email", "limited@example.test"]),
      await runCli(root, ["auth", "login", "--server", origin, "--email", "malformed@example.test"]),
      await runCli(root, ["auth", "verify", "--server", origin, "--challenge", challengeId, "--code-stdin"], `${"1".repeat(65)}\n`),
      await runCli(root, ["auth", "verify", "--server", origin, "--challenge", challengeId, "--code-stdin"], ""),
      await runCli(root, ["auth", "login", "--server", "http://example.test", "--email", "owner@example.test"]),
      await runCli(root, ["auth", "login", "--server", `${origin}/wrong-origin`, "--email", "owner@example.test"]),
    ];
    expect(cases.map(({ exitCode }) => exitCode)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(cases.map(({ stdout }) => stdout)).toEqual(["", "", "", "", "", "", "", ""]);
    expect(cases.map(({ stderr }) => stderr)).toEqual([
      "auth_redirect_rejected", "invalid_auth_response", "rate_limited", "invalid_auth_response",
      "invalid_auth_code", "auth_code_required", "invalid_auth_command", "invalid_auth_command",
    ].map((error) => `${JSON.stringify({ error })}\n`));
    expect(cases.map(({ stderr }) => stderr).join("")).not.toContain("secret detail");

    const path = storePath(root);
    writeStoredAuthSession({ server: officialRegistryOrigin, accessToken: token, tokenType: "Bearer", expiresAt, accountId }, { storePath: path });
    const failedVerify = await runCli(root, ["auth", "verify", "--server", origin, "--challenge", challengeId, "--code-stdin"], "654321\n");
    expect(failedVerify.stderr).toBe(`${JSON.stringify({ error: "invalid_auth_response" })}\n`);
    expect(String(readStoredAuthSession(officialRegistryOrigin, { storePath: path })?.accessToken)).toBe(token);

    const malformedRoot = fixtureRoot();
    mkdirSync(join(malformedRoot, "agent-trajectory-marketplace"), { mode: 0o700 });
    writeFileSync(storePath(malformedRoot), "{not-json", { mode: 0o600 });
    expect(await runCli(malformedRoot, ["auth", "status", "--server", origin])).toEqual({ exitCode: 1, stdout: "", stderr: `${JSON.stringify({ error: "invalid_auth_store" })}\n` });
    const linkedRoot = fixtureRoot();
    const outside = fixtureRoot();
    symlinkSync(outside, join(linkedRoot, "agent-trajectory-marketplace"), "dir");
    expect(await runCli(linkedRoot, ["auth", "status", "--server", origin])).toEqual({ exitCode: 1, stdout: "", stderr: `${JSON.stringify({ error: "unsafe_auth_store_path" })}\n` });
    expect(readFileSync(storePath(malformedRoot), "utf8")).toBe("{not-json");
  });

  test("reaps the hidden TTY child after PTY EOF", async () => {
    const command = ["python3", "-c", "import os; os.write(1, b'pty-eof\\n')"];
    const closed = await runPtyProcess(command, "", { marker: "never-seen", nonEio: false });
    const injectedEio = await runPtyProcess(
      ["python3", "-c", "pass"],
      "",
      { eio: true, marker: "never-seen" },
    );
    const injected = await runPtyProcess(command, "", { marker: "never-seen", nonEio: true });

    expect(closed.exitCode).toBe(0);
    expect(closed.stdout).toContain("pty-eof");
    expect(closed.stderr).not.toContain("Traceback");
    expect(injectedEio.exitCode).toBe(0);
    expect(injectedEio.stderr).not.toContain("ChildProcessError");
    expect(injected.exitCode).not.toBe(0);
    expect(injected.stderr).toContain("injected PTY read failure");
  });

  test("interrupts hidden TTY verification on SIGTERM", async () => {
    const root = fixtureRoot();
    let hits = 0;
    const server = Bun.serve({ port: 0, fetch() {
      hits += 1;
      return json({ ok: true, accessToken: token, tokenType: "Bearer", expiresAt, accountId });
    } });
    servers.push(server);
    const origin = `http://127.0.0.1:${server.port}`;

    const result = await runPtyProcess(
      [process.execPath, "src/cli/index.ts", "auth", "verify", "--server", origin, "--challenge", challengeId],
      "654321\n",
      { marker: "Verification code: ", root, signal: "SIGTERM" },
    );

    const expectedError = JSON.stringify({ error: "auth_code_interrupted" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Verification code: ");
    expect(result.stdout.match(new RegExp(expectedError, "g"))?.length).toBe(1);
    expect(result.stdout).not.toContain("654321");
    expect(result.stdout).not.toContain(token);
    expect(hits).toBe(0);
    expect(existsSync(storePath(root))).toBe(false);
  }, { timeout: 6_000 });

  test("reads a bounded OTP from a hidden real TTY without echoing or printing secrets", async () => {
    const root = fixtureRoot();
    let received: unknown;
    const server = Bun.serve({ port: 0, async fetch(request) {
      received = await request.json();
      return json({ ok: true, accessToken: token, tokenType: "Bearer", expiresAt, accountId });
    } });
    servers.push(server);
    const origin = `http://127.0.0.1:${server.port}`;

    const result = await runPtyCli(
      root,
      ["auth", "verify", "--server", origin, "--challenge", challengeId],
      "654321\n",
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Verification code: ");
    expect(result.stdout).not.toContain("654321");
    expect(result.stdout).not.toContain(token);
    expect(received).toEqual({ challengeId, code: "654321" });

    const interrupted = await runPtyCli(
      root,
      ["auth", "verify", "--server", origin, "--challenge", challengeId],
      "\u0003",
    );
    expect(interrupted.exitCode).toBe(1);
    expect(interrupted.stdout).toContain(JSON.stringify({ error: "auth_code_interrupted" }));
    expect(String(readStoredAuthSession(officialRegistryOrigin, { storePath: storePath(root) })?.accessToken)).toBe(token);
  });
});
