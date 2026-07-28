import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readSelection, selectionFilePath, writeSelection } from "@/console/selection";
import { ConsoleError } from "@/console/contract";
import { fullSelectorSchema } from "@/marketplace/session-contract";

const selectorAt = (index: number) =>
  fullSelectorSchema.parse(`s-${String(index).padStart(64, "0")}`);

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "atm-console-selection-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("selection store", () => {
  test("reads an empty selection when no state file exists", () => {
    expect(readSelection(root)).toEqual([]);
  });

  test("round-trips a written selection", () => {
    writeSelection(root, [selectorAt(2), selectorAt(1)]);

    expect(readSelection(root)).toEqual([selectorAt(1), selectorAt(2)]);
  });

  test("stores selectors sorted and deduplicated", () => {
    writeSelection(root, [selectorAt(3), selectorAt(1), selectorAt(3)]);

    const stored = JSON.parse(readFileSync(selectionFilePath(root), "utf8")) as {
      version: number;
      selectors: string[];
    };
    expect(stored.version).toBe(1);
    expect(stored.selectors).toEqual([selectorAt(1), selectorAt(3)]);
  });

  test("replaces a previous selection instead of appending", () => {
    writeSelection(root, [selectorAt(1), selectorAt(2)]);
    writeSelection(root, [selectorAt(5)]);

    expect(readSelection(root)).toEqual([selectorAt(5)]);
  });

  test("rejects a selector that is not a full selector", () => {
    expect(() => writeSelection(root, ["not-a-selector"])).toThrow(ConsoleError);
  });

  test("treats a corrupted state file as an empty selection", () => {
    writeFileSync(selectionFilePath(root), "{ not json", "utf8");

    expect(readSelection(root)).toEqual([]);
  });

  test("treats a state file with an unexpected shape as an empty selection", () => {
    writeFileSync(selectionFilePath(root), JSON.stringify({ version: 9, selectors: [] }), "utf8");

    expect(readSelection(root)).toEqual([]);
  });
});
