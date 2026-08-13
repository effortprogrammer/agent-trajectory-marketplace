import { describe, expect, test } from "bun:test";

import { parseDatasetCommand } from "../../../src/cli/dataset";

describe("trajectory dataset CLI grammar", () => {
  test("parses a TRL export with explicit absolute paths", () => {
    expect(parseDatasetCommand([
      "trajectory",
      "dataset",
      "trl",
      "--input",
      "/tmp/session.atf.json",
      "--out",
      "/tmp/train.jsonl",
    ])).toEqual({
      command: "trl",
      inputPath: "/tmp/session.atf.json",
      outputPath: "/tmp/train.jsonl",
    });
  });

  test("rejects incomplete, ambiguous, and relative requests", () => {
    const invalidRequests = [
      ["trajectory", "dataset", "trl", "--input", "/tmp/session.atf.json"],
      ["trajectory", "dataset", "trl", "--input", "session.atf.json", "--out", "/tmp/train.jsonl"],
      ["trajectory", "dataset", "trl", "--input", "/tmp/session.atf.json", "--out", "train.jsonl"],
      ["trajectory", "dataset", "trl", "--input", "/tmp/one.atf.json", "--input", "/tmp/two.atf.json", "--out", "/tmp/train.jsonl"],
      ["trajectory", "dataset", "unknown", "--input", "/tmp/session.atf.json", "--out", "/tmp/train.jsonl"],
    ] as const;

    for (const request of invalidRequests) {
      expect(() => parseDatasetCommand(request)).toThrow("invalid_dataset_request");
    }
  });
});
