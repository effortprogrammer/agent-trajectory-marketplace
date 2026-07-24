# ATM (Agent Trajectory Marketplace)

ATM collects local Claude Code, Codex, Hermes, OpenClaw, OpenCode, and pi-family (oh-my-pi, senpi, gajae-code) sessions and exports credential-redacted ATF datasets. Run it only after you consent to this local collection.

```bash
curl -fsSL https://github.com/effortprogrammer/agent-trajectory-marketplace/releases/latest/download/install-agent.sh | bash -s -- --dir atm
```

The installer requires Git, Bun 1.3+, and either macOS launchd or Linux systemd `--user`. It starts collection immediately and checks immutable stable GitHub Releases every six hours. Updates never pull mutable `main`; a failed service handover rolls back to the previous release while preserving `collected/` and watch state.

```bash
bun atm/current/dist/collector.js trajectory collect service status
bun atm/current/dist/collector.js trajectory update status
bun atm/current/dist/collector.js trajectory update
```
