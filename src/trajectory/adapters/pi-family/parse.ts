import { existsSync, readFileSync, statSync } from "node:fs";

import { TrajectoryAdapterError } from "../contract";
import {
  entryPatchSchema,
  headerPatchSchema,
  type PiSessionEntry,
  type PiSessionHeader,
  sessionEntrySchema,
  sessionHeaderSchema,
} from "./schema";

export type PiSessionFile = Readonly<{
  header: PiSessionHeader;
  // Entries in file order with patch records already replayed.
  entries: readonly PiSessionEntry[];
  // Raw record `type` values seen in the file (pre-replay), for variant
  // fingerprinting.
  rawRecordTypes: ReadonlySet<string>;
  patchRecordCount: number;
}>;

export const parsePiSessionFile = (sessionPath: string): PiSessionFile => {
  if (!existsSync(sessionPath) || !statSync(sessionPath).isFile()) {
    throw new TrajectoryAdapterError("missing_session", `missing_session: ${sessionPath}`);
  }
  if (!sessionPath.endsWith(".jsonl")) {
    throw new TrajectoryAdapterError("invalid_session", `invalid_session: ${sessionPath}`);
  }

  let header: PiSessionHeader | undefined;
  const entries: PiSessionEntry[] = [];
  const entriesById = new Map<string, PiSessionEntry>();
  const rawRecordTypes = new Set<string>();
  let patchRecordCount = 0;

  const nonEmptyLines = readFileSync(sessionPath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  for (const [lineIndex, rawLine] of nonEmptyLines.entries()) {
    let value: unknown;
    try {
      value = JSON.parse(rawLine);
    } catch {
      // Live writers can leave only the final physical record torn.
      if (lineIndex !== nonEmptyLines.length - 1) {
        throw new TrajectoryAdapterError("invalid_session", `invalid_session: ${sessionPath}`);
      }
      continue;
    }
    if (value === null || typeof value !== "object") continue;
    const recordType = (value as { type?: unknown }).type;
    if (typeof recordType === "string") rawRecordTypes.add(recordType);

    if (header === undefined) {
      const headerResult = sessionHeaderSchema.safeParse(value);
      if (!headerResult.success) {
        throw new TrajectoryAdapterError(
          "invalid_session",
          `invalid_session: first record is not a pi-family session header in ${sessionPath}`,
        );
      }
      header = headerResult.data;
      continue;
    }

    if (recordType === "header_patch") {
      patchRecordCount += 1;
      const patchResult = headerPatchSchema.safeParse(value);
      if (patchResult.success) {
        const { title, cwd } = patchResult.data.patch;
        if (title !== undefined) header = { ...header, title };
        if (cwd !== undefined) header = { ...header, cwd };
      }
      continue;
    }
    if (recordType === "entry_patch") {
      patchRecordCount += 1;
      const patchResult = entryPatchSchema.safeParse(value);
      if (patchResult.success && patchResult.data.patch.message !== undefined) {
        const target = entriesById.get(patchResult.data.entryId);
        if (target !== undefined && target.type === "message") {
          target.message = patchResult.data.patch.message;
        }
      }
      continue;
    }

    const entryResult = sessionEntrySchema.safeParse(value);
    if (entryResult.success) {
      entries.push(entryResult.data);
      entriesById.set(entryResult.data.id, entryResult.data);
    }
  }

  if (header === undefined) {
    throw new TrajectoryAdapterError(
      "invalid_session",
      `invalid_session: no session header in ${sessionPath}`,
    );
  }
  return { header, entries, rawRecordTypes, patchRecordCount };
};
