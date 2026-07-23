import { describe, expect, test } from "bun:test";

import {
	CollectorRequestError,
	parseUpdateCommand,
} from "../../../src/cli/collector";

describe("update CLI grammar", () => {
	test("accepts only canonical update, canonical status, and the flat collector alias", () => {
		// Given / When
		const canonical = parseUpdateCommand(["trajectory", "update"]);
		const status = parseUpdateCommand(["trajectory", "update", "status"]);
		const flat = parseUpdateCommand(["update"]);

		// Then
		expect(canonical).toEqual({ command: "update", verb: "apply" });
		expect(status).toEqual({ command: "update", verb: "status" });
		expect(flat).toEqual({ command: "update", verb: "apply" });
	});

	test("rejects malformed update spellings and options", () => {
		// Given
		const malformed = [
			["trajectory", "update", "apply"],
			["trajectory", "update", "status", "extra"],
			["update", "status"],
			["update", "--tag", "v1.2.3"],
		];

		// When / Then
		for (const argumentsList of malformed) {
			expect(() => parseUpdateCommand(argumentsList)).toThrow(
				CollectorRequestError,
			);
		}
	});
});
