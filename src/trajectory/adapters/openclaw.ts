import { homedir } from "node:os";
import { join } from "node:path";

import { type HarnessAdapter } from "./contract";
import { convertOpenclawSession } from "./openclaw/convert";
import { listOpenclawSessions } from "./openclaw/discovery";

const runtime = "openclaw";

export const openclawAdapter: HarnessAdapter = {
  runtime,
  displayName: "OpenClaw",
  logHint: "~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl",
  defaultSourceDir: () => {
    const home = homedir();
    return home.length === 0 ? undefined : join(home, ".openclaw");
  },
  listSessions: listOpenclawSessions,
  convertSession: convertOpenclawSession,
};
