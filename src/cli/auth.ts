import {
  authChallengeIdSchema,
  authEmailSchema,
  authOtpCodeSchema,
} from "../auth/contract";
import { accountPolicyCliNotice } from "../auth/account-policies";
import { AuthClientError, createAuthClient } from "../auth/client";
import { officialRegistryOrigin } from "../auth/official-origin";
import {
  readStoredAuthSession,
  removeStoredAuthSession,
  storedAuthSessionStatus,
  writeStoredAuthSession,
} from "../auth/store";
import { parseAuthCommand } from "./auth-command";

export const authCliErrorCodes = [
  "auth_code_interrupted",
  "auth_code_required",
  "invalid_auth_code",
  "invalid_auth_command",
] as const;

type AuthCliErrorCode = (typeof authCliErrorCodes)[number];

export class AuthCliError extends Error {
  readonly name = "AuthCliError";

  constructor(readonly code: AuthCliErrorCode) {
    super(code);
  }
}

const codeInputLimit = 64;
const authHelp = `Usage: trajectory auth <command>

Commands:
  signup --email <email> --accept-terms
  login --email <email>
  verify --challenge <challenge> [--code-stdin]
  status
  logout`;

const isAuthHelp = (argumentsList: readonly string[]): boolean =>
  (argumentsList[0] === "auth" && argumentsList[1] === "--help" && argumentsList.length === 2) ||
  (argumentsList[0] === "trajectory" && argumentsList[1] === "auth" && argumentsList[2] === "--help" && argumentsList.length === 3);

const invalidCommand = (): never => {
  throw new AuthCliError("invalid_auth_command");
};

const invalidCode = (): never => {
  throw new AuthCliError("invalid_auth_code");
};

const printJson = (value: unknown): void => {
  console.log(JSON.stringify(value));
};

const readStdinLine = async (): Promise<string> => {
  const reader = Bun.stdin.stream().getReader();
  const bytes: number[] = [];
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      for (const byte of result.value) {
        if (byte === 10) return new TextDecoder().decode(Uint8Array.from(bytes));
        if (byte !== 13) bytes.push(byte);
        if (bytes.length > codeInputLimit) return invalidCode();
      }
    }
    return new TextDecoder().decode(Uint8Array.from(bytes));
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
};

const readHiddenTtyLine = (signal: AbortSignal): Promise<string> => {
  if (signal.aborted) throw new AuthCliError("auth_code_interrupted");
  const input = process.stdin;
  if (input.isTTY !== true || typeof input.setRawMode !== "function") {
    throw new AuthCliError("auth_code_required");
  }
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    let settled = false;
    function finish(result: string | AuthCliError): void {
      if (settled) return;
      settled = true;
      input.removeListener("data", onData);
      signal.removeEventListener("abort", onAbort);
      input.setRawMode(false);
      input.pause();
      process.stderr.write("\n");
      if (result instanceof AuthCliError) reject(result);
      else resolve(result);
    }
    function onAbort(): void {
      finish(new AuthCliError("auth_code_interrupted"));
    }
    function onData(chunk: Buffer | string): void {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003" || character === "\u0004") {
          finish(new AuthCliError("auth_code_interrupted"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
        } else {
          value += character;
          if (value.length > codeInputLimit) {
            finish(new AuthCliError("invalid_auth_code"));
            return;
          }
        }
      }
    }
    input.on("data", onData);
    signal.addEventListener("abort", onAbort);
    process.stderr.write("Verification code: ");
  });
};

const parseOtp = (value: string) => {
  if (value.length === 0) throw new AuthCliError("auth_code_required");
  const parsed = authOtpCodeSchema.safeParse(value);
  if (!parsed.success) return invalidCode();
  return parsed.data;
};

const assertNever = (value: never): never => {
  void value;
  return invalidCommand();
};

export const isAuthInvocation = (argumentsList: readonly string[]): boolean =>
  argumentsList[0] === "auth" ||
  (argumentsList[0] === "trajectory" && argumentsList[1] === "auth");

export const runAuthCli = async (argumentsList: readonly string[], signal: AbortSignal): Promise<void> => {
  if (isAuthHelp(argumentsList)) {
    console.log(authHelp);
    return;
  }
  const command = parseAuthCommand(argumentsList, process.stdin.isTTY === true);
  switch (command.command) {
    case "invalid_auth_command":
      return invalidCommand();
    case "auth_code_required":
      throw new AuthCliError("auth_code_required");
    case "auth-signup":
    case "auth-login": {
      const server = officialRegistryOrigin;
      const email = authEmailSchema.safeParse(command.email);
      if (!email.success) return invalidCommand();
      const client = createAuthClient(server);
      const challenge = command.command === "auth-signup"
        ? await client.signup({ email: email.data, acceptTerms: true })
        : await client.login({ email: email.data });
      if (command.command === "auth-signup") process.stderr.write(accountPolicyCliNotice);
      printJson({ challengeId: challenge.challengeId, expiresAt: challenge.expiresAt, server });
      return;
    }
    case "auth-verify": {
      const server = officialRegistryOrigin;
      const challenge = authChallengeIdSchema.safeParse(command.challenge);
      if (!challenge.success) return invalidCommand();
      const code = parseOtp(command.codeSource === "stdin" ? await readStdinLine() : await readHiddenTtyLine(signal));
      const verified = await createAuthClient(server).verify({ challengeId: challenge.data, code });
      writeStoredAuthSession({
        accessToken: verified.accessToken,
        accountId: verified.accountId,
        expiresAt: verified.expiresAt,
        server,
        tokenType: verified.tokenType,
      });
      printJson({ accountId: verified.accountId, expiresAt: verified.expiresAt, server });
      return;
    }
    case "auth-status": {
      const server = officialRegistryOrigin;
      const session = readStoredAuthSession(server);
      if (session === undefined) {
        printJson({ authenticated: false, server });
        return;
      }
      if (storedAuthSessionStatus(session) === "expired") {
        removeStoredAuthSession(server);
        printJson({ authenticated: false, server });
        return;
      }
      try {
        const status = await createAuthClient(server).status(session.accessToken);
        printJson({ account: status.account, expiresAt: session.expiresAt, server });
      } catch (error) {
        if (!(error instanceof AuthClientError) || error.code !== "unauthorized") throw error;
        removeStoredAuthSession(server);
        printJson({ authenticated: false, server });
      }
      return;
    }
    case "auth-logout": {
      const server = officialRegistryOrigin;
      const session = readStoredAuthSession(server);
      if (session === undefined) {
        printJson({ loggedOut: true, revoked: false, server });
        return;
      }
      const response = await createAuthClient(server).logout(session.accessToken);
      removeStoredAuthSession(server);
      printJson({ loggedOut: true, revoked: response.revoked, server });
      return;
    }
    default:
      return assertNever(command);
  }
};
