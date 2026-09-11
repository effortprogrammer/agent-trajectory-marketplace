import { boundedRedactedString, sanitizeHarnessPayload } from "../trajectory/adapters/contract";
import type { HarnessTraceDocument } from "../trajectory/adapters/contract";

const hasCodexPromptStructure = (trace: HarnessTraceDocument): boolean => {
  if (trace.runtime !== "codex") return true;

  let promptCount = 0;
  for (const event of trace.events) {
    const payload = event.payload;
    if (payload?.role !== "user") continue;
    promptCount += 1;
    if (
      event.kind !== "function_enter"
      || typeof payload.content !== "string"
      || payload.content.trim().length === 0
      || payload.truncated === true
    ) return false;
  }
  return promptCount > 0;
};

export { hasCodexPromptStructure };

export const hasCodexPromptIntegrity = (trace: HarnessTraceDocument): boolean => {
  if (!hasCodexPromptStructure(trace)) return false;
  if (trace.runtime !== "codex") return true;

  for (const event of trace.events) {
    const payload = event.payload;
    if (payload?.role !== "user" || typeof payload.content !== "string") continue;
    const expected = boundedRedactedString(payload.content);
    const sanitized = sanitizeHarnessPayload(payload);
    if (
      expected.truncated
      || sanitized?.role !== "user"
      || sanitized.content !== expected.text
      || sanitized.truncated === true
    ) return false;
  }
  return true;
};
