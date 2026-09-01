import { z } from "zod";

import { parseAdmissionJson } from "./json-preflight";

const maximumSafeInteger = Number.MAX_SAFE_INTEGER;
const payoutRequestTimestampSchema = z.iso
	.datetime()
	.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
const payoutRequestIdSchema = z
	.string()
	.regex(
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	);
const safeIntegerSchema = z.number().int().min(0).max(maximumSafeInteger);
const payoutRequestStatuses = [
	"requested",
	"pending",
	"approved",
	"processing",
	"cancelled",
	"rejected",
	"paid",
] as const;
const payoutRequestStatusSchema = z.enum(payoutRequestStatuses);
const safeTextSchema = z
	.string()
	.min(1)
	.max(255)
	.refine((value) =>
		[...value].every((character) => {
			const code = character.charCodeAt(0);
			return code >= 32 && code !== 127;
		}),
	);

export const payoutRequestV2ErrorMessages = {
	invalid_request: "The payout request is invalid.",
	unauthorized: "Authentication is required.",
	forbidden: "Payout request access is not permitted.",
	open_request_exists: "An active payout request already exists.",
	request_not_withdrawable: "This payout request can no longer be withdrawn.",
	payout_request_conflict:
		"The payout request conflicts with an existing operation.",
	below_payout_threshold: "At least USD 100.00 is required to request payout.",
	rate_limited: "Too many payout request attempts. Try again later.",
	payout_request_creation_disabled:
		"Payout requests are temporarily unavailable.",
	payout_request_service_unavailable: "Payout request service is unavailable.",
	payout_request_v1_disabled: "Payout request v1 creation is disabled.",
} as const;

const payoutRequestV2ErrorCodes = [
	"invalid_request",
	"unauthorized",
	"forbidden",
	"open_request_exists",
	"request_not_withdrawable",
	"payout_request_conflict",
	"below_payout_threshold",
	"rate_limited",
	"payout_request_creation_disabled",
	"payout_request_service_unavailable",
	"payout_request_v1_disabled",
] as const;
const payoutRequestV2ErrorCodeSchema = z.enum(payoutRequestV2ErrorCodes);

export const payoutRequestV2DetailSchema = z
	.object({
		requestId: payoutRequestIdSchema,
		grossMinor: safeIntegerSchema.min(10000),
		feeMinor: safeIntegerSchema,
		netMinor: safeIntegerSchema,
		feePolicyVersion: z.literal(1),
		feeBasisPoints: z.literal(1000),
		feeRounding: z.literal("floor"),
		status: payoutRequestStatusSchema,
		requestedAt: payoutRequestTimestampSchema,
		approvedAt: payoutRequestTimestampSchema.nullable(),
		rejectedReason: safeTextSchema.nullable(),
		paidAt: payoutRequestTimestampSchema.nullable(),
		externalReference: safeTextSchema.nullable(),
	})
	.strict()
	.superRefine((value, context) => {
		const issues: ReadonlyArray<readonly [boolean, string]> = [
			[
				value.feeMinor !==
					Math.floor((value.grossMinor * value.feeBasisPoints) / 10_000),
				"feeMinor",
			],
			[value.grossMinor !== value.feeMinor + value.netMinor, "netMinor"],
			[
				(value.status === "approved" ||
					value.status === "processing" ||
					value.status === "paid") !==
					(value.approvedAt !== null),
				"approvedAt",
			],
			[
				(value.status === "rejected") !== (value.rejectedReason !== null),
				"rejectedReason",
			],
			[(value.status === "paid") !== (value.paidAt !== null), "paidAt"],
			[
				(value.status === "paid") !== (value.externalReference !== null),
				"externalReference",
			],
		];
		for (const [invalid, path] of issues) {
			if (invalid)
				context.addIssue({
					code: "custom",
					message: `payout v2 fact mismatch: ${path}`,
					path: [path],
				});
		}
	});

export const payoutRequestV2EnvelopeSchema = z
	.object({
		ok: z.literal(true),
		payoutRequest: z
			.object({
				currency: z.literal("USD"),
				thresholdMinor: z.literal(10000),
				availableMinor: safeIntegerSchema,
				heldMinor: safeIntegerSchema,
				request: payoutRequestV2DetailSchema.nullable(),
			})
			.strict(),
	})
	.strict();

export const payoutRequestV2ErrorSchema = z
	.object({
		ok: z.literal(false),
		error: z
			.object({
				code: payoutRequestV2ErrorCodeSchema,
				message: safeTextSchema,
			})
			.strict(),
	})
	.strict();

export type PayoutRequestV2Detail = z.infer<typeof payoutRequestV2DetailSchema>;
export type PayoutRequestV2Envelope = z.infer<
	typeof payoutRequestV2EnvelopeSchema
>;
export type PayoutRequestV2Error = z.infer<typeof payoutRequestV2ErrorSchema>;
export type PayoutRequestV2HttpResponse =
	| PayoutRequestV2Envelope
	| PayoutRequestV2Error;

export class PayoutRequestV2ContractError extends Error {
	public readonly name = "PayoutRequestV2ContractError";
	public constructor() {
		super("invalid_response");
	}
}

const errorCodesByStatus = new Map<
	number,
	ReadonlySet<keyof typeof payoutRequestV2ErrorMessages>
>([
	[400, new Set(["invalid_request"])],
	[401, new Set(["unauthorized"])],
	[403, new Set(["forbidden"])],
	[
		409,
		new Set([
			"open_request_exists",
			"request_not_withdrawable",
			"payout_request_conflict",
		]),
	],
	[410, new Set(["payout_request_v1_disabled"])],
	[422, new Set(["below_payout_threshold"])],
	[429, new Set(["rate_limited"])],
	[
		503,
		new Set([
			"payout_request_creation_disabled",
			"payout_request_service_unavailable",
		]),
	],
]);

const assertNever = (_value: never): never => {
	throw new PayoutRequestV2ContractError();
};

export const encodePayoutRequestV2Response = (
	response: PayoutRequestV2HttpResponse,
): Buffer => {
	switch (response.ok) {
		case true: {
			const { payoutRequest } = response;
			return Buffer.from(
				JSON.stringify({
					ok: true,
					payoutRequest: {
						currency: payoutRequest.currency,
						thresholdMinor: payoutRequest.thresholdMinor,
						availableMinor: payoutRequest.availableMinor,
						heldMinor: payoutRequest.heldMinor,
						request: payoutRequest.request,
					},
				}),
				"utf8",
			);
		}
		case false:
			return Buffer.from(
				JSON.stringify({ ok: false, error: response.error }),
				"utf8",
			);
		default:
			return assertNever(response);
	}
};

export const parsePayoutRequestV2Response = (
	status: number,
	bytes: Uint8Array,
): PayoutRequestV2HttpResponse => {
	const input = parseAdmissionJson(Buffer.from(bytes));
	if (input === undefined) throw new PayoutRequestV2ContractError();
	let response: PayoutRequestV2HttpResponse;
	if (status === 200 || status === 201) {
		const parsed = payoutRequestV2EnvelopeSchema.safeParse(input);
		if (!parsed.success) throw new PayoutRequestV2ContractError();
		response = parsed.data;
	} else {
		const allowedCodes = errorCodesByStatus.get(status);
		if (allowedCodes === undefined) throw new PayoutRequestV2ContractError();
		const parsed = payoutRequestV2ErrorSchema.safeParse(input);
		if (
			!parsed.success ||
			!allowedCodes.has(parsed.data.error.code) ||
			parsed.data.error.message !==
				payoutRequestV2ErrorMessages[parsed.data.error.code]
		) {
			throw new PayoutRequestV2ContractError();
		}
		response = parsed.data;
	}
	if (!Buffer.from(bytes).equals(encodePayoutRequestV2Response(response)))
		throw new PayoutRequestV2ContractError();
	return response;
};
