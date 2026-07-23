export const UPDATE_TIMEOUTS = {
	buildMs: 180_000,
	downloadMs: 60_000,
	serviceHandoverMs: 60_000,
} as const;

export class UpdateTimeoutError extends Error {
	readonly name = "UpdateTimeoutError";
}

export const runBoundedUpdate = async <T>(
	timeoutMs: number,
	callerSignal: AbortSignal | undefined,
	operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	const signal = callerSignal === undefined
		? timeoutSignal
		: AbortSignal.any([callerSignal, timeoutSignal]);
	if (signal.aborted) throw new UpdateTimeoutError();
	const aborted = Promise.withResolvers<never>();
	const abort = (): void => aborted.reject(new UpdateTimeoutError());
	signal.addEventListener("abort", abort, { once: true });
	try {
		return await Promise.race([operation(signal), aborted.promise]);
	} finally {
		signal.removeEventListener("abort", abort);
	}
};
