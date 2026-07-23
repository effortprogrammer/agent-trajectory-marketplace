import {
  extractHarnessSourceAttestation,
  type HarnessSourceAttestation,
} from "../contract";
import type { ContentBlock, TranscriptLine } from "./schema";

const sourceNamespace = "openclaw";

export const namespacedId = (nativeId: string): string => `${sourceNamespace}:${nativeId}`;

export const lineSourceId = (line: Readonly<Pick<TranscriptLine, "id">>): string | undefined =>
  line.id === undefined || line.id.length === 0 ? undefined : namespacedId(line.id);

export const composedSourceId = (
  line: Readonly<Pick<TranscriptLine, "id">>,
  suffix: string | undefined,
): string | undefined => {
  if (line.id === undefined || line.id.length === 0 || suffix === undefined || suffix.length === 0) {
    return undefined;
  }
  return `${namespacedId(line.id)}:${suffix}`;
};

export const lineAttestation = (
  line: Readonly<Pick<TranscriptLine, "timestamp">>,
  sourceEventId: string | undefined,
  parentSourceEventId: string | undefined,
): HarnessSourceAttestation | undefined => {
  if (sourceEventId === undefined) return undefined;
  return extractHarnessSourceAttestation({
    timestamp: line.timestamp,
    sourceEventId,
    ...(parentSourceEventId === undefined ? {} : { parentSourceEventId }),
  });
};

const summaryKeys = ["cmd", "command", "file_path", "path", "pattern", "query", "prompt", "url"] as const;

export const summarizeToolArguments = (input: Readonly<Record<string, unknown>> | undefined): string => {
  if (input === undefined) return "";
  for (const key of summaryKeys) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return JSON.stringify(input);
};

export const textFromContent = (content: string | readonly ContentBlock[] | undefined): string => {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join(" ")
    .trim();
};
