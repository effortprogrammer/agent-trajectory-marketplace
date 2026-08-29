type ProcessStepId = "collect" | "publish" | "redact";
type ProcessStep = Readonly<{
	body: string;
	command: string;
	id: ProcessStepId;
	number: string;
	title: string;
}>;

const INSTALL_COMMAND =
	"curl -fsSL https://github.com/effortprogrammer/agent-trajectory-marketplace/releases/latest/download/install-agent.sh | bash -s -- --dir atm";

const PROCESS_STEPS: readonly ProcessStep[] = [
	{
		body: "ATM finds sessions from supported coding agents on your machine.",
		command: "trajectory collect sessions codex",
		id: "collect",
		number: "01",
		title: "Collect locally",
	},
	{
		body: "Credentials and detected secrets are removed locally before upload.",
		command:
			"trajectory marketplace seller candidate bundle --root /tmp/atm-sessions --print-selection",
		id: "redact",
		number: "02",
		title: "Redact before upload",
	},
	{
		body: "You review the exact sessions and publish only what you approve.",
		command:
			"trajectory marketplace seller candidate publish --bundle /tmp/candidate.zip",
		id: "publish",
		number: "03",
		title: "Publish",
	},
];

export { INSTALL_COMMAND, PROCESS_STEPS, type ProcessStepId };
