import { expect, test } from "bun:test";
import type {
	ReleaseTransport,
	ReleaseTransportRequest,
} from "../../../src/trajectory/update-release-verifier";
import { createGitHubUpdateSource } from "../../../src/trajectory/update-runtime";

test("resolves an equal latest stable GitHub release as up to date", async () => {
	// Given
	const requests: ReleaseTransportRequest[] = [];
	const transport: ReleaseTransport = {
		request: async (request) => {
			requests.push(request);
			return {
				status: 200,
				headers: {},
				body: new TextEncoder().encode(JSON.stringify({ tag_name: "v1.0.0" })),
			};
		},
	};
	const source = createGitHubUpdateSource(transport);

	// When
	const result = await source.resolve({
		currentVersion: "1.0.0",
		timeoutMs: 60_000,
		signal: new AbortController().signal,
	});

	// Then
	expect(result).toEqual({ kind: "up_to_date", version: "1.0.0" });
	expect(requests.map(({ url }) => url)).toEqual([
		"https://api.github.com/repos/effortprogrammer/agent-trajectory-marketplace/releases/latest",
	]);
	expect(requests[0]?.signal).toBeInstanceOf(AbortSignal);
});
