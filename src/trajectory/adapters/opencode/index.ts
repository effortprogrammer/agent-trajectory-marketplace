import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import type { HarnessAdapter } from "../contract";
import { convertOpenCodeSession, opencodeRuntime } from "./convert";
import { listOpenCodeSessions } from "./database";

export const resolveOpenCodeDataDir = (
  home = homedir(),
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined => {
  const xdgDataHome = env["XDG_DATA_HOME"];
  if (xdgDataHome !== undefined && xdgDataHome.length > 0) return join(xdgDataHome, "opencode");
  return home.length === 0 ? undefined : join(home, ".local", "share", "opencode");
};

export const opencodeAdapter: HarnessAdapter = {
  displayName: "OpenCode",
  logHint: "~/.local/share/opencode/opencode*.db (shared SQLite store, channel-suffixed)",
  runtime: opencodeRuntime,
  defaultSourceDir: resolveOpenCodeDataDir,
  listSessions: listOpenCodeSessions,
  convertSession: convertOpenCodeSession,
};
