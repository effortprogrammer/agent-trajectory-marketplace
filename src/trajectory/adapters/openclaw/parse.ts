import { readFileSync } from "node:fs";

import { transcriptLineSchema, type TranscriptLine } from "./schema";

export const parseTranscriptLines = (sessionPath: string): readonly TranscriptLine[] => {
  const lines: TranscriptLine[] = [];
  for (const rawLine of readFileSync(sessionPath, "utf8").split("\n")) {
    if (rawLine.trim().length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(rawLine);
    } catch {
      continue;
    }
    const parsed = transcriptLineSchema.safeParse(value);
    if (parsed.success) lines.push(parsed.data);
  }
  return lines;
};
