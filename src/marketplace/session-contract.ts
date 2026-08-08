import { z } from "zod";

import type { HarnessTraceDocument } from "../trajectory/adapters/contract";

const sha256Pattern = /^[a-f0-9]{64}$/;
const selectorPattern = /^s-[a-f0-9]{64}$/;

export const traceHashSchema = z.string().regex(sha256Pattern).brand<"TraceHash">();
export type TraceHash = z.infer<typeof traceHashSchema>;

export const fullSelectorSchema = z.string().regex(selectorPattern).brand<"FullSelector">();
export type FullSelector = z.infer<typeof fullSelectorSchema>;

export const frozenTraceSchema = z
  .object({
    selector: fullSelectorSchema,
    relativePath: z.string().min(1),
    hash: traceHashSchema,
    byteCount: z.number().int().nonnegative(),
    runtime: z.string().min(1),
    eventCount: z.number().int().nonnegative(),
    earliestTimestamp: z.union([z.iso.datetime({ offset: true }).max(64), z.literal("unknown")]),
    bytes: z.instanceof(Uint8Array),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.byteCount !== value.bytes.byteLength) {
      context.addIssue({
        code: "custom",
        path: ["byteCount"],
        message: "byte_count_mismatch",
      });
    }
  });

export type FrozenTrace = Readonly<{
  readonly selector: FullSelector;
  readonly relativePath: string;
  readonly hash: TraceHash;
  readonly byteCount: number;
  readonly runtime: string;
  readonly eventCount: number;
  readonly earliestTimestamp: string | "unknown";
  readonly bytes: Uint8Array;
}>;

export const sessionSnapshotSchema = z
  .object({
    root: z.string().min(1),
    rootDevice: z.number().int().nonnegative(),
    rootInode: z.number().int().nonnegative(),
    traces: z.array(frozenTraceSchema),
    totalByteCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    const total = value.traces.reduce((sum, trace) => sum + trace.byteCount, 0);
    if (value.totalByteCount !== total) {
      context.addIssue({
        code: "custom",
        path: ["totalByteCount"],
        message: "snapshot_byte_count_mismatch",
      });
    }
  });

export type SessionSnapshot = Readonly<{
  readonly root: string;
  readonly rootDevice: number;
  readonly rootInode: number;
  readonly traces: readonly FrozenTrace[];
  readonly totalByteCount: number;
}>;

export type ValidatedTrace = Readonly<{
  readonly frozenTrace: FrozenTrace;
  readonly document: HarnessTraceDocument;
}>;

export const sessionMarkerKinds = [
  "redacted",
  "truncated",
  "sanitized",
  "unknown_event_kind",
] as const;

export const sessionMarkerSchema = z
  .object({
    kind: z.enum(sessionMarkerKinds),
    eventIndex: z.number().int().nonnegative().optional(),
  })
  .strict();

export type SessionMarker = Readonly<{
  readonly kind: (typeof sessionMarkerKinds)[number];
  readonly eventIndex?: number;
}>;

export const sessionErrorExcerptSchema = z
  .object({
    eventIndex: z.number().int().nonnegative(),
    text: z.string().min(1),
  })
  .strict();

export type SessionErrorExcerpt = Readonly<{ readonly eventIndex: number; readonly text: string }>;

export const sessionSummarySchema = z
  .object({
    requests: z.array(z.string()).max(8),
    touched: z.array(z.string()).max(8),
    errors: z.array(sessionErrorExcerptSchema).max(5),
    counts: z
      .object({
        requests: z.number().int().nonnegative(),
        actions: z.number().int().nonnegative(),
        results: z.number().int().nonnegative(),
        errors: z.number().int().nonnegative(),
        redacted: z.number().int().nonnegative(),
        truncated: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type SessionSummary = Readonly<{
  readonly requests: readonly string[];
  readonly touched: readonly string[];
  readonly errors: readonly SessionErrorExcerpt[];
  readonly counts: Readonly<{
    readonly requests: number;
    readonly actions: number;
    readonly results: number;
    readonly errors: number;
    readonly redacted: number;
    readonly truncated: number;
  }>;
}>;

export type SessionListItem = Readonly<{
  readonly selector: FullSelector;
  readonly runtime: string;
  readonly earliestTimestamp: string | "unknown";
  readonly eventCount: number;
  readonly byteCount: number;
  readonly firstExcerpt?: string;
  readonly firstRequestExcerpt?: string;
  readonly summary: SessionSummary;
  readonly markers: readonly SessionMarker[];
}>;

export type SessionList = readonly SessionListItem[];

export const sessionWorkItemKinds = ["request", "action", "result", "error"] as const;

export type SessionWorkItem = Readonly<{
  readonly kind: (typeof sessionWorkItemKinds)[number];
  readonly eventIndex: number;
  readonly timestamp?: string;
  readonly text: string;
  readonly markers: readonly SessionMarker[];
}>;

export type SessionReport = Readonly<{
  readonly selector: FullSelector;
  readonly runtime: string;
  readonly items: readonly SessionWorkItem[];
  readonly omittedItemCount: number;
  readonly markers: readonly SessionMarker[];
}>;
