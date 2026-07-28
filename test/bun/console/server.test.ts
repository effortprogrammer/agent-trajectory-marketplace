import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConsoleError } from "@/console/contract";
import { startConsoleServer } from "@/console/server";
import type { ConsoleServer } from "@/console/server";
import type { ConsoleOverview } from "@/console/contract";

let root = "";
let server: ConsoleServer | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "atm-console-server-"));
  mkdirSync(join(root, "traces"), { recursive: true });
  writeFileSync(
    join(root, "traces", "one.atf.json"),
    JSON.stringify({
      runtime: "codex",
      status: "collected",
      formatVersion: 2,
      eventCount: 1,
      events: [
        {
          kind: "function_enter",
          name: "user",
          timestamp: "2026-07-27T12:00:00Z",
          sourceEventId: "evt-1",
          payload: { role: "user", content: "hello" },
        },
      ],
    }),
    "utf8",
  );
});

afterEach(async () => {
  await server?.stop();
  server = undefined;
  rmSync(root, { recursive: true, force: true });
});

describe("startConsoleServer", () => {
  test("binds loopback and serves the overview over http", async () => {
    server = startConsoleServer({ root, hostname: "127.0.0.1", port: 0 });

    expect(server.url).toContain("http://127.0.0.1:");
    const overview = (await (await fetch(`${server.url}/api/overview`)).json()) as ConsoleOverview;
    expect(overview.sessionCount).toBe(1);
    expect(overview.runtimeCounts).toEqual([{ runtime: "codex", count: 1 }]);
  });

  test("serves the console shell over http", async () => {
    server = startConsoleServer({ root, hostname: "127.0.0.1", port: 0 });

    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Agent Trajectory Console");
  });

  test("refuses to start when the root is not a directory", () => {
    expect(() =>
      startConsoleServer({ root: join(root, "missing"), hostname: "127.0.0.1", port: 0 }),
    ).toThrow(ConsoleError);
  });
});
