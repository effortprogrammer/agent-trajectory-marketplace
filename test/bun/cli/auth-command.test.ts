import { describe, expect, test } from "bun:test";

import { parseAuthCommand, type AuthCommand } from "../../../src/cli/auth-command";

describe("trajectory auth CLI grammar", () => {
  test("parses every passwordless auth request with an optional executable prefix", () => {
    const requests = [
      parseAuthCommand([
        "trajectory",
        "auth",
        "signup",
        "--email",
        "person@example.test",
        "--accept-terms",
      ]),
      parseAuthCommand(["auth", "login", "--email", "person@example.test"]),
      parseAuthCommand(["auth", "verify", "--challenge", "challenge-123"]),
      parseAuthCommand([
        "auth",
        "verify",
        "--challenge",
        "challenge-123",
        "--code-stdin",
      ]),
      parseAuthCommand(["auth", "status"]),
      parseAuthCommand(["auth", "logout"]),
    ];

    expect(requests).toEqual([
      {
        acceptTerms: true,
        command: "auth-signup",
        email: "person@example.test",
      },
      { command: "auth-login", email: "person@example.test" },
      {
        challenge: "challenge-123",
        codeSource: "tty",
        command: "auth-verify",
      },
      {
        challenge: "challenge-123",
        codeSource: "stdin",
        command: "auth-verify",
      },
      { command: "auth-status" },
      { command: "auth-logout" },
    ]);
  });

  test("rejects secret-bearing, duplicate, unknown, and incomplete auth input", () => {
    const invalidRequests = [
      ["auth", "verify", "--challenge", "challenge-123", "--code", "123456"],
      ["auth", "login", "--server", "https://other.example.test", "--email", "person@example.test"],
      ["auth", "login", "--email", "person@example.test", "--password", "not-a-password"],
      ["auth", "login", "--email", "person@example.test", "--refresh-token", "not-a-token"],
      ["auth", "login", "--email", "person@example.test", "--api-key", "not-an-api-key"],
      ["auth", "signup", "--email", "person@example.test"],
      ["auth", "status", "--extra"],
      ["auth", "logout", "--server"],
      ["marketplace", "seller", "sessions", "list", "--server", "https://other.example.test"],
    ];

    expect(invalidRequests.map((argumentsList) => parseAuthCommand(argumentsList))).toEqual(
      invalidRequests.map(() => ({ command: "invalid_auth_command" })),
    );
    expect(
      parseAuthCommand(["auth", "verify", "--challenge", "challenge-123"], false),
    ).toEqual({ command: "auth_code_required" });
    expect(parseAuthCommand(["auth", "verify"])).toEqual({ command: "invalid_auth_command" });
  });

  test("exposes a readonly discriminated union for downstream auth dispatch", () => {
    const request: AuthCommand = parseAuthCommand(["auth", "status"]);

    expect(request.command).toBe("auth-status");
  });
});
