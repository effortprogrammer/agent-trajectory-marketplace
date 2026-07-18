import { homedir } from "node:os"
import { join } from "node:path"
import process from "node:process"

import type { HarnessAdapter } from "../contract"
import { convertOpenCodeSession, opencodeRuntime } from "./convert"
import { listOpenCodeSessions } from "./database"

export const resolveOpenCodeDataDir = (
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string | undefined => {
  // biome-ignore lint/complexity/useLiteralKeys: ProcessEnv is index-signature typed under noPropertyAccessFromIndexSignature.
  const xdgData = env["XDG_DATA_HOME"]
  if (xdgData !== undefined && xdgData.length > 0) {
    return join(xdgData, "opencode")
  }
  if (home.length === 0) return undefined
  return join(home, ".local", "share", "opencode")
}

export const opencodeAdapter: HarnessAdapter = {
  runtime: opencodeRuntime,
  displayName: "OpenCode",
  logHint: "~/.local/share/opencode/opencode*.db (shared SQLite store, channel-suffixed)",
  defaultSourceDir: resolveOpenCodeDataDir,
  listSessions: listOpenCodeSessions,
  convertSession: convertOpenCodeSession,
}
