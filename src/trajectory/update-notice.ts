import {
  chmodSync,
  closeSync,
  lstatSync,
  openSync,
} from "node:fs";
import { join } from "node:path";

import { Database } from "bun:sqlite";

import type { LatestVersionReader } from "./latest-version";
import {
  compareStableVersions,
  parseStableVersion,
} from "./update-release-contract";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const NOTIFICATION_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const NOTICE_TIMEOUT_MS = 3_000;

type UpdateNoticeCache = Readonly<{
  currentVersion: string;
  latestVersion: string;
  checkedAtMs: number;
  notifiedAtMs: number | null;
}>;

export type UpdateNotice = Readonly<{
  currentVersion: string;
  latestVersion: string;
  command: "trajectory update";
}>;

export type UpdateNoticeDependencies = Readonly<{
  currentVersion: string;
  latestVersion: LatestVersionReader;
  now: Date;
  signal?: AbortSignal;
  stateRoot: string | undefined;
}>;

export const formatUpdateNotice = (notice: UpdateNotice): string =>
  `Update available: ${notice.currentVersion} -> ${notice.latestVersion}. Run: ${notice.command}\n`;

const openCache = (stateRoot: string): Database => {
  const path = join(stateRoot, "update-notice.sqlite");
  try {
    closeSync(openSync(path, "wx", 0o600));
  } catch (caught: unknown) {
    if (
      !(caught instanceof Error) ||
      !("code" in caught) ||
      caught.code !== "EEXIST"
    ) {
      throw caught;
    }
  }
  const file = lstatSync(path);
  if (file.isSymbolicLink() || !file.isFile()) {
    throw new Error("update notice cache must be a regular file");
  }
  const database = new Database(path, { create: true, strict: true });
  try {
    chmodSync(path, 0o600);
    database.run("PRAGMA busy_timeout = 0");
    database.run(`
      CREATE TABLE IF NOT EXISTS update_notice (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        current_version TEXT NOT NULL,
        latest_version TEXT NOT NULL,
        checked_at_ms INTEGER NOT NULL,
        notified_at_ms INTEGER
      )
    `);
    return database;
  } catch (caught: unknown) {
    database.close();
    throw caught;
  }
};

const readCache = (database: Database): UpdateNoticeCache | undefined =>
  database
    .query<UpdateNoticeCache, []>(`
      SELECT
        current_version AS currentVersion,
        latest_version AS latestVersion,
        checked_at_ms AS checkedAtMs,
        notified_at_ms AS notifiedAtMs
      FROM update_notice
      WHERE id = 1
    `)
    .get() ?? undefined;

const writeCache = (
  database: Database,
  cache: UpdateNoticeCache,
): void => {
  database
    .query<never, [string, string, number, number | null]>(`
      INSERT INTO update_notice (
        id,
        current_version,
        latest_version,
        checked_at_ms,
        notified_at_ms
      ) VALUES (1, ?1, ?2, ?3, ?4)
      ON CONFLICT(id) DO UPDATE SET
        current_version = excluded.current_version,
        latest_version = excluded.latest_version,
        checked_at_ms = excluded.checked_at_ms,
        notified_at_ms = excluded.notified_at_ms
    `)
    .run(
      cache.currentVersion,
      cache.latestVersion,
      cache.checkedAtMs,
      cache.notifiedAtMs,
    );
};

const isFresh = (checkedAtMs: number, nowMs: number): boolean =>
  nowMs >= checkedAtMs && nowMs - checkedAtMs < CHECK_INTERVAL_MS;

const wasRecentlyNotified = (
  notifiedAtMs: number | null | undefined,
  nowMs: number,
): boolean =>
  notifiedAtMs !== null &&
  notifiedAtMs !== undefined &&
  nowMs >= notifiedAtMs &&
  nowMs - notifiedAtMs < NOTIFICATION_INTERVAL_MS;

const combinedSignal = (signal: AbortSignal | undefined): AbortSignal => {
  const timeout = AbortSignal.timeout(NOTICE_TIMEOUT_MS);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
};

const isAborted = (signal: AbortSignal | undefined): boolean =>
  signal?.aborted === true;

export const checkUpdateNotice = async (
  dependencies: UpdateNoticeDependencies,
): Promise<UpdateNotice | undefined> => {
  if (
    dependencies.stateRoot === undefined ||
    isAborted(dependencies.signal)
  ) {
    return undefined;
  }
  let database: Database | undefined;
  let transactionOpen = false;
  try {
    const current = parseStableVersion(dependencies.currentVersion);
    const nowMs = dependencies.now.getTime();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) return undefined;
    database = openCache(dependencies.stateRoot);
    database.run("BEGIN IMMEDIATE");
    transactionOpen = true;
    const cached = readCache(database);
    const matchingCache =
      cached?.currentVersion === dependencies.currentVersion
        ? cached
        : undefined;
    let latestVersion: string;
    let checkedAtMs: number;
    if (
      matchingCache !== undefined &&
      isFresh(matchingCache.checkedAtMs, nowMs)
    ) {
      latestVersion = matchingCache.latestVersion;
      checkedAtMs = matchingCache.checkedAtMs;
    } else {
      latestVersion = await dependencies.latestVersion(
        combinedSignal(dependencies.signal),
      );
      parseStableVersion(latestVersion);
      checkedAtMs = nowMs;
    }
    if (isAborted(dependencies.signal)) return undefined;
    const latest = parseStableVersion(latestVersion);
    const available = compareStableVersions(latest, current) > 0;
    const recentlyNotified =
      matchingCache?.latestVersion === latestVersion &&
      wasRecentlyNotified(matchingCache.notifiedAtMs, nowMs);
    const notifiedAtMs =
      available && !recentlyNotified
        ? nowMs
        : matchingCache?.latestVersion === latestVersion
          ? matchingCache.notifiedAtMs
          : null;
    writeCache(database, {
      currentVersion: dependencies.currentVersion,
      latestVersion,
      checkedAtMs,
      notifiedAtMs,
    });
    database.run("COMMIT");
    transactionOpen = false;
    if (!available || recentlyNotified) return undefined;
    return {
      currentVersion: dependencies.currentVersion,
      latestVersion,
      command: "trajectory update",
    };
  } catch (caught: unknown) {
    if (caught instanceof Error) return undefined;
    throw caught;
  } finally {
    if (transactionOpen) {
      try {
        database?.run("ROLLBACK");
      } catch (caught: unknown) {
        if (!(caught instanceof Error)) throw caught;
      }
    }
    database?.close();
  }
};
