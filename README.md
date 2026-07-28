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

## Review console

See what was collected, decide what to upload, and read exactly how the privacy filter
rewrote each session — all locally.

```bash
trajectory console --root <your-collect-out-dir>
```

Opens on `http://127.0.0.1:4317`. Use `--port` to change it, `--open` to launch a browser.

| Tab | Answers |
|-----|---------|
| **Overview** | How many sessions exist, per day, and how many needed redaction |
| **Sessions** | What each session was about, and which ones you have selected for upload |
| **Privacy filter** | Where the filter fired, under which rule family, with the stored text around each marker |
| **Upload** | Exactly how many sessions, bytes, and events a candidate bundle would carry |

The console binds loopback only and refuses any other hostname. It reads the trace root and
writes nothing except `upload-selection.json` inside it. Selecting a session records intent —
it does not publish anything. Publication stays an explicit
`trajectory marketplace seller candidate publish` step.

The stored trace is already redacted, so the console shows what would leave the machine.
It never reconstructs a pre-redaction value.
