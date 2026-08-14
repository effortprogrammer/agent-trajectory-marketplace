import { describe, expect, test } from "bun:test";

import { parseCollectorCommand, type CollectorCommand } from "../../../src/cli/collector";

describe("trajectory collect CLI grammar", () => {
  test("parses canonical runtimes and sessions commands", () => {
    // Given: canonical hierarchical collector commands.
    const runtimes = parseCollectorCommand(["trajectory", "collect", "runtimes"]);
    const sessions = parseCollectorCommand(["trajectory", "collect", "sessions", "opencode"]);

    // Then: parsing returns typed requests without invoking collection.
    expect(runtimes).toEqual({ command: "runtimes" });
    expect(sessions).toEqual({ command: "sessions", runtime: "opencode", limit: 20 });
  });

  test("parses canonical arguments after the trajectory executable name", () => {
    // Given: argv from invoking the trajectory package binary directly.
    const argumentsList = ["collect", "sessions", "codex", "--limit", "1"];

    // When: the executable-relative arguments cross the parser boundary.
    const command = parseCollectorCommand(argumentsList);

    // Then: they preserve the same hierarchical grammar as the full command spelling.
    expect(command).toEqual({ command: "sessions", limit: 1, runtime: "codex" });
  });

  test("parses explicit Pi runtime declarations for export and watch", () => {
    expect(
      parseCollectorCommand([
        "trajectory",
        "collect",
        "export",
        "pi",
        "--session",
        "native",
        "--export",
        "/tmp/native.atf.json",
        "--declare-runtime",
        "pi",
      ]),
    ).toMatchObject({ command: "export", declareRuntime: "pi", runtime: "pi" });
    expect(
      parseCollectorCommand([
        "trajectory",
        "collect",
        "watch",
        "--out",
        "/tmp/out",
        "--declare-runtime",
        "pi",
      ]),
    ).toMatchObject({ command: "watch", declareRuntime: "pi" });
  });

  test("parses canonical export and watch defaults", () => {
    // Given: canonical export and watch arguments.
    const exportCommand = parseCollectorCommand([
      "trajectory",
      "collect",
      "export",
      "codex",
      "--session",
      "session.json",
      "--export",
      "/tmp/out/session.atf.json",
    ]);
    const watchCommand = parseCollectorCommand(["trajectory", "collect", "watch", "--out", "/tmp/out"]);

    // Then: required values and documented defaults are represented explicitly.
    expect(exportCommand).toEqual({
      command: "export",
      exportPath: "/tmp/out/session.atf.json",
      runtime: "codex",
      session: "session.json",
    });
    expect(watchCommand).toEqual({
      command: "watch",
      intervalSeconds: 30,
      once: false,
      outDir: "/tmp/out",
      runtimes: [],
      settleSeconds: 60,
    });
  });

  test("parses the installer telemetry lifecycle signal", () => {
    // Given: the internal lifecycle command used after installation completes.
    const command = parseCollectorCommand(["trajectory", "collect", "telemetry", "installed", "--out", "/tmp/out"]);

    // When: the command crosses the collector CLI boundary.
    const result = command;

    // Then: telemetry receives only the local output root it needs for anonymous state.
    expect(result).toEqual({ command: "telemetry", outDir: "/tmp/out", verb: "installed" });
  });

  test("parses repeated watch runtimes and service verbs", () => {
    // Given: repeated runtime selectors and service lifecycle commands.
    const watch = parseCollectorCommand([
      "trajectory",
      "collect",
      "watch",
      "--out",
      "/tmp/out",
      "--runtime",
      "codex",
      "--runtime",
      "opencode",
      "--interval-seconds",
      "5",
      "--settle-seconds",
      "0",
      "--once",
    ]);
    const install = parseCollectorCommand([
      "trajectory",
      "collect",
      "service",
      "install",
      "--out",
      "/tmp/out",
      "--runtime",
      "codex",
      "--dry-run",
    ]);
    const status = parseCollectorCommand(["trajectory", "collect", "service", "status"]);
    const uninstall = parseCollectorCommand(["trajectory", "collect", "service", "uninstall"]);

    // Then: all values are normalized to typed requests.
    expect(watch).toEqual({
      command: "watch",
      intervalSeconds: 5,
      once: true,
      outDir: "/tmp/out",
      runtimes: ["codex", "opencode"],
      settleSeconds: 0,
    });
    expect(install).toEqual({
      command: "service",
      dryRun: true,
      intervalSeconds: 30,
      outDir: "/tmp/out",
      runtimes: ["codex"],
      settleSeconds: 60,
      verb: "install",
    });
    expect(status).toEqual({ command: "service", verb: "status" });
    expect(uninstall).toEqual({ command: "service", verb: "uninstall" });
  });

  test("preserves flat atm-collector aliases", () => {
    // Given: the pre-existing flat command spelling.
    const sessions = parseCollectorCommand(["sessions", "--runtime", "opencode", "--source-dir", "/tmp/source"]);
    const exportCommand = parseCollectorCommand([
      "export",
      "--runtime",
      "codex",
      "--source-dir",
      "/tmp/source",
      "--output-root",
      "/tmp/out",
      "--session",
      "session",
      "--export-path",
      "session.atf.json",
    ]);
    const watch = parseCollectorCommand([
      "watch",
      "--once",
      "--runtime",
      "opencode",
      "--source-dir",
      "/tmp/source",
      "--output-root",
      "/tmp/out",
    ]);
    const service = parseCollectorCommand([
      "service",
      "install",
      "--dry-run",
      "--runtime",
      "opencode",
      "--source-dir",
      "/tmp/source",
      "--output-root",
      "/tmp/out",
    ]);

    // Then: aliases map to the same command requests while retaining old option names.
    expect(sessions).toEqual({ command: "sessions", limit: 20, runtime: "opencode", sourceDir: "/tmp/source" });
    expect(exportCommand).toEqual({
      command: "export",
      exportPath: "session.atf.json",
      outputRoot: "/tmp/out",
      runtime: "codex",
      session: "session",
      sourceDir: "/tmp/source",
    });
    expect(watch).toMatchObject({ command: "watch", once: true, outputRoot: "/tmp/out", runtimes: ["opencode"] });
    expect(service).toMatchObject({ command: "service", dryRun: true, outputRoot: "/tmp/out", verb: "install" });
  });

  test("rejects invalid options and values", () => {
    // Given: malformed, ambiguous, or unsupported command arguments.
    const invalid = (args: readonly string[]): unknown => parseCollectorCommand(args);

    // When / Then: each malformed request is rejected at the pure parse boundary.
    expect(() => invalid(["trajectory", "collect", "wat"])).toThrow(/invalid_collector_request/);
    expect(() => invalid(["trajectory", "collect", "service", "restart"])).toThrow(/invalid_collector_request/);
    expect(() => invalid(["trajectory", "collect", "sessions", "codex", "--unknown", "x"])).toThrow(
      /invalid_collector_request/,
    );
    expect(() => invalid(["trajectory", "collect", "sessions", "codex", "--limit", "-1"])).toThrow(
      /invalid_collector_request/,
    );
    expect(() => invalid(["trajectory", "collect", "sessions", "codex", "--limit", "nope"])).toThrow(
      /invalid_collector_request/,
    );
    expect(() => invalid(["trajectory", "collect", "sessions", "codex", "--source", "/tmp/a", "--source", "/tmp/b"])).toThrow(
      /invalid_collector_request/,
    );
    expect(() => invalid(["trajectory", "collect", "sessions", "--source", "/tmp/a"])).toThrow(
      /invalid_collector_request/,
    );
    expect(() => invalid(["sessions", "--runtime", "codex"])).toThrow(/invalid_collector_request/);
    expect(() => invalid(["watch", "--runtime", "codex", "--source-dir", "/tmp/source"])).toThrow(
      /invalid_collector_request/,
    );
    expect(() => invalid(["trajectory", "collect", "export", "codex", "--session", "session"])).toThrow(
      /invalid_collector_request/,
    );
    expect(() => invalid(["trajectory", "collect", "watch", "--out", "/tmp/out", "--interval-seconds", "0"])).toThrow(
      /invalid_collector_request/,
    );
    expect(() => invalid(["trajectory", "collect", "watch", "--out", "/tmp/out", "--settle-seconds", "-1"])).toThrow(
      /invalid_collector_request/,
    );
    expect(() => invalid(["trajectory", "collect", "watch", "--out", "/tmp/out", "--source", "/tmp/source"])).toThrow(
      /invalid_collector_request/,
    );
    expect(() =>
      invalid([
        "trajectory",
        "collect",
        "watch",
        "--out",
        "/tmp/out",
        "--runtime",
        "codex",
        "--runtime",
        "opencode",
        "--source",
        "/tmp/source",
      ]),
    ).toThrow(/invalid_collector_request/);
  });

  test("keeps the command union exhaustive", () => {
    // Given: a parsed request from the public parser.
    const command: CollectorCommand = parseCollectorCommand(["trajectory", "collect", "runtimes"]);

    // Then: the discriminant is available to downstream dispatchers.
    expect(command.command).toBe("runtimes");
  });
});
