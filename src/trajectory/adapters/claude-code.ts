import type { HarnessAdapter } from "./contract"
import { convertClaudeCodeSession } from "./claude-code-conversion"
import {
  claudeCodeDefaultSourceDir,
  listClaudeCodeSessions,
} from "./claude-code-discovery"

const claudeCodeRuntime = "claude-code"

export const claudeCodeAdapter: HarnessAdapter = {
  runtime: claudeCodeRuntime,
  displayName: "Claude Code",
  logHint: "~/.claude/projects/<project>/<sessionId>.jsonl",
  defaultSourceDir: claudeCodeDefaultSourceDir,
  listSessions: listClaudeCodeSessions,
  convertSession: convertClaudeCodeSession,
}
