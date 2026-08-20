import { CollectorRequestError } from "./collector-error";

export type UpdateCommand = Readonly<{
	readonly command: "update";
}>;

const invalid = (): never => {
	throw new CollectorRequestError();
};

export const parseUpdateCommand = (
	argumentsList: readonly string[],
): UpdateCommand => {
	if (argumentsList.length === 1 && argumentsList[0] === "update") {
		return { command: "update" };
	}
	if (argumentsList[0] !== "trajectory" || argumentsList[1] !== "update")
		invalid();
	if (argumentsList.length === 2) return { command: "update" };
	return invalid();
};
