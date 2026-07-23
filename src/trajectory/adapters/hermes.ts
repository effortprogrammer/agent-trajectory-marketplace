import { homedir } from "node:os"
import { join } from "node:path"

import type { HarnessAdapter } from "./contract"
import { convertHermesSession, hermesRuntime } from "./hermes/convert"
import { listHermesSessions } from "./hermes/discovery"

export const hermesAdapter: HarnessAdapter = {
  runtime: hermesRuntime,
  displayName: "Hermes Agent",
  logHint: "~/.hermes/state.db (sessions + messages tables, one store for all sessions)",
  defaultSourceDir: () => {
    const home = homedir()
    return home.length === 0 ? undefined : join(home, ".hermes")
  },
  listSessions: listHermesSessions,
  convertSession: convertHermesSession,
}
