export class CollectorRequestError extends Error {
	readonly name = "CollectorRequestError";

	constructor() {
		super("invalid_collector_request");
	}
}
