import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";
import type {
	PayoutRequestV2Detail,
	PayoutRequestV2HttpResponse,
} from "../../../src/marketplace/payout-request-v2-contract";
import {
	encodePayoutRequestV2Response,
	PayoutRequestV2ContractError,
	parsePayoutRequestV2Response,
} from "../../../src/marketplace/payout-request-v2-contract";

const fixtureRoot = join(
	import.meta.dir,
	"../../../contract/payout-request/v2",
);
const v1Hashes = {
	"approved-200.json":
		"6b8ddeee40909dee45e85142ec9aedbc8d7d99e47f6577787cbc71089aab5b38",
	"cancelled-200.json":
		"00cedb693195ff66fa741358b059dcaf2839307805ccf47833a35dccd33eee82",
	"error-400-invalid-request.json":
		"5e2019d45fd1df53ed46bd2e047b56af43eaed77b7a405c88ba94a7a7d8d8be2",
	"error-401-unauthorized.json":
		"4f8989d23b2185a16438d91e02d420a8b348385c3d6d8e09b0f7c8f25c5424b0",
	"error-403-forbidden.json":
		"2131f27caab8b3e2042e0a79fe4fbb45074bdc0ee3fd2e3d12efcd78ab2f998f",
	"error-409-conflict.json":
		"82cabbfba8500b4ec0c06d188437ed78aa06cfd84ae5226b9030da739d68b770",
	"error-409-not-withdrawable.json":
		"3ea840650fda6a3ce5cdd8252c188186baeaca495d2d48a7344bb54f4e93c51f",
	"error-409-open-request.json":
		"7da4428e2c8da09bb9a376055c504f4a5c0110e101f2e155b91b74dd1f1f205c",
	"error-422-below-threshold.json":
		"38bdba62db42091d8737f1d1e68b384b0a58118df8d4fc22dacbbb845dc92a41",
	"error-429-rate-limited.json":
		"eb472dc597279c9dd1b11b11e65dba505054485e7120baf2efb8af7b9a6b5591",
	"error-503-creation-disabled.json":
		"225e7f9ce7a1ec97625183fe5a929920f4926459e0d3f064fd595f8588843eea",
	"error-503-service-unavailable.json":
		"f5aa17fba0cbbff1f2a4dc3a5e17faf76a73f251bd3b4981d8de6365edaba355",
	"get-empty-200.json":
		"480a680264f127870e74919ca647ec6f545e540c6789ea7c14fb2bb9e49c387e",
	"manifest.json":
		"5228772256c652181a5ced835d2782b25caf46aa038cfba4bafa149cc9295d06",
	"paid-200.json":
		"4e9bfbc01865126eaef954e5fd98af0f108957da48a3cbe3f7dc91c87ac18a54",
	"pending-200.json":
		"c772e87d918094610eaa4bed8b8a9d870ae6fd02089a0d3a20cdf00436ddb7a7",
	"processing-200.json":
		"db14033d74e2fb5a8b893dd53391a0e153d0f47ac67a6c712baf81332d4bb7e0",
	"rejected-200.json":
		"856c0c293afa225c0257bb7455c5ac11208672e2ebb63bbf73e69032c91eb0e2",
	"requested-201.json":
		"3cc560d8eb6f1b2200b5f0926d932a928cfa9cc01839dd82767d6bfc360c0bf3",
	"requested-replay-200.json":
		"3cc560d8eb6f1b2200b5f0926d932a928cfa9cc01839dd82767d6bfc360c0bf3",
	"verify.ts":
		"d5e06c8e167008b25b2fa6221431212a6e098de6893849da7f232f0c04cb5139",
	"withdrawn-200.json":
		"f12aab19edeac150cd38fc542ea7202b13c573df464c2fc821daa9b34bdea1e2",
} as const;

const manifestSchema = z
	.object({
		accept: z.array(
			z
				.object({
					file: z.string(),
					sha256: z.string(),
					status: z.number().int(),
				})
				.strict(),
		),
		reject: z.array(
			z
				.object({
					file: z.string(),
					sha256: z.string(),
					status: z.number().int(),
				})
				.strict(),
		),
		schemaVersion: z.literal(2),
	})
	.strict();

const manifest = async (): Promise<z.infer<typeof manifestSchema>> =>
	manifestSchema.parse(
		JSON.parse(await readFile(join(fixtureRoot, "manifest.json"), "utf8")),
	);
const fixture = async (name: string): Promise<Buffer> =>
	readFile(join(fixtureRoot, name));

describe("payout request v2 contract", () => {
	it("round trips every accepted frozen frame byte-for-byte", async () => {
		// Given: the v2 acceptance manifest.
		const { accept } = await manifest();

		// When: each exact frame is parsed and re-encoded.
		const encoded = await Promise.all(
			accept.map(async ({ file, status }) =>
				encodePayoutRequestV2Response(
					parsePayoutRequestV2Response(status, await fixture(file)),
				),
			),
		);

		// Then: every emitted byte remains frozen.
		expect(encoded).toEqual(
			await Promise.all(accept.map(({ file }) => fixture(file))),
		);
	});

	it("admits exact maximum-safe fees and rejects a fee one credit too high", () => {
		// Given: a gross amount whose fee multiplication exceeds Number's safe range.
		const exact = Buffer.from(
			'{"ok":true,"payoutRequest":{"currency":"USD","thresholdMinor":10000,"availableMinor":0,"heldMinor":9007199254740969,"request":{"requestId":"00000000-0000-4000-8000-000000000208","grossMinor":9007199254740969,"feeMinor":900719925474096,"netMinor":8106479329266873,"feePolicyVersion":1,"feeBasisPoints":1000,"feeRounding":"floor","status":"requested","requestedAt":"2026-09-01T00:00:00Z","approvedAt":null,"rejectedReason":null,"paidAt":null,"externalReference":null}}}',
		);
		const feeOneTooHigh = Buffer.from(
			'{"ok":true,"payoutRequest":{"currency":"USD","thresholdMinor":10000,"availableMinor":0,"heldMinor":9007199254740969,"request":{"requestId":"00000000-0000-4000-8000-000000000208","grossMinor":9007199254740969,"feeMinor":900719925474097,"netMinor":8106479329266872,"feePolicyVersion":1,"feeBasisPoints":1000,"feeRounding":"floor","status":"requested","requestedAt":"2026-09-01T00:00:00Z","approvedAt":null,"rejectedReason":null,"paidAt":null,"externalReference":null}}}',
		);

		// When: both boundary frames cross the Zod response boundary.
		// Then: only the mathematically exact fee is admitted.
		expect(() => parsePayoutRequestV2Response(200, exact)).not.toThrow();
		expect(() => parsePayoutRequestV2Response(200, feeOneTooHigh)).toThrow(
			PayoutRequestV2ContractError,
		);
	});

	it("encodes caller-constructed nested request and error objects canonically", async () => {
		// Given: valid typed values with deliberately reversed nested insertion order.
		const reversedRequest = {
			externalReference: null,
			paidAt: null,
			rejectedReason: null,
			approvedAt: null,
			requestedAt: "2026-09-01T00:00:00Z",
			status: "requested",
			feeRounding: "floor",
			feeBasisPoints: 1000,
			feePolicyVersion: 1,
			netMinor: 9001,
			feeMinor: 1000,
			grossMinor: 10001,
			requestId: "00000000-0000-4000-8000-000000000201",
		} satisfies PayoutRequestV2Detail;
		const response = {
			payoutRequest: {
				request: reversedRequest,
				heldMinor: 10001,
				availableMinor: 0,
				thresholdMinor: 10000,
				currency: "USD",
			},
			ok: true,
		} satisfies PayoutRequestV2HttpResponse;
		const error = {
			error: {
				message: "Payout request v1 creation is disabled.",
				code: "payout_request_v1_disabled",
			},
			ok: false,
		} satisfies PayoutRequestV2HttpResponse;

		// When: the public encoder receives caller insertion order rather than Zod output.
		// Then: nested keys still match the canonical checked-in bytes.
		expect(encodePayoutRequestV2Response(response)).toEqual(
			await fixture("requested-201.json"),
		);
		expect(encodePayoutRequestV2Response(error)).toEqual(
			await fixture("error-410-v1-creation-disabled.json"),
		);
	});

	it("accepts only the canonical weekly gross-limit error at status 429", () => {
		const canonical = Buffer.from(
			'{"ok":false,"error":{"code":"weekly_payout_limit_reached","message":"The rolling weekly payout limit has been reached."}}',
		);
		const wrongMessage = Buffer.from(
			'{"ok":false,"error":{"code":"weekly_payout_limit_reached","message":"Other message."}}',
		);

		expect(parsePayoutRequestV2Response(429, canonical)).toEqual({
			error: {
				code: "weekly_payout_limit_reached",
				message: "The rolling weekly payout limit has been reached.",
			},
			ok: false,
		});
		expect(() => parsePayoutRequestV2Response(429, wrongMessage)).toThrow(
			PayoutRequestV2ContractError,
		);
	});

	it("rejects every frozen malformed frame", async () => {
		// Given: malformed, reordered, numeric, and fee-mismatch frames.
		const { reject } = await manifest();

		// When: each frame crosses the strict response boundary.
		// Then: no malformed frame can become a typed response.
		for (const { file, status } of reject) {
			const bytes = await fixture(file);
			expect(() => parsePayoutRequestV2Response(status, bytes)).toThrow(
				PayoutRequestV2ContractError,
			);
		}
	});

	it("pins every v2 manifest digest and retains all v1 bytes", async () => {
		// Given: the independently verified v2 manifest and frozen v1 tree.
		const payoutV2 = await manifest();
		const fixtures = [...payoutV2.accept, ...payoutV2.reject];
		const marketplaceV2Names = (await readdir(fixtureRoot))
			.filter((file) => file.endsWith(".json") && file !== "manifest.json")
			.sort();
		const marketplaceV1Root = join(
			import.meta.dir,
			"../../../contract/payout-request/v1",
		);

		// When: every declared v2 and retained v1 digest is computed.
		const v2DigestEntries = await Promise.all(
			fixtures.map(async ({ file }) => [
				file,
				createHash("sha256")
					.update(await readFile(join(fixtureRoot, file)))
					.digest("hex"),
			] as const),
		);
		const v1DigestEntries = await Promise.all(
			(await readdir(marketplaceV1Root)).map(
				async (file) =>
					[
						file,
						createHash("sha256")
							.update(await readFile(join(marketplaceV1Root, file)))
							.digest("hex"),
					] as const,
			),
		);

		// Then: the local corpus matches its manifest and v1 remains unchanged.
		expect(marketplaceV2Names).toEqual(
			fixtures.map(({ file }) => file).sort(),
		);
		expect(Object.fromEntries(v2DigestEntries)).toEqual(
			Object.fromEntries(
				fixtures.map(({ file, sha256 }) => [file, sha256]),
			),
		);
		expect(Object.fromEntries(v1DigestEntries)).toEqual(v1Hashes);
	});
});
