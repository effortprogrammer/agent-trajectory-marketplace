import { CollectorRequestError } from "./collector-error";

export type UpdateCommand = Readonly<{
	readonly command: "update";
	readonly verb: "apply" | "status";
}>;

const invalid = (): never => {
	throw new CollectorRequestError();
};

export const parseUpdateCommand = (
	argumentsList: readonly string[],
): UpdateCommand => {
	if (argumentsList.length === 1 && argumentsList[0] === "update") {
		return { command: "update", verb: "apply" };
	}
	if (argumentsList[0] !== "trajectory" || argumentsList[1] !== "update")
		invalid();
	if (argumentsList.length === 2) return { command: "update", verb: "apply" };
	if (argumentsList.length === 3 && argumentsList[2] === "status") {
		return { command: "update", verb: "status" };
	}
	return invalid();
};
