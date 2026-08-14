import { basename, dirname, resolve } from "node:path";

import type { PiSessionFile } from "./parse";
import { type PiFamilyRuntime, piFamilyVariants } from "./variants";

// Variant fingerprinting. The registered runtime already differentiates the
// three tools when sessions come from their default log roots, but sellers
// can point `collect export --session` at any copied file — so provenance is
// also derived from evidence inside the file and its path, and a strong
// mismatch fails closed instead of stamping the wrong tool onto a sold
// trajectory.
//
// Evidence tiers:
// - strong: config-dir path segment (~/.omp vs ~/.senpi vs ~/.gjc), or
//   gajae-only format features (header version >= 4, header_patch/entry_patch
//   records, v5 tool-selection entry types, v2-<digest> scope dir).
// - weak: entry types that split oh-my-pi/gajae from senpi lineage
//   (session_init/mode_change/ttsr_injection vs senpi's session_info).
export type PiFamilyDetection = Readonly<{
  // Strongest single attribution, or undefined when nothing distinguishes.
  runtime: PiFamilyRuntime | undefined;
  strong: boolean;
  evidence: readonly string[];
  // Weak lineage remains visible even when a config-dir path supplies the
  // primary strong claim, so copied fork records cannot hide under `.pi`.
  weakRuntime: PiFamilyRuntime | undefined;
  weakEvidence: readonly string[];
}>;

const gajaeOnlyEntryTypes = ["mcp_tool_selection", "discovered_builtin_tool_selection"] as const;
const ompLineageEntryTypes = ["session_init", "mode_change", "ttsr_injection"] as const;
const gajaeScopeDirPattern = /(^|[/\\])v2-[a-z2-7]{40,64}([/\\]|$)/;

// Upstream Pi's SessionManager derives its default scope from the resolved
// header cwd: `--${cwd-with-separators-replaced-by-dashes}--`. This is path
// evidence, not a cryptographic producer claim: v3/v4 bytes carry no runtime
// fingerprint, so a deliberately hand-shaped generic file can reproduce it.
// The pi adapter therefore fails closed when this native evidence is absent
// or when any fork-lineage marker is present.
export const hasNativePiSessionScope = (sessionPath: string, cwd: string | undefined): boolean => {
  if (cwd === undefined || cwd.length === 0) return false;
  const resolvedCwd = resolve(cwd);
  const expectedScope = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return dirname(sessionPath) !== sessionPath && basename(dirname(sessionPath)) === expectedScope;
};

export const detectPiFamilyVariant = (
  sessionPath: string,
  file: PiSessionFile,
): PiFamilyDetection => {
  const strongEvidence: string[] = [];
  const weakEvidence: string[] = [];
  let strongRuntime: PiFamilyRuntime | undefined;
  let weakRuntime: PiFamilyRuntime | undefined;

  const claimStrong = (runtime: PiFamilyRuntime, reason: string): void => {
    strongEvidence.push(reason);
    strongRuntime ??= runtime;
  };
  const claimWeak = (runtime: PiFamilyRuntime, reason: string): void => {
    weakEvidence.push(reason);
    weakRuntime ??= runtime;
  };

  for (const variant of piFamilyVariants) {
    if (sessionPath.split(/[/\\]/).includes(variant.configDirName)) {
      claimStrong(variant.runtime, `path:${variant.configDirName}`);
    }
  }

  const version = file.header.version ?? 1;
  if (version >= 4) claimStrong("gajae-code", `sessionVersion:${version}`);
  if (file.patchRecordCount > 0) {
    claimStrong("gajae-code", `patchRecords:${file.patchRecordCount}`);
  }
  for (const entryType of gajaeOnlyEntryTypes) {
    if (file.rawRecordTypes.has(entryType)) claimStrong("gajae-code", `entryType:${entryType}`);
  }
  if (gajaeScopeDirPattern.test(sessionPath)) claimStrong("gajae-code", "path:v2-scope-digest");

  for (const entryType of ompLineageEntryTypes) {
    if (file.rawRecordTypes.has(entryType)) claimWeak("oh-my-pi", `entryType:${entryType}`);
  }
  if (file.rawRecordTypes.has("session_info")) claimWeak("senpi", "entryType:session_info");

  if (strongRuntime !== undefined) {
    return {
      runtime: strongRuntime,
      strong: true,
      evidence: strongEvidence,
      weakRuntime,
      weakEvidence,
    };
  }
  return {
    runtime: weakRuntime,
    strong: false,
    evidence: weakEvidence,
    weakRuntime,
    weakEvidence,
  };
};
