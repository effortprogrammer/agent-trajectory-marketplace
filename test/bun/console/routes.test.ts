import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleConsoleRequest } from "@/console/routes";
import { readSelection } from "@/console/selection";
import type { ConsoleOverview, EgressPreview, PrivacySummary } from "@/console/contract";
import type { SessionList } from "@/marketplace/session-contract";

let root = "";

const traceDocument = (events: readonly unknown[]) => ({
  runtime: "claude-code",
  status: "collected",
  formatVersion: 2,
  eventCount: events.length,
  events,
});

const writeTrace = (name: string, events: readonly unknown[]): void => {
  mkdirSync(join(root, "traces"), { recursive: true });
  writeFileSync(
    join(root, "traces", `${name}.atf.json`),
    JSON.stringify(traceDocument(events)),
    "utf8",
  );
};

const request = (path: string, init?: RequestInit): Request =>
  new Request(`http://127.0.0.1:7788${path}`, init);

const jsonOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "atm-console-routes-"));
  writeTrace("alpha", [
    {
      kind: "function_enter",
      name: "user",
      timestamp: "2026-07-27T10:00:00Z",
      sourceEventId: "evt-1",
      payload: { role: "user", content: "ship the release" },
    },
    {
      kind: "tool_call",
      name: "http_request",
      timestamp: "2026-07-27T10:00:01Z",
      sourceEventId: "evt-2",
      payload: { input: { api_key: "[redacted]" } },
    },
  ]);
  writeTrace("beta", [
    {
      kind: "function_enter",
      name: "user",
      timestamp: "2026-07-26T09:00:00Z",
      sourceEventId: "evt-3",
      payload: { role: "user", content: "fix the flaky test" },
    },
  ]);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("handleConsoleRequest", () => {
  test("serves the console shell as html at the root path", async () => {
    const response = await handleConsoleRequest(request("/"), root);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("Agent Trajectory Console");
  });

  test("returns an overview with totals derived from the trace directory", async () => {
    const response = await handleConsoleRequest(request("/api/overview"), root);
    const overview = await jsonOf<ConsoleOverview>(response);

    expect(response.status).toBe(200);
    expect(overview.sessionCount).toBe(2);
    expect(overview.eventCount).toBe(3);
    expect(overview.redactedSessionCount).toBe(1);
    expect(overview.days.map((row) => row.day)).toEqual(["2026-07-27", "2026-07-26"]);
  });

  test("lists sessions with their selection state", async () => {
    const response = await handleConsoleRequest(request("/api/sessions"), root);
    const body = await jsonOf<{ sessions: SessionList; selected: string[] }>(response);

    expect(body.sessions).toHaveLength(2);
    expect(body.selected).toEqual([]);
    expect(body.sessions.every((session) => session.selector.startsWith("s-"))).toBe(true);
  });

  test("serves single-line request excerpts so a table row cannot wrap", async () => {
    writeTrace("wide", [
      {
        kind: "function_enter",
        name: "user",
        timestamp: "2026-07-28T08:00:00Z",
        sourceEventId: "evt-wide",
        payload: { role: "user", content: `line one[control:U+000A]line two ${"pad ".repeat(80)}` },
      },
    ]);

    const body = await jsonOf<{ sessions: SessionList }>(
      await handleConsoleRequest(request("/api/sessions"), root),
    );

    for (const session of body.sessions) {
      const excerpt = session.firstRequestExcerpt ?? "";
      expect(excerpt).not.toContain("[control:");
      expect(Array.from(excerpt).length).toBeLessThanOrEqual(120);
    }
  });

  test("returns a session report for a known selector", async () => {
    const listed = await jsonOf<{ sessions: SessionList }>(
      await handleConsoleRequest(request("/api/sessions"), root),
    );
    const selector = listed.sessions[0]?.selector ?? "";

    const response = await handleConsoleRequest(
      request(`/api/sessions/${selector}/report`),
      root,
    );
    const report = await jsonOf<{ selector: string; items: readonly unknown[] }>(response);

    expect(response.status).toBe(200);
    expect(report.selector).toBe(selector);
    expect(report.items.length).toBeGreaterThan(0);
  });

  test("returns a privacy summary that attributes the redacted api key", async () => {
    const listed = await jsonOf<{ sessions: SessionList }>(
      await handleConsoleRequest(request("/api/sessions"), root),
    );
    const redacted = listed.sessions.find((session) =>
      session.markers.some((marker) => marker.kind === "redacted"),
    );
    expect(redacted).toBeDefined();

    const response = await handleConsoleRequest(
      request(`/api/sessions/${redacted?.selector ?? ""}/privacy`),
      root,
    );
    const summary = await jsonOf<PrivacySummary>(response);

    expect(response.status).toBe(200);
    expect(summary.ruleCounts.some((entry) => entry.family === "sensitive_key")).toBe(true);
    expect(summary.findings.some((finding) => finding.keyName === "api_key")).toBe(true);
  });

  test("persists a posted selection and reflects it in the egress preview", async () => {
    const listed = await jsonOf<{ sessions: SessionList }>(
      await handleConsoleRequest(request("/api/sessions"), root),
    );
    const selector = listed.sessions[0]?.selector ?? "";

    const saved = await handleConsoleRequest(
      request("/api/selection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selectors: [selector] }),
      }),
      root,
    );
    expect(saved.status).toBe(200);
    expect(readSelection(root)).toEqual([selector]);

    const preview = await jsonOf<EgressPreview>(
      await handleConsoleRequest(request("/api/egress-preview"), root),
    );
    expect(preview.selectedCount).toBe(1);
    expect(preview.availableCount).toBe(2);
    expect(preview.selectors).toEqual([selector]);
  });

  test("aggregates privacy rule counts across only the selected sessions", async () => {
    const listed = await jsonOf<{ sessions: SessionList }>(
      await handleConsoleRequest(request("/api/sessions"), root),
    );
    const clean = listed.sessions.find(
      (session) => !session.markers.some((marker) => marker.kind === "redacted"),
    );

    await handleConsoleRequest(
      request("/api/selection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selectors: [clean?.selector ?? ""] }),
      }),
      root,
    );

    const preview = await jsonOf<EgressPreview>(
      await handleConsoleRequest(request("/api/egress-preview"), root),
    );
    expect(preview.ruleCounts).toEqual([]);
  });

  test("rejects an unknown selector with 404", async () => {
    const response = await handleConsoleRequest(
      request(`/api/sessions/s-${"0".repeat(64)}/report`),
      root,
    );

    expect(response.status).toBe(404);
    expect(await jsonOf<{ error: string }>(response)).toEqual({ error: "invalid_selector" });
  });

  test("rejects a malformed selection payload with 400", async () => {
    const response = await handleConsoleRequest(
      request("/api/selection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selectors: "nope" }),
      }),
      root,
    );

    expect(response.status).toBe(400);
    expect(await jsonOf<{ error: string }>(response)).toEqual({ error: "invalid_request" });
  });

  test("rejects a selector outside the snapshot when saving a selection", async () => {
    const response = await handleConsoleRequest(
      request("/api/selection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selectors: [`s-${"f".repeat(64)}`] }),
      }),
      root,
    );

    expect(response.status).toBe(404);
    expect(await jsonOf<{ error: string }>(response)).toEqual({ error: "invalid_selector" });
  });

  test("answers an unknown route with 404", async () => {
    const response = await handleConsoleRequest(request("/api/nope"), root);

    expect(response.status).toBe(404);
    expect(await jsonOf<{ error: string }>(response)).toEqual({ error: "unknown_route" });
  });

  test("never serves trace bytes for a path traversal attempt", async () => {
    const response = await handleConsoleRequest(
      request("/api/sessions/..%2F..%2Fetc%2Fpasswd/report"),
      root,
    );

    expect(response.status).toBe(404);
  });
});
