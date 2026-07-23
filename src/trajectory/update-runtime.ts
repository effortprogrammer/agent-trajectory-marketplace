import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import ky from "ky";
import { z } from "zod";

import {
	compareStableVersions,
	parseStableVersion,
	ReleaseContractError,
	UPDATE_RELEASE,
} from "./update-release-contract";
import {
	type ReleaseTransport,
	type ReleaseTransportRequest,
	type ReleaseTransportResponse,
	verifyAvailableRelease,
} from "./update-release-verifier";
import type { UpdateBuilder, UpdateReleaseSource } from "./update-transaction";

const latestReleaseSchema = z.object({ tag_name: z.string() }).passthrough();
const latestReleaseUrl = `https://api.github.com/repos/${UPDATE_RELEASE.repository}/releases/latest`;

const readBoundedBody = async (
	response: Response,
	maxBytes: number,
): Promise<Uint8Array> => {
	if (response.body === null) return new Uint8Array();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		while (true) {
			const item = await reader.read();
			if (item.done) break;
			length += item.value.byteLength;
			if (length > maxBytes) {
				await reader.cancel();
				throw new ReleaseContractError(
					"invalid-release",
					"release response exceeds size limit",
				);
			}
			chunks.push(item.value);
		}
	} finally {
		reader.releaseLock();
	}
	const body = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
};

export const createKyReleaseTransport = (): ReleaseTransport => ({
	request: async (request): Promise<ReleaseTransportResponse> => {
		const response = await ky(request.url, {
			headers: { accept: "application/vnd.github+json" },
			redirect: "manual",
			retry: 0,
			signal: request.signal,
			throwHttpErrors: false,
			timeout: false,
		});
		const location = response.headers.get("location");
		return {
			status: response.status,
			headers: location === null ? {} : { location },
			body: await readBoundedBody(response, request.maxBytes),
		};
	},
});

class ScopedReleaseTransport implements ReleaseTransport {
	constructor(
		private readonly transport: ReleaseTransport,
		private readonly outerSignal: AbortSignal,
	) {}

	request(request: ReleaseTransportRequest): Promise<ReleaseTransportResponse> {
		return this.transport.request({
			...request,
			signal: AbortSignal.any([request.signal, this.outerSignal]),
		});
	}
}

export const createGitHubUpdateSource = (
	transport: ReleaseTransport = createKyReleaseTransport(),
): UpdateReleaseSource => ({
	resolve: async ({ currentVersion, signal }) => {
		const current = parseStableVersion(currentVersion);
		const scoped = new ScopedReleaseTransport(transport, signal);
		const latestResponse = await scoped.request({
			url: latestReleaseUrl,
			maxBytes: UPDATE_RELEASE.manifestMaxBytes,
			signal,
		});
		if (latestResponse.status !== 200) {
			throw new ReleaseContractError(
				"invalid-release",
				"latest release request failed",
			);
		}
		const decoded: unknown = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(latestResponse.body),
		);
		const latest = latestReleaseSchema.parse(decoded);
		if (!latest.tag_name.startsWith("v")) {
			throw new ReleaseContractError(
				"invalid-release",
				"latest release tag is not stable",
			);
		}
		const version = parseStableVersion(latest.tag_name.slice(1));
		if (compareStableVersions(version, current) <= 0) {
			return { kind: "up_to_date", version: currentVersion };
		}
		const verified = await verifyAvailableRelease({
			currentVersion,
			targetTag: latest.tag_name,
			transport: scoped,
		});
		return {
			kind: "available",
			version: verified.version,
			archive: verified.archiveBytes,
		};
	},
});

class UpdateBuildError extends Error {
	readonly name = "UpdateBuildError";
}

const runCommand = async (
	command: readonly string[],
	cwd: string,
	signal: AbortSignal,
): Promise<void> => {
	if (signal.aborted) throw new UpdateBuildError();
	const child = Bun.spawn([...command], {
		cwd,
		stdout: "ignore",
		stderr: "ignore",
	});
	const abort = (): void => child.kill();
	signal.addEventListener("abort", abort, { once: true });
	try {
		const exitCode = await child.exited;
		if (exitCode !== 0 || signal.aborted) throw new UpdateBuildError();
	} finally {
		signal.removeEventListener("abort", abort);
	}
};

export const createBunUpdateBuilder = (): UpdateBuilder => ({
	stage: async ({ archive, stagingDir, signal }) => {
		const archivePath = join(
			dirname(stagingDir),
			`.update-archive-${crypto.randomUUID()}.tar.gz`,
		);
		mkdirSync(stagingDir, { recursive: true });
		try {
			await Bun.write(archivePath, archive);
			await runCommand(
				["tar", "-xzf", archivePath, "-C", stagingDir, "--strip-components=1"],
				stagingDir,
				signal,
			);
			await runCommand(
				[process.execPath, "install", "--frozen-lockfile"],
				stagingDir,
				signal,
			);
			await runCommand(
				[process.execPath, "run", "build:collector"],
				stagingDir,
				signal,
			);
			if (!existsSync(join(stagingDir, "dist", "collector.js")))
				throw new UpdateBuildError();
		} finally {
			rmSync(archivePath, { force: true });
		}
	},
});
