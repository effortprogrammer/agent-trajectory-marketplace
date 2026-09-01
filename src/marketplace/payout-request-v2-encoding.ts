import type {
	PayoutRequestV2Detail,
	PayoutRequestV2Error,
} from "./payout-request-v2-contract";

export const encodePayoutRequestV2Detail = (
	request: PayoutRequestV2Detail,
) => ({
	requestId: request.requestId,
	grossMinor: request.grossMinor,
	feeMinor: request.feeMinor,
	netMinor: request.netMinor,
	feePolicyVersion: request.feePolicyVersion,
	feeBasisPoints: request.feeBasisPoints,
	feeRounding: request.feeRounding,
	status: request.status,
	requestedAt: request.requestedAt,
	approvedAt: request.approvedAt,
	rejectedReason: request.rejectedReason,
	paidAt: request.paidAt,
	externalReference: request.externalReference,
});

export const encodePayoutRequestV2Error = (
	error: PayoutRequestV2Error["error"],
) => ({
	code: error.code,
	message: error.message,
});
