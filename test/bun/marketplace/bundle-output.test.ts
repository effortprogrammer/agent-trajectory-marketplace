import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
  nodeBundleOutputOperations,
  writeBundleOutput,
} from "../../../src/marketplace/bundle-output";
import type { BundleOutputOperations } from "../../../src/marketplace/bundle-output";
import { MarketplaceError } from "../../../src/marketplace/error";

const tempResidue = (directory: string): readonly string[] =>
  readdirSync(directory).filter((name) => name.includes(".trajectory-tmp-"));
const roots: string[] = [];

const fixtureRoot = (prefix: string): string => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("atomic local bundle output", () => {
  test("writes all bytes and refuses an existing output without residue", () => {
    // Given: a fresh output followed by a second write to the same pathname.
    const directory = fixtureRoot("trajectory-output-");
    const output = join(directory, "candidate.zip");
    const bytes = Buffer.from("complete bundle bytes");

    // When: the first write commits and the second attempts to overwrite it.
    writeBundleOutput(output, bytes);
    const overwrite = (): void => writeBundleOutput(output, Buffer.from("replacement"));

    // Then: the committed bytes remain intact and no owned temporary file remains.
    expect(overwrite).toThrow(new MarketplaceError("output_exists"));
    expect(readFileSync(output)).toEqual(bytes);
    expect(tempResidue(directory)).toEqual([]);
  });

  test("leaves a competing target untouched when it appears immediately before link", () => {
    // Given: real filesystem operations whose link seam creates a competitor first.
    const directory = fixtureRoot("trajectory-race-");
    const output = join(directory, "candidate.zip");
    const competitor = Buffer.from("competitor wins");
    const operations: BundleOutputOperations = {
      ...nodeBundleOutputOperations,
      link: (temporaryPath, outputPath): void => {
        writeFileSync(outputPath, competitor, { flag: "wx" });
        nodeBundleOutputOperations.link(temporaryPath, outputPath);
      },
    };

    // When: the exclusive hard-link commit loses the deterministic race.
    const action = (): void => writeBundleOutput(output, Buffer.from("owned"), operations);

    // Then: the competitor is untouched and only the owned temporary file is removed.
    expect(action).toThrow(new MarketplaceError("output_exists"));
    expect(readFileSync(output)).toEqual(competitor);
    expect(tempResidue(directory)).toEqual([]);
  });

  test("rejects a replaced temporary without publishing or deleting the foreign replacement", () => {
    // Given: a peer replaces the owned temporary after close and immediately before link.
    const directory = fixtureRoot("trajectory-temp-race-");
    const output = join(directory, "candidate.zip");
    const foreign = Buffer.from("foreign replacement");
    const operations: BundleOutputOperations = {
      ...nodeBundleOutputOperations,
      link: (temporaryPath, outputPath): void => {
        rmSync(temporaryPath);
        writeFileSync(temporaryPath, foreign, { flag: "wx", mode: 0o600 });
        nodeBundleOutputOperations.link(temporaryPath, outputPath);
      },
    };

    // When: publication reaches the pathname-based commit boundary.
    const action = (): void => writeBundleOutput(output, Buffer.from("trusted archive"), operations);

    // Then: foreign bytes are neither published nor deleted as owned cleanup.
    expect(action).toThrow(new MarketplaceError("invalid_bundle_request"));
    expect(existsSync(output)).toBe(false);
    const residue = tempResidue(directory);
    expect(residue).toHaveLength(1);
    expect(readFileSync(join(directory, residue[0] ?? "missing"))).toEqual(foreign);
  });

  test("rejects a shared-writable output directory before creating a temporary", () => {
    // Given: an output directory where a peer can replace publication pathnames.
    const directory = fixtureRoot("trajectory-shared-output-");
    chmodSync(directory, 0o777);
    const output = join(directory, "candidate.zip");

    // When: bundle output validates the publication boundary.
    const action = (): void => writeBundleOutput(output, Buffer.from("trusted archive"));

    // Then: it fails before creating either the target or a temporary file.
    expect(action).toThrow(new MarketplaceError("invalid_bundle_request"));
    expect(existsSync(output)).toBe(false);
    expect(tempResidue(directory)).toEqual([]);
  });

  test("cleans owned temporary files after write, fsync, and link failures", () => {
    // Given: three narrow adapters that fail at one real output operation each.
    const stages = ["write", "fsync", "link"] as const;

    // When: each failure interrupts a separate output attempt.
    const observations = stages.map((stage) => {
      const directory = fixtureRoot(`trajectory-${stage}-`);
      const output = join(directory, "candidate.zip");
      const operations: BundleOutputOperations = {
        ...nodeBundleOutputOperations,
        write: stage === "write" ? (): number => { throw new MarketplaceError("invalid_bundle_request"); } : nodeBundleOutputOperations.write,
        fsync: stage === "fsync" ? (): void => { throw new MarketplaceError("invalid_bundle_request"); } : nodeBundleOutputOperations.fsync,
        link: stage === "link" ? (): void => {
          throw Object.assign(new Error("hard links unavailable"), { code: "ENOTSUP" });
        } : nodeBundleOutputOperations.link,
      };
      let code = "none";
      try {
        writeBundleOutput(output, Buffer.from("bundle"), operations);
      } catch (error) {
        if (error instanceof MarketplaceError) code = error.code;
        else throw error;
      }
      return { code, outputExists: Bun.file(output).size > 0, residue: tempResidue(directory) };
    });

    // Then: every attempt reports failure with neither a target nor temporary residue.
    expect(observations).toEqual([
      { code: "invalid_bundle_request", outputExists: false, residue: [] },
      { code: "invalid_bundle_request", outputExists: false, residue: [] },
      { code: "unsupported_platform", outputExists: false, residue: [] },
    ]);
  });
});
