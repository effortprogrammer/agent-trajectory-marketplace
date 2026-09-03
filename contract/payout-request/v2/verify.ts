import { createHash } from "node:crypto";
import { lstatSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { z } from "zod";

import {
	FixtureReadError,
	readFixtureFile,
} from "../../../src/marketplace/fixture-reader";
import { parseAdmissionJson } from "../../../src/marketplace/json-preflight";
import {
	PayoutRequestV2ContractError,
	parsePayoutRequestV2Response,
} from "../../../src/marketplace/payout-request-v2-contract";

const acceptedFixtureFiles = [
	"get-empty-200.json",
	"requested-201.json",
	"pending-200.json",
	"approved-200.json",
	"processing-200.json",
	"cancelled-200.json",
	"rejected-200.json",
	"paid-200.json",
	"max-safe-200.json",
	"error-410-v1-creation-disabled.json",
] as const;
const rejectedFixtureFiles = [
	"reject-extra-field.json",
	"reject-reordered.json",
	"reject-float-gross.json",
	"reject-negative-fee.json",
	"reject-unsafe-net.json",
	"reject-gross-fee-net.json",
	"reject-fee-floor.json",
	"reject-max-safe-fee-high.json",
] as const;
const expectedDirectoryFiles = [
	...acceptedFixtureFiles,
	...rejectedFixtureFiles,
	"manifest.json",
	"verify.ts",
].sort();

const fixtureSchema = z
	.object({
		file: z.string().regex(/^[a-z0-9-]+\.json$/),
		sha256: z.string().regex(/^[0-9a-f]{64}$/),
		status: z.number().int().min(100).max(599),
	})
	.strict();
const manifestSchema = z
	.object({
		accept: z.array(fixtureSchema).length(acceptedFixtureFiles.length),
		reject: z.array(fixtureSchema).length(rejectedFixtureFiles.length),
		schemaVersion: z.literal(2),
	})
	.strict();
type Fixture = z.infer<typeof fixtureSchema>;

class FixtureVerificationError extends Error {
	public constructor(
		public readonly file: string,
		public readonly reason: string,
	) {
		super(`${file}: ${reason}`);
	}
}

const argumentValue = (name: string): string => {
	const index = Bun.argv.indexOf(name);
	const value = Bun.argv[index + 1];
	if (index === -1 || value === undefined)
		throw new FixtureVerificationError("arguments", `missing ${name}`);
	return value;
};

const readBounded = (path: string, maximumBytes: number): Buffer => {
	try {
		return readFixtureFile(path, maximumBytes);
	} catch (error) {
		if (error instanceof FixtureReadError)
			throw new FixtureVerificationError(path, error.reason);
		throw error;
	}
};

const validateFixtureSet = (
	fixtures: readonly Fixture[],
	expected: readonly string[],
	label: string,
): void => {
	if (fixtures.some((fixture, index) => fixture.file !== expected[index])) {
		throw new FixtureVerificationError(label, "fixture set mismatch");
	}
};

const manifestPath = argumentValue("--manifest");
const manifestInput = parseAdmissionJson(readBounded(manifestPath, 64 * 1024));
if (manifestInput === undefined)
	throw new FixtureVerificationError(manifestPath, "invalid manifest");
const manifest = manifestSchema.safeParse(manifestInput);
if (!manifest.success)
	throw new FixtureVerificationError(manifestPath, "invalid manifest");
validateFixtureSet(manifest.data.accept, acceptedFixtureFiles, manifestPath);
validateFixtureSet(manifest.data.reject, rejectedFixtureFiles, manifestPath);
const fixtureRoot = dirname(resolve(manifestPath));
const root = lstatSync(fixtureRoot);
if (!root.isDirectory() || root.isSymbolicLink())
	throw new FixtureVerificationError(
		manifestPath,
		"fixture root is not a regular directory",
	);
const directoryFiles = readdirSync(fixtureRoot).sort();
if (
	directoryFiles.length !== expectedDirectoryFiles.length ||
	directoryFiles.some(
		(file, index) => file !== expectedDirectoryFiles[index],
	) ||
	directoryFiles.some((file) => {
		const stat = lstatSync(join(fixtureRoot, file));
		return !stat.isFile() || stat.isSymbolicLink();
	})
)
	throw new FixtureVerificationError(manifestPath, "fixture set mismatch");

const verifyDigest = (fixture: Fixture): Buffer => {
	const bytes = readBounded(join(fixtureRoot, fixture.file), 16 * 1024 * 1024);
	if (createHash("sha256").update(bytes).digest("hex") !== fixture.sha256) {
		throw new FixtureVerificationError(fixture.file, "sha256 mismatch");
	}
	return bytes;
};

for (const fixture of manifest.data.accept) {
	const bytes = verifyDigest(fixture);
	try {
		parsePayoutRequestV2Response(fixture.status, bytes);
	} catch (error) {
		if (error instanceof PayoutRequestV2ContractError) {
			throw new FixtureVerificationError(fixture.file, "expected accept");
		}
		throw error;
	}
}
for (const fixture of manifest.data.reject) {
	const bytes = verifyDigest(fixture);
	try {
		parsePayoutRequestV2Response(fixture.status, bytes);
	} catch (error) {
		if (error instanceof PayoutRequestV2ContractError) continue;
		throw error;
	}
	throw new FixtureVerificationError(fixture.file, "expected reject");
}

process.stdout.write(
	`verified ${manifest.data.accept.length} accepted and ${manifest.data.reject.length} rejected payout-request v2 fixtures\n`,
);
