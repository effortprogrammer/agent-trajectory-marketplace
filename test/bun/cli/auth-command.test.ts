import { describe, expect, test } from "bun:test";

import { parseAuthCommand, type AuthCommand } from "../../../src/cli/auth-command";

const server = "https://auth.example.test";

describe("trajectory auth CLI grammar", () => {
  test("parses every passwordless auth request with an optional executable prefix", () => {
    const requests = [
      parseAuthCommand([
        "trajectory",
        "auth",
        "signup",
        "--server",
        server,
        "--email",
        "person@example.test",
        "--accept-terms",
      ]),
      parseAuthCommand(["auth", "login", "--email", "person@example.test", "--server", server]),
      parseAuthCommand(["auth", "verify", "--server", server, "--challenge", "challenge-123"]),
      parseAuthCommand([
        "auth",
        "verify",
        "--challenge",
        "challenge-123",
        "--code-stdin",
        "--server",
        server,
      ]),
      parseAuthCommand(["auth", "status", "--server", server]),
      parseAuthCommand(["auth", "logout", "--server", server]),
    ];

    expect(requests).toEqual([
      {
        acceptTerms: true,
        command: "auth-signup",
        email: "person@example.test",
        server,
      },
      { command: "auth-login", email: "person@example.test", server },
      {
        challenge: "challenge-123",
        codeSource: "tty",
        command: "auth-verify",
        server,
      },
      {
        challenge: "challenge-123",
        codeSource: "stdin",
        command: "auth-verify",
        server,
      },
      { command: "auth-status", server },
      { command: "auth-logout", server },
    ]);
  });

  test("rejects secret-bearing, duplicate, unknown, and incomplete auth input", () => {
    const invalidRequests = [
      ["auth", "verify", "--server", server, "--challenge", "challenge-123", "--code", "123456"],
      ["auth", "login", "--server", server, "--server", "https://other.example.test", "--email", "person@example.test"],
      ["auth", "login", "--server", server, "--email", "person@example.test", "--password", "not-a-password"],
      ["auth", "login", "--server", server, "--email", "person@example.test", "--refresh-token", "not-a-token"],
      ["auth", "login", "--server", server, "--email", "person@example.test", "--api-key", "not-an-api-key"],
      ["auth", "signup", "--server", server, "--email", "person@example.test"],
      ["auth", "status", "--server", server, "--extra"],
      ["auth", "logout", "--server"],
      ["marketplace", "seller", "sessions", "list", "--server", server],
    ];

    expect(invalidRequests.map((argumentsList) => parseAuthCommand(argumentsList))).toEqual(
      invalidRequests.map(() => ({ command: "invalid_auth_command" })),
    );
    expect(
      parseAuthCommand(["auth", "verify", "--server", server, "--challenge", "challenge-123"], false),
    ).toEqual({ command: "auth_code_required" });
    expect(parseAuthCommand(["auth", "verify", "--server", server])).toEqual({ command: "invalid_auth_command" });
  });

  test("exposes a readonly discriminated union for downstream auth dispatch", () => {
    const request: AuthCommand = parseAuthCommand(["auth", "status", "--server", server]);

    expect(request.command).toBe("auth-status");
  });
});
