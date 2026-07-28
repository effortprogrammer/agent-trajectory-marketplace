import { describe, expect, test } from "bun:test";

import { isConsoleInvocation, parseConsoleCommand } from "@/console/command";

describe("isConsoleInvocation", () => {
  test("claims only the console verb", () => {
    expect(isConsoleInvocation(["console"])).toBe(true);
    expect(isConsoleInvocation(["console", "--root", "/tmp/x"])).toBe(true);
    expect(isConsoleInvocation(["collect", "runtimes"])).toBe(false);
    expect(isConsoleInvocation([])).toBe(false);
  });
});

describe("parseConsoleCommand", () => {
  test("requires an absolute root", () => {
    expect(parseConsoleCommand(["console", "--root", "relative/path"]).command).toBe(
      "invalid_command",
    );
    expect(parseConsoleCommand(["console"]).command).toBe("invalid_command");
  });

  test("accepts an absolute root and defaults the bind target", () => {
    const parsed = parseConsoleCommand(["console", "--root", "/tmp/traces"]);

    expect(parsed).toEqual({
      command: "console",
      root: "/tmp/traces",
      hostname: "127.0.0.1",
      port: 4317,
      open: false,
    });
  });

  test("accepts an explicit port and open flag", () => {
    const parsed = parseConsoleCommand([
      "console",
      "--root",
      "/tmp/traces",
      "--port",
      "5050",
      "--open",
    ]);

    expect(parsed).toEqual({
      command: "console",
      root: "/tmp/traces",
      hostname: "127.0.0.1",
      port: 5050,
      open: true,
    });
  });

  test("rejects a port outside the valid range", () => {
    expect(parseConsoleCommand(["console", "--root", "/tmp/x", "--port", "0"]).command).toBe(
      "invalid_command",
    );
    expect(parseConsoleCommand(["console", "--root", "/tmp/x", "--port", "70000"]).command).toBe(
      "invalid_command",
    );
    expect(parseConsoleCommand(["console", "--root", "/tmp/x", "--port", "abc"]).command).toBe(
      "invalid_command",
    );
  });

  test("never binds a non-loopback hostname", () => {
    expect(
      parseConsoleCommand(["console", "--root", "/tmp/x", "--hostname", "0.0.0.0"]).command,
    ).toBe("invalid_command");
    expect(
      parseConsoleCommand(["console", "--root", "/tmp/x", "--hostname", "localhost"]),
    ).toEqual({
      command: "console",
      root: "/tmp/x",
      hostname: "localhost",
      port: 4317,
      open: false,
    });
  });

  test("rejects unknown flags and repeated roots", () => {
    expect(parseConsoleCommand(["console", "--root", "/tmp/x", "--wat"]).command).toBe(
      "invalid_command",
    );
    expect(
      parseConsoleCommand(["console", "--root", "/tmp/x", "--root", "/tmp/y"]).command,
    ).toBe("invalid_command");
  });
});
