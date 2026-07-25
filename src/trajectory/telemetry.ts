import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import ky from "ky";
import { z } from "zod";

import type { CollectSweepSummary } from "./collect-watch";

export const collectorTelemetryStateFileName = "collector-telemetry-state.json";

const collectorTelemetryProxyHost =
  "https://atm-telemetry-country-proxy.yhjhoward7.workers.dev";

const telemetryConfigurationSchema = z.object({
  apiKey: z.string().trim().min(1),
  host: z.string().trim().url(),
}).strict();

const telemetryStateSchema = z.object({
  heartbeatDate: z.string().date().optional(),
  installationId: z.string().uuid(),
  schemaVersion: z.literal(1),
}).strict();

type CollectorTelemetryState = z.infer<typeof telemetryStateSchema>;

export type CollectorTelemetryConfig = Readonly<{
  apiKey: string;
  host: string;
}>;

type CollectorTelemetryProperties = Readonly<{
  "$ip": "0";
  active_runtimes?: readonly string[];
  atm_version: string;
  distinct_id: string;
  error_code?: string;
  exported_session_count?: number;
  installation_id: string;
  os: string;
}>;

export type CollectorTelemetryPayload = Readonly<{
  api_key: string;
  event: "collector_error" | "collector_heartbeat" | "collector_installed";
  properties: CollectorTelemetryProperties;
}>;

export type CollectorTelemetrySend = (payload: CollectorTelemetryPayload) => Promise<boolean>;

type CollectorTelemetryInput = Readonly<{
  configuration: CollectorTelemetryConfig;
  now: Date;
  outDir: string;
  send: CollectorTelemetrySend;
  version: string;
}>;

const emptyTelemetryState = (): CollectorTelemetryState => ({
  installationId: randomUUID(),
  schemaVersion: 1,
});

const telemetryStatePath = (outDir: string): string => join(resolve(outDir), collectorTelemetryStateFileName);

const readTelemetryState = (outDir: string): CollectorTelemetryState => {
  const statePath = telemetryStatePath(outDir);
  if (!existsSync(statePath)) return emptyTelemetryState();
  try {
    return telemetryStateSchema.parse(JSON.parse(readFileSync(statePath, "utf8")));
  } catch { // no-excuse-ok: catch — a torn telemetry state must not interrupt collection.
    return emptyTelemetryState();
  }
};

const writeTelemetryState = (outDir: string, state: CollectorTelemetryState): void => {
  try {
    mkdirSync(resolve(outDir), { recursive: true });
    writeFileSync(telemetryStatePath(outDir), `${JSON.stringify(state)}\n`, "utf8");
  } catch { // no-excuse-ok: catch — telemetry state persistence must not interrupt collection.
    return;
  }
};

const properties = (
  state: CollectorTelemetryState,
  version: string,
  extra: Readonly<Partial<Pick<CollectorTelemetryProperties, "active_runtimes" | "error_code" | "exported_session_count">>>,
): CollectorTelemetryProperties => ({
  "$ip": "0",
  atm_version: version,
  distinct_id: state.installationId,
  installation_id: state.installationId,
  os: process.platform,
  ...extra,
});

const payload = (
  configuration: CollectorTelemetryConfig,
  event: CollectorTelemetryPayload["event"],
  eventProperties: CollectorTelemetryProperties,
): CollectorTelemetryPayload => ({
  api_key: configuration.apiKey,
  event,
  properties: eventProperties,
});

export const resolveCollectorTelemetryConfig = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CollectorTelemetryConfig | undefined => {
  const apiKey = environment.ATM_POSTHOG_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) return undefined;
  const configuredHost = environment.ATM_POSTHOG_HOST?.trim();
  const host = configuredHost === undefined
    || configuredHost.length === 0
    || configuredHost === "https://us.i.posthog.com"
    || configuredHost === "https://eu.i.posthog.com"
    ? collectorTelemetryProxyHost
    : configuredHost;
  const parsed = telemetryConfigurationSchema.safeParse({
    apiKey,
    host,
  });
  return parsed.success ? parsed.data : undefined;
};

export const sendCollectorTelemetry = async (
  configuration: CollectorTelemetryConfig,
  payloadToSend: CollectorTelemetryPayload,
): Promise<boolean> => {
  try {
    await ky.post(new URL("/capture/", configuration.host), {
      json: payloadToSend,
      retry: 0,
      timeout: 5_000,
    });
    return true;
  } catch { // no-excuse-ok: catch — telemetry failures must not interrupt collection.
    return false;
  }
};

export const captureDailyCollectorHeartbeat = async (input: CollectorTelemetryInput & Readonly<{
  summary: CollectSweepSummary;
}>): Promise<Readonly<{ captured: boolean }>> => {
  const state = readTelemetryState(input.outDir);
  const day = input.now.toISOString().slice(0, 10);
  if (state.heartbeatDate === day) return { captured: false };
  const captured = await input.send(payload(
    input.configuration,
    "collector_heartbeat",
    properties(state, input.version, {
      active_runtimes: [...input.summary.runtimes].sort(),
      exported_session_count: input.summary.exported,
    }),
  ));
  if (!captured) return { captured: false };
  writeTelemetryState(input.outDir, { ...state, heartbeatDate: day });
  return { captured: true };
};

export const captureCollectorInstalled = async (input: CollectorTelemetryInput): Promise<Readonly<{ captured: boolean }>> => {
  const state = readTelemetryState(input.outDir);
  const captured = await input.send(payload(input.configuration, "collector_installed", properties(state, input.version, {})));
  if (captured) writeTelemetryState(input.outDir, state);
  return { captured };
};

export const captureCollectorError = async (input: CollectorTelemetryInput & Readonly<{
  errorCode: string;
}>): Promise<Readonly<{ captured: boolean }>> => {
  const state = readTelemetryState(input.outDir);
  const captured = await input.send(payload(
    input.configuration,
    "collector_error",
    properties(state, input.version, { error_code: input.errorCode }),
  ));
  if (captured) writeTelemetryState(input.outDir, state);
  return { captured };
};
