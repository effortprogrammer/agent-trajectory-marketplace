import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { fullSelectorSchema } from "../marketplace/session-contract";
import type { FullSelector } from "../marketplace/session-contract";
import { ConsoleError, selectionStateSchema } from "./contract";

const selectionFileName = "upload-selection.json";

export const selectionFilePath = (root: string): string => join(root, selectionFileName);

const normalize = (selectors: readonly string[]): readonly FullSelector[] => {
  const parsed = selectors.map((selector) => {
    const result = fullSelectorSchema.safeParse(selector);
    if (!result.success) throw new ConsoleError("invalid_selector");
    return result.data;
  });
  return [...new Set(parsed)].sort((left, right) => left.localeCompare(right));
};

export const readSelection = (root: string): readonly FullSelector[] => {
  let text: string;
  try {
    text = readFileSync(selectionFilePath(root), "utf8");
  } catch {
    return [];
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  const parsed = selectionStateSchema.safeParse(value);
  return parsed.success ? parsed.data.selectors : [];
};

export const writeSelection = (
  root: string,
  selectors: readonly string[],
): readonly FullSelector[] => {
  const normalized = normalize(selectors);
  writeFileSync(
    selectionFilePath(root),
    `${JSON.stringify({ version: 1, selectors: normalized }, undefined, 2)}\n`,
    "utf8",
  );
  return normalized;
};
