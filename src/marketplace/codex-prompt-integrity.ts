import { boundedRedactedString } from "../trajectory/adapters/contract";
import type { HarnessTraceDocument } from "../trajectory/adapters/contract";

export const hasCodexPromptIntegrity = (trace: HarnessTraceDocument): boolean => {
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
      || boundedRedactedString(payload.content).truncated
      || payload.truncated === true
    ) return false;
  }
  return promptCount > 0;
};
