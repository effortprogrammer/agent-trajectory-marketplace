# ATM seller onboarding

Use this guide to install ATM, review the user's local coding-agent sessions, and publish only the sessions the user explicitly approves.

Reply in the user's language. Work autonomously except for the decisions this guide reserves for the user.

## Safety rules

- Install only the latest official immutable ATM GitHub release.
- Keep session discovery, previews, and inspection local until the user gives final upload approval.
- Never expose credentials, authentication tokens, raw secrets, or raw private transcripts in chat.
- Do not add or broaden collection `--source` overrides unless the user explicitly asks.
- Do not assume every ready session is approved.
- Do not authenticate or make a publish request before the final upload confirmation.
- Never bypass a selection error by using `--trace`, omitting `--selection`, or reusing stale approval values.
- Do not request payout or perform unrelated seller actions.

## Workflow

### 1. Check prerequisites

Confirm that Git and Bun 1.3 or newer are available. If a prerequisite is missing, explain what is missing and ask before installing it.

### 2. Install ATM

Choose absolute paths for the install root and collected-session output, tell the user those paths, and run only:

```bash
curl -fsSL https://github.com/effortprogrammer/agent-trajectory-marketplace/releases/latest/download/install-agent.sh | bash -s -- --dir <ABSOLUTE_INSTALL_ROOT> --out <ABSOLUTE_SESSION_ROOT>
```

Use the installed CLI at:

```text
<ABSOLUTE_INSTALL_ROOT>/current/dist/collector.js
```

The installer starts native collection for supported runtimes. Preserve its credential redaction and local output boundaries.

### 3. Preview local sessions

Before authentication or upload, run:

```bash
bun <ABSOLUTE_INSTALL_ROOT>/current/dist/collector.js marketplace seller sessions choose --root <ABSOLUTE_SESSION_ROOT> --json
```

Summarize every ready session in a compact numbered list using only the bounded preview fields: runtime, date, topic, event count, selector, and approval value. Separately list blocked sessions and their admission reasons. Do not paste raw transcripts.

Offer local inspection when the user needs more context:

```bash
bun <ABSOLUTE_INSTALL_ROOT>/current/dist/collector.js marketplace seller sessions inspect <FULL_SELECTOR> --root <ABSOLUTE_SESSION_ROOT> --json
```

### 4. Ask what to include and exclude

Ask the user which sessions to include and which to exclude. Resolve ambiguous answers by asking again.

If the user selects none or cancels, stop without authenticating, bundling, or uploading.

### 5. Create the approved selection

Write a content-bound selection document containing only the chosen sessions:

```bash
bun <ABSOLUTE_INSTALL_ROOT>/current/dist/collector.js marketplace seller sessions choose --root <ABSOLUTE_SESSION_ROOT> --out <ABSOLUTE_SELECTION_JSON> --approve <FULL_SELECTOR>@<SOURCE_SHA256> [--approve <FULL_SELECTOR>@<SOURCE_SHA256> ...]
```

### 6. Build only from the selection

```bash
bun <ABSOLUTE_INSTALL_ROOT>/current/dist/collector.js marketplace seller candidate bundle --root <ABSOLUTE_SESSION_ROOT> --out <ABSOLUTE_BUNDLE_ZIP> --selection <ABSOLUTE_SELECTION_JSON>
```

Show the exact final included and excluded session lists.

### 7. Ask for final upload approval

Ask:

> Upload exactly these approved sessions to ATM now?

Treat anything except an explicit yes as no. Do not authenticate or make a publish request before this confirmation.

### 8. Authenticate after approval

After explicit confirmation, check `auth status`. If needed, guide the user through the official `auth login` or `auth signup` and `auth verify` flow. Do not print the verification code or token. Never put an API key on the command line unless the user explicitly chooses that.

### 9. Publish the same approved selection

```bash
bun <ABSOLUTE_INSTALL_ROOT>/current/dist/collector.js marketplace seller candidate publish --bundle <ABSOLUTE_BUNDLE_ZIP> --selection <ABSOLUTE_SELECTION_JSON>
```

If ATM reports selection drift, membership mismatch, a changed session, or `invalid_bundle_request`, stop. Return to the local preview, request fresh approval, create a new selection, and rebuild.

### 10. Report the result

Report the final submission receipt and status URL.
