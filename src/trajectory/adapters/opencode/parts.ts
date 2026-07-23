import type { OpenCodePartRow } from "./database";
import { type OpenCodeTokenSet, partDataSchema } from "./schema";

export type OpenCodeToolPart = Readonly<{
  tool: string;
  state: Readonly<{ status?: string; input?: unknown; output?: unknown }>;
}>;

export const safeJsonParse = (raw: string | null): unknown => {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
};

export const collectTextParts = (parts: readonly OpenCodePartRow[]): string => {
  const segments: string[] = [];
  for (const part of parts) {
    const parsed = partDataSchema.safeParse(safeJsonParse(part.data));
    if (!parsed.success || parsed.data.type !== "text") continue;
    if (parsed.data.text !== undefined && parsed.data.text.length > 0) segments.push(parsed.data.text);
  }
  return segments.join(" ");
};

export const collectStepFinishTokens = (
  parts: readonly OpenCodePartRow[],
): OpenCodeTokenSet | undefined => {
  for (const part of parts) {
    const parsed = partDataSchema.safeParse(safeJsonParse(part.data));
    if (parsed.success && parsed.data.type === "step-finish") return parsed.data.tokens;
  }
  return undefined;
};

export const readToolPart = (part: OpenCodePartRow): OpenCodeToolPart | undefined => {
  const parsed = partDataSchema.safeParse(safeJsonParse(part.data));
  if (!parsed.success || parsed.data.type !== "tool") return undefined;
  return { tool: parsed.data.tool ?? "tool", state: parsed.data.state ?? {} };
};
