import type { InstallState } from "./install-state";
import {
	runBoundedUpdate,
	UpdateTimeoutError,
	UPDATE_TIMEOUTS,
} from "./update-transaction-runtime";
import type { UpdateServiceHandover } from "./update-transaction";

type ServiceRecoveryRequest = Readonly<{
	fromVersion: string;
	installState: InstallState;
	service: UpdateServiceHandover;
	toVersion: string;
}>;

type CurrentServiceReconciliationRequest = Readonly<{
	currentVersion: string;
	installState: InstallState;
	service: UpdateServiceHandover;
	signal?: AbortSignal;
}>;

type ServiceActivationRequest = Readonly<{
	fromVersion: string;
	installState: InstallState;
	service: UpdateServiceHandover;
	signal?: AbortSignal;
	toVersion: string;
}>;

export const rollbackUpdateService = async (
	request: ServiceRecoveryRequest,
): Promise<boolean> => {
	try {
		await runBoundedUpdate(
			UPDATE_TIMEOUTS.serviceHandoverMs,
			undefined,
			(signal) => request.service.rollback({ ...request, signal }),
		);
		return true;
	} catch (caught: unknown) {
		if (caught instanceof Error) return false;
		throw caught;
	}
};

export const activateUpdateService = async (
	request: ServiceActivationRequest,
): Promise<Readonly<{ canRollback: boolean }> | undefined> => {
	let activation: Promise<void> | undefined;
	try {
		await runBoundedUpdate(
			UPDATE_TIMEOUTS.serviceHandoverMs,
			request.signal,
			(signal) => {
				activation = request.service.activate({ ...request, signal });
				return activation;
			},
		);
		return undefined;
	} catch (caught: unknown) {
		if (!(caught instanceof Error)) throw caught;
		if (activation === undefined) return { canRollback: true };
	}

	try {
		await runBoundedUpdate(
			UPDATE_TIMEOUTS.serviceHandoverMs,
			undefined,
			async () => {
				try {
					await activation;
				} catch (caught: unknown) {
					if (!(caught instanceof Error)) throw caught;
				}
			},
		);
		return { canRollback: true };
	} catch (caught: unknown) {
		if (caught instanceof UpdateTimeoutError) return { canRollback: false };
		throw caught;
	}
};

export const reconcileCurrentUpdateService = async (
	request: CurrentServiceReconciliationRequest,
): Promise<boolean | undefined> => {
	const activationFailure = await activateUpdateService({
		fromVersion: request.currentVersion,
		toVersion: request.currentVersion,
		installState: request.installState,
		service: request.service,
		...(request.signal === undefined ? {} : { signal: request.signal }),
	});
	if (activationFailure === undefined) return undefined;
	return activationFailure.canRollback
		? rollbackUpdateService({
			fromVersion: request.currentVersion,
			toVersion: request.currentVersion,
			installState: request.installState,
			service: request.service,
		})
		: false;
};
