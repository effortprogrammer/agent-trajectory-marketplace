import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type CliResult = Readonly<{ readonly exitCode: number; readonly stderr: string; readonly stdout: string }>;
type RequestReceipt = Readonly<{ readonly authorization: boolean; readonly body: string; readonly method: string; readonly path: string }>;

class FixtureError extends Error {
  readonly name = "FixtureError";
  constructor(readonly code: string) { super(code); }
}

const requireFixture = (condition: boolean, code: string): void => {
  if (!condition) throw new FixtureError(code);
};

const evidenceDirectory = resolve(process.argv[2] ?? ".omo/evidence/session-topic-selection-cli");
const configRoot = mkdtempSync(join(tmpdir(), "trajectory-auth-manual-"));
const token = "manual-access-token-secret";
const otp = "135790";
const challengeId = "chal-fedcba9876543210";
const accountId = "acct-fedcba9876543210";
const expiresAt = "2099-07-25T00:00:00.000Z";
const requests: RequestReceipt[] = [];

const runCli = async (argumentsList: readonly string[], input?: string): Promise<CliResult> => {
  const child = Bun.spawn([process.execPath, "dist/collector.js", ...argumentsList], {
    cwd: process.cwd(),
    env: { ...process.env, TRAJECTORY_MARKETPLACE_CONFIG_HOME: configRoot },
    stderr: "pipe",
    stdin: input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
  });
  if (input !== undefined) {
    const stdin = child.stdin;
    if (stdin === undefined) throw new FixtureError("missing_child_stdin");
    stdin.write(input);
    stdin.end();
  }
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited, new Response(child.stderr).text(), new Response(child.stdout).text(),
  ]);
  return { exitCode, stderr, stdout };
};

mkdirSync(evidenceDirectory, { recursive: true });
let port = 0;
let server: Bun.Server<unknown> | undefined;
try {
  server = Bun.serve({ port: 0, async fetch(request) {
    const url = new URL(request.url);
    const body = request.method === "GET" ? "" : await request.text();
    requests.push({ authorization: request.headers.has("authorization"), body, method: request.method, path: url.pathname });
    if (url.pathname === "/v1/auth/signup" || url.pathname === "/v1/auth/login") {
      return Response.json({ ok: true, challengeId, expiresAt });
    }
    if (url.pathname === "/v1/auth/verify") {
      return Response.json({ ok: true, accessToken: token, tokenType: "Bearer", expiresAt, accountId });
    }
    if (url.pathname === "/v1/auth/me") {
      return Response.json({ ok: true, account: { accountId, email: "manual@example.test" } });
    }
    return Response.json({ ok: true, revoked: true });
  } });
  const listeningPort = server.port;
  if (listeningPort === undefined) throw new FixtureError("missing_listener_port");
  port = listeningPort;
  const origin = `http://127.0.0.1:${port}`;
  const results = [
    await runCli(["auth", "signup", "--server", origin, "--email", "MANUAL@example.test", "--accept-terms"]),
    await runCli(["auth", "login", "--server", origin, "--email", "manual@example.test"]),
    await runCli(["auth", "verify", "--server", origin, "--challenge", challengeId, "--code-stdin"], `${otp}\nignored-second-line\n`),
    await runCli(["auth", "status", "--server", origin]),
  ];
  const directory = join(configRoot, "agent-trajectory-marketplace");
  const authPath = join(directory, "auth.json");
  const directoryMode = lstatSync(directory).mode & 0o777;
  const fileMode = lstatSync(authPath).mode & 0o777;
  requireFixture(directoryMode === 0o700 && fileMode === 0o600, "unsafe_permissions");
  requireFixture(readFileSync(authPath, "utf8").includes(token), "token_not_stored");
  results.push(await runCli(["auth", "logout", "--server", origin]));
  requireFixture(results.every((result) => result.exitCode === 0 && result.stderr === ""), "cli_lifecycle_failed");
  const output = results.map((result) => result.stdout).join("");
  requireFixture(!output.includes(token) && !output.includes(otp) && !output.includes("ignored-second-line"), "secret_output");
  requireFixture(!readFileSync(authPath, "utf8").includes(token), "logout_did_not_remove_token");
  requireFixture(requests.map((request) => `${request.method} ${request.path}`).join("\n") === [
    "POST /v1/auth/signup", "POST /v1/auth/login", "POST /v1/auth/verify", "GET /v1/auth/me", "POST /v1/auth/logout",
  ].join("\n"), "request_sequence_mismatch");
  requireFixture(requests[2]?.body === JSON.stringify({ challengeId, code: otp }), "stdin_line_not_exact");
  requireFixture(requests.slice(3).every((request) => request.authorization), "authorization_missing");

  const redactedRequests = requests.map((request) => ({
    ...request,
    authorization: request.authorization ? "Bearer [REDACTED]" : undefined,
    body: request.path === "/v1/auth/verify" ? JSON.stringify({ challengeId, code: "[REDACTED]" }) : request.body,
  }));
  writeFileSync(join(evidenceDirectory, "task-15-loopback-capture.json"), `${JSON.stringify({ origin, outputs: results.map((result) => JSON.parse(result.stdout)), requests: redactedRequests }, null, 2)}\n`);
  writeFileSync(join(evidenceDirectory, "task-15-permission-receipt.json"), `${JSON.stringify({ authDirectoryMode: directoryMode.toString(8), authFileMode: fileMode.toString(8), tokenPresentBeforeLogout: true, tokenPresentAfterLogout: false }, null, 2)}\n`);
  console.log(JSON.stringify({ lifecycle: "pass", requests: requests.length, secretsPrinted: false }));
} finally {
  server?.stop(true);
  rmSync(configRoot, { force: true, recursive: true });
  const listener = port === 0 ? undefined : Bun.spawnSync(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { stderr: "pipe", stdout: "pipe" });
  const cleaned = !existsSync(configRoot) && (listener === undefined || listener.exitCode !== 0);
  writeFileSync(join(evidenceDirectory, "task-15-cleanup-receipt.json"), `${JSON.stringify({ configRootRemoved: !existsSync(configRoot), listenerClosed: listener === undefined || listener.exitCode !== 0, port }, null, 2)}\n`);
  if (!cleaned) throw new FixtureError("manual_cleanup_failed");
}
