import { z } from "zod";

import { fullSelectorSchema } from "../marketplace/session-contract";

export const privacyRuleFamilies = [
  "sensitive_key",
  "credential_pattern",
  "oversized_value",
  "terminal_control",
] as const;

export type PrivacyRuleFamily = (typeof privacyRuleFamilies)[number];

export type PrivacyRuleCount = Readonly<{
  readonly family: PrivacyRuleFamily;
  readonly count: number;
}>;

export type PrivacyFinding = Readonly<{
  readonly family: PrivacyRuleFamily;
  readonly eventIndex: number;
  readonly path: string;
  readonly storedText: string;
  readonly keyName?: string;
}>;

export type PrivacySummary = Readonly<{
  readonly selector: string;
  readonly runtime: string;
  readonly eventCount: number;
  readonly byteCount: number;
  readonly ruleCounts: readonly PrivacyRuleCount[];
  readonly findings: readonly PrivacyFinding[];
  readonly omittedFindingCount: number;
}>;

export type ConsoleDailyRow = Readonly<{
  readonly day: string;
  readonly sessionCount: number;
  readonly eventCount: number;
  readonly byteCount: number;
  readonly redactedSessionCount: number;
}>;

export type ConsoleOverview = Readonly<{
  readonly sessionCount: number;
  readonly eventCount: number;
  readonly byteCount: number;
  readonly redactedSessionCount: number;
  readonly runtimeCounts: readonly Readonly<{ readonly runtime: string; readonly count: number }>[];
  readonly days: readonly ConsoleDailyRow[];
  readonly undatedSessionCount: number;
}>;

export type EgressPreview = Readonly<{
  readonly selectedCount: number;
  readonly availableCount: number;
  readonly byteCount: number;
  readonly eventCount: number;
  readonly ruleCounts: readonly PrivacyRuleCount[];
  readonly selectors: readonly string[];
}>;

export const selectionStateSchema = z
  .object({
    version: z.literal(1),
    selectors: z.array(fullSelectorSchema),
  })
  .strict();

export type SelectionState = z.infer<typeof selectionStateSchema>;

export const selectionRequestSchema = z
  .object({
    selectors: z.array(z.string().min(1)).max(10_000),
  })
  .strict();

export type ConsoleErrorCode =
  | "invalid_root"
  | "invalid_selector"
  | "invalid_request"
  | "unknown_route";

export class ConsoleError extends Error {
  readonly name = "ConsoleError";

  constructor(readonly code: ConsoleErrorCode) {
    super(code);
  }
}
