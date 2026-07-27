import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  captureDailyCollectorHeartbeat,
  resolveCollectorTelemetryConfig,
  sendCollectorTelemetry,
  type CollectorTelemetryPayload,
} from "../../../src/trajectory/telemetry";
import type { CollectSweepSummary } from "../../../src/trajectory/collect-watch";

const roots: string[] = [];

const temporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "atm-telemetry-"));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

const summary = (): CollectSweepSummary => ({
  exported: 3,
  exportedSessions: [],
  failed: 0,
  failedSessions: [],
  missingSources: [],
  pendingSettle: 0,
  runtimes: ["claude-code", "codex"],
  sweepAt: "2026-07-23T00:00:00.000Z",
  unchanged: 4,
});

describe("collector telemetry", () => {
  test.each([
    [undefined, "https://us.i.posthog.com"],
    ["https://us.i.posthog.com", "https://us.i.posthog.com"],
    ["https://eu.i.posthog.com", "https://eu.i.posthog.com"],
  ])("delivers telemetry directly to the configured PostHog region", (host, expectedHost) => {
    const configuration = resolveCollectorTelemetryConfig({
      ATM_POSTHOG_API_KEY: "phc_test",
      ATM_POSTHOG_HOST: host,
    });

    expect(configuration).toEqual({
      apiKey: "phc_test",
      host: expectedHost,
    });
  });

  test.each([
    ["http://localhost:43210"],
    ["https://telemetry.example.com"],
  ])("preserves the explicit custom telemetry host %s", (host) => {
    const configuration = resolveCollectorTelemetryConfig({
      ATM_POSTHOG_API_KEY: "phc_test",
      ATM_POSTHOG_HOST: host,
    });

    expect(configuration).toEqual({ apiKey: "phc_test", host });
  });

  test("captures one daily heartbeat with only the approved collection signals", async () => {
    // Given: a configured collector and an isolated output directory.
    const configuration = resolveCollectorTelemetryConfig({ ATM_POSTHOG_API_KEY: "phc_test" });
    const captured: CollectorTelemetryPayload[] = [];
    const outDir = temporaryRoot();
    expect(configuration).toBeDefined();
    if (configuration === undefined) throw new Error("missing_test_telemetry_configuration");

    // When: two successful sweeps complete on the same UTC day.
    const first = await captureDailyCollectorHeartbeat({
      configuration,
      now: new Date("2026-07-23T01:00:00.000Z"),
      outDir,
      send: async (payload) => { captured.push(payload); return true; },
      summary: summary(),
      version: "1.0.0",
    });
    const second = await captureDailyCollectorHeartbeat({
      configuration,
      now: new Date("2026-07-23T02:00:00.000Z"),
      outDir,
      send: async (payload) => { captured.push(payload); return true; },
      summary: summary(),
      version: "1.0.0",
    });

    // Then: exactly one anonymous, aggregate heartbeat is sent.
    expect(first).toEqual({ captured: true });
    expect(second).toEqual({ captured: false });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      api_key: "phc_test",
      event: "collector_heartbeat",
      properties: {
        active_runtimes: ["claude-code", "codex"],
        atm_version: "1.0.0",
        exported_session_count: 3,
      },
    });
    expect(Object.keys(captured[0]?.properties ?? {}).sort()).toEqual([
      "$process_person_profile",
      "active_runtimes",
      "atm_version",
      "distinct_id",
      "exported_session_count",
      "installation_id",
      "os",
    ]);
  });

  test("delivers telemetry to the configured PostHog host", async () => {
    // Given: a local capture endpoint and an approved PostHog payload.
    let received = "";
    const server = Bun.serve({
      fetch: async (request) => {
        received = await request.text();
        return new Response("{}", { status: 200 });
      },
      port: 0,
    });
    const configuration = resolveCollectorTelemetryConfig({
      ATM_POSTHOG_API_KEY: "phc_test",
      ATM_POSTHOG_HOST: `http://localhost:${server.port}`,
    });
    const telemetryPayload: CollectorTelemetryPayload = {
      api_key: "phc_test",
      event: "collector_installed",
      properties: {
        "$process_person_profile": false,
        atm_version: "1.0.0",
        distinct_id: "11111111-1111-4111-8111-111111111111",
        installation_id: "11111111-1111-4111-8111-111111111111",
        os: "darwin",
      },
    };
    expect(configuration).toBeDefined();
    if (configuration === undefined) throw new Error("missing_test_telemetry_configuration");

    // When: the collector posts the payload through its telemetry transport.
    const captured = await sendCollectorTelemetry(configuration, telemetryPayload);
    server.stop(true);

    // Then: the configured host receives the approved JSON payload.
    expect(captured).toBe(true);
    expect(JSON.parse(received)).toEqual(telemetryPayload);
  });

  test("emits the installation lifecycle signal through the real CLI", async () => {
    // Given: an installed collector with a local PostHog-compatible capture endpoint.
    let received = "";
    const server = Bun.serve({
      fetch: async (request) => {
        received = await request.text();
        return new Response("{}", { status: 200 });
      },
      port: 0,
    });
    const outDir = temporaryRoot();
    const command = Bun.spawn([
      process.execPath,
      "src/cli/index.ts",
      "collect",
      "telemetry",
      "installed",
      "--out",
      outDir,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ATM_POSTHOG_API_KEY: "phc_test",
        ATM_POSTHOG_HOST: `http://localhost:${server.port}`,
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    // When: the installer lifecycle command executes through the bundled CLI entrypoint.
    const exitCode = await command.exited;
    const stdout = await new Response(command.stdout).text();
    const stderr = await new Response(command.stderr).text();
    server.stop(true);

    // Then: the process succeeds and the capture endpoint sees an installation event.
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe('{"captured":true}\n');
    expect(JSON.parse(received)).toMatchObject({ api_key: "phc_test", event: "collector_installed" });
  });

  test("emits an aggregate heartbeat after a real collection sweep", async () => {
    // Given: a settled local Codex session and a local PostHog-compatible endpoint.
    let received = "";
    const server = Bun.serve({
      fetch: async (request) => {
        received = await request.text();
        return new Response("{}", { status: 200 });
      },
      port: 0,
    });
    const sourceDir = temporaryRoot();
    const outDir = temporaryRoot();
    const sessionDir = join(sourceDir, "2026", "07", "23");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, "rollout-telemetry.jsonl"), [
      JSON.stringify({ payload: { id: "telemetry" }, timestamp: "2026-07-23T00:00:00.000Z", type: "session_meta" }),
      JSON.stringify({ payload: { message: "collect", type: "user_message" }, timestamp: "2026-07-23T00:00:01.000Z", type: "event_msg" }),
    ].join("\n") + "\n", "utf8");
    const command = Bun.spawn([
      process.execPath,
      "src/cli/index.ts",
      "collect",
      "watch",
      "--once",
      "--out",
      outDir,
      "--runtime",
      "codex",
      "--source",
      sourceDir,
      "--settle-seconds",
      "0",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ATM_POSTHOG_API_KEY: "phc_test",
        ATM_POSTHOG_HOST: `http://localhost:${server.port}`,
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    // When: a one-shot collector sweep completes through the real CLI boundary.
    const exitCode = await command.exited;
    const stderr = await new Response(command.stderr).text();
    server.stop(true);

    // Then: the endpoint receives only the aggregate heartbeat information.
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(received)).toMatchObject({
      event: "collector_heartbeat",
      properties: { active_runtimes: ["codex"], exported_session_count: 1 },
    });
  });

  test("emits a safe error code when the real collector fails", async () => {
    // Given: a configured collector whose output target is an existing file.
    let received = "";
    const server = Bun.serve({
      fetch: async (request) => {
        received = await request.text();
        return new Response("{}", { status: 200 });
      },
      port: 0,
    });
    const root = temporaryRoot();
    const outPath = join(root, "not-a-directory");
    writeFileSync(outPath, "fixture", "utf8");
    const command = Bun.spawn([
      process.execPath,
      "src/cli/index.ts",
      "collect",
      "watch",
      "--once",
      "--out",
      outPath,
      "--runtime",
      "codex",
      "--source",
      root,
      "--settle-seconds",
      "0",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ATM_POSTHOG_API_KEY: "phc_test",
        ATM_POSTHOG_HOST: `http://localhost:${server.port}`,
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    // When: the real CLI fails before it can begin a collection sweep.
    const exitCode = await command.exited;
    const stderr = await new Response(command.stderr).text();
    server.stop(true);

    // Then: its machine-safe collector error code is captured without filesystem details.
    expect(exitCode).toBe(1);
    expect(stderr).toBe('{"error":"EEXIST"}\n');
    expect(JSON.parse(received)).toMatchObject({
      event: "collector_error",
      properties: { error_code: "EEXIST" },
    });
  });
});
