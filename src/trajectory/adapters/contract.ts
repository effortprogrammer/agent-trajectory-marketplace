import { z } from "zod";

import {
  boundedRedactedString as boundPayloadString,
  sanitizePayloadValue,
} from "./payload-sanitizer";

export const harnessCollectedStatus = "collected" as const;

const maxSourceEventIdChars = 256;
const atfTimestampSchema = z.iso.datetime({ offset: true }).max(64);

export const harnessSourceEventIdSchema = z.string().min(1).max(maxSourceEventIdChars);

export type HarnessSourceAttestation = Readonly<{
  timestamp: string; sourceEventId: string;
  parentSourceEventId?: string;
}>;

const rawAttestationRecordSchema = z
  .object({
    timestamp: z.unknown().optional(),
    sourceEventId: z.unknown().optional(),
    parentSourceEventId: z.unknown().optional(),
  })
  .passthrough();

export const extractHarnessSourceAttestation = (
  raw: unknown,
): HarnessSourceAttestation | undefined => {
  const recordResult = rawAttestationRecordSchema.safeParse(raw);
  if (!recordResult.success) return undefined;
  const timestampResult = atfTimestampSchema.safeParse(recordResult.data.timestamp);
  const sourceResult = harnessSourceEventIdSchema.safeParse(recordResult.data.sourceEventId);
  if (!timestampResult.success || !sourceResult.success) return undefined;
  const parentResult = harnessSourceEventIdSchema.safeParse(
    recordResult.data.parentSourceEventId,
  );
  return {
    timestamp: timestampResult.data,
    sourceEventId: sourceResult.data,
    ...(parentResult.success ? { parentSourceEventId: parentResult.data } : {}),
  };
};

const assistantBlockSchema = z
  .object({
    type: z.enum(["text", "tool_use", "thinking"]),
    text: z.string().optional(), id: z.string().optional(), name: z.string().optional(),
    input: z.unknown().optional(),
  })
  .strict();

const usageSchema = z
  .object({
    model: z.string().optional(),
    inputTokens: z.number().int().nonnegative().optional(), outputTokens: z.number().int().nonnegative().optional(),
    cachedInputTokens: z.number().int().nonnegative().optional(), reasoningOutputTokens: z.number().int().nonnegative().optional(),
    cacheWriteTokens: z.number().int().nonnegative().optional(), latencyMs: z.number().int().nonnegative().optional(),
  })
  .strict();

export const harnessEventPayloadSchema = z
  .object({
    role: z.enum(["user", "assistant"]).optional(),
    content: z.union([z.string(), z.array(assistantBlockSchema)]).optional(),
    toolUseId: z.string().optional(),
    input: z.unknown().optional(), output: z.unknown().optional(), isError: z.boolean().optional(),
    byteCount: z.number().int().nonnegative().optional(), truncated: z.boolean().optional(),
    usage: usageSchema.optional(),
    passed: z.boolean().optional(), label: z.string().optional(),
  })
  .strict();
export type HarnessEventPayload = z.infer<typeof harnessEventPayloadSchema>;

export const harnessTraceEventSchema = z
  .object({
    kind: z.string().min(1),
    name: z.string().min(1),
    timestamp: atfTimestampSchema.optional(),
    sourceEventId: harnessSourceEventIdSchema.optional(),
    parentSourceEventId: harnessSourceEventIdSchema.optional(),
    payload: harnessEventPayloadSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasTimestamp = value.timestamp !== undefined;
    const hasSourceEventId = value.sourceEventId !== undefined;
    if (hasTimestamp !== hasSourceEventId) {
      context.addIssue({
        code: "custom",
        path: [hasTimestamp ? "sourceEventId" : "timestamp"],
        message: hasTimestamp
          ? "source_event_id_required_with_timestamp"
          : "timestamp_required_with_source_event_id",
      });
    }
    if (value.parentSourceEventId !== undefined && !(hasTimestamp && hasSourceEventId)) {
      context.addIssue({
        code: "custom",
        path: ["parentSourceEventId"],
        message: "parent_source_event_id_requires_source_attestation",
      });
    }
  });
export type HarnessTraceEvent = z.infer<typeof harnessTraceEventSchema>;

export const harnessTraceDocumentSchema = z
  .object({
    runtime: z.string().min(1),
    runtimeAttribution: z.literal("operator_declared").optional(),
    status: z.literal(harnessCollectedStatus),
    formatVersion: z.union([z.literal(1), z.literal(2)]).optional(),
    eventCount: z.number().int().nonnegative(),
    events: z.array(harnessTraceEventSchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.runtime === "pi" && value.runtimeAttribution !== "operator_declared") {
      context.addIssue({
        code: "custom",
        path: ["runtimeAttribution"],
        message: "pi_runtime_requires_operator_declaration",
      });
    }
    if (value.runtime !== "pi" && value.runtimeAttribution !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["runtimeAttribution"],
        message: "runtime_attribution_only_allowed_for_pi",
      });
    }
    const requiresVersionTwo = value.events.some(
      (event) =>
        event.payload !== undefined ||
        event.timestamp !== undefined ||
        event.sourceEventId !== undefined ||
        event.parentSourceEventId !== undefined,
    );
    if (requiresVersionTwo && value.formatVersion !== 2) {
      context.addIssue({
        code: "custom",
        path: ["formatVersion"],
        message: "format_version_2_required_with_payload_or_source_attestation",
      });
    }
    if (value.eventCount !== value.events.length) {
      context.addIssue({
        code: "custom",
        path: ["eventCount"],
        message: "event_count_mismatch",
      });
    }
    const seenSourceEventIds = new Set<string>();
    value.events.forEach((event, index) => {
      if (event.sourceEventId === undefined) return;
      if (seenSourceEventIds.has(event.sourceEventId)) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "sourceEventId"],
          message: "duplicate_source_event_id",
        });
      }
      seenSourceEventIds.add(event.sourceEventId);
    });
  });
export type HarnessTraceDocument = Readonly<{
  runtime: string;
  runtimeAttribution?: "operator_declared";
  status: typeof harnessCollectedStatus;
  formatVersion?: 1 | 2;
  eventCount: number;
  events: readonly HarnessTraceEvent[];
}>;

export const harnessPayloadPolicy = {
  maxStringBytes: 16 * 1024,
  maxSerializedBytes: 64 * 1024,
} as const;

export const harnessSessionRefSchema = z
  .object({
    sessionId: z.string().min(1),
    sessionPath: z.string().min(1),
    modifiedAt: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    projectDir: z.string().optional(),
  })
  .strict();
export type HarnessSessionRef = z.infer<typeof harnessSessionRefSchema>;

export type HarnessSessionInput = Readonly<{
  sessionPath: string;
  sessionId?: string;
  runtimeAttribution?: "operator_declared";
}>;

export type HarnessAdapter = Readonly<{
  runtime: string;
  displayName: string;
  logHint: string;
  defaultSourceDir: () => string | undefined;
  listSessions: (sourceDir: string) => readonly HarnessSessionRef[];
  convertSession: (session: HarnessSessionInput) => HarnessTraceDocument;
}>;

export const TrajectoryAdapterErrorCode = {
  InvalidExportPath: "invalid_export_path", InvalidSession: "invalid_session",
  MissingSession: "missing_session", MissingSourceDir: "missing_source_dir",
  ServiceBootstrapFailed: "service_bootstrap_failed", ServiceUnsupportedPlatform: "service_unsupported_platform",
  UnknownRuntime: "unknown_runtime",
} as const;

export type TrajectoryAdapterErrorCode =
  (typeof TrajectoryAdapterErrorCode)[keyof typeof TrajectoryAdapterErrorCode];

export class TrajectoryAdapterError extends Error {
  readonly code: TrajectoryAdapterErrorCode;

  constructor(code: TrajectoryAdapterErrorCode, message: string) {
    super(message);
    this.name = "TrajectoryAdapterError";
    this.code = code;
  }
}

export const boundedRedactedString = (
  value: string,
): Readonly<{ text: string; truncated: boolean }> =>
  boundPayloadString(value, harnessPayloadPolicy.maxStringBytes);

export const sanitizeHarnessPayload = (
  payload: HarnessEventPayload,
): HarnessEventPayload | undefined => {
  const sanitizedValue = sanitizePayloadValue(
    payload,
    harnessPayloadPolicy.maxStringBytes,
    harnessPayloadPolicy.maxSerializedBytes,
  );
  if (sanitizedValue === undefined) return undefined;
  if (sanitizedValue.serializedLimitExceeded) return { truncated: true };
  const parsed = harnessEventPayloadSchema.safeParse(sanitizedValue.value);
  if (!parsed.success) return undefined;
  const sanitized = sanitizedValue.truncated ? { ...parsed.data, truncated: true } : parsed.data;
  if (
    Buffer.byteLength(JSON.stringify(sanitized), "utf8") >
    harnessPayloadPolicy.maxSerializedBytes
  ) {
    return { truncated: true };
  }
  return sanitized;
};
