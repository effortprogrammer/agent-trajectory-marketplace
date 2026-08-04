# ATM (Agent Trajectory Marketplace)

ATM collects your local coding-agent sessions and exports credential-redacted ATF datasets.

> **Consent notice:** ATM reads coding-agent session logs on this machine. Run it only after you consent to this local collection.

## Supported agents

| Harness | Supported |
|---------|:---------:|
| [Claude Code](https://claude.com/claude-code) | ✅ |
| [Codex CLI](https://github.com/openai/codex) | ✅ |
| [Hermes Agent](https://github.com/nousresearch/hermes-agent) | ✅ |
| [OpenClaw](https://github.com/openclaw/openclaw) | ✅ |
| [OpenCode](https://github.com/sst/opencode) | ✅ |
| [Oh My Pi](https://github.com/can1357/oh-my-pi) | ✅ |
| [Senpi](https://github.com/code-yeongyu/senpi) | ✅ |
| [Gajae Code](https://github.com/Yeachan-Heo/gajae-code) | ✅ |

New agent support ships with releases and reaches installed collectors automatically — no reinstall needed.

## Quick start

```bash
curl -fsSL https://github.com/effortprogrammer/agent-trajectory-marketplace/releases/latest/download/install-agent.sh | bash -s -- --dir atm
```

Requires **Git** and **Bun 1.3+**.

The installer starts collection immediately and checks immutable stable GitHub Releases every six hours.

## Candidate publication

Publish one locally validated dataset bundle with:

```bash
trajectory marketplace seller candidate publish \
  --bundle /absolute/path/to/candidate.zip \
  --server https://registry.example.com
```

Credentials resolve in this order: explicit `--api-key`, `TRAJECTORY_REGISTRY_API_KEY`, then an active stored login for the same server. A defined but invalid higher-priority credential fails locally instead of selecting another identity.

Each invocation validates and consumes one bundle without automatic HTTP retries. Rerun the command to reread and revalidate the file after a retryable server or network error.
