import { expect, test } from "bun:test";
import { parseCollectorCommand } from "../src/cli/collector";
import {
	parseCandidateBundle,
	parseCandidatePublish,
} from "../src/cli/marketplace-candidate-command";
import { PROCESS_STEPS } from "./content";

const commandArguments = (title: string): readonly string[] => {
	const command = PROCESS_STEPS.find((step) => step.title === title)?.command;
	if (command === undefined) throw new Error(`Missing process step: ${title}`);
	const [executable, ...argumentsList] = command.split(" ");
	expect(executable).toBe("trajectory");
	return argumentsList;
};

test("process commands satisfy the CLI parser contracts", () => {
	const collectArguments = commandArguments("Collect locally");
	expect(parseCollectorCommand(collectArguments)).toEqual({
		command: "sessions",
		limit: 20,
		runtime: "codex",
	});

	const bundleArguments = commandArguments("Redact before upload");
	expect(bundleArguments.slice(0, 4)).toEqual([
		"marketplace",
		"seller",
		"candidate",
		"bundle",
	]);
	expect(parseCandidateBundle(bundleArguments.slice(4))).toEqual({
		command: "candidate-bundle",
		mode: "preview",
		root: "/tmp/atm-sessions",
	});

	const publishArguments = commandArguments("Publish");
	expect(publishArguments.slice(0, 4)).toEqual([
		"marketplace",
		"seller",
		"candidate",
		"publish",
	]);
	expect(parseCandidatePublish(publishArguments.slice(4))).toEqual({
		bundle: "/tmp/candidate.zip",
		command: "candidate-publish",
	});
});
