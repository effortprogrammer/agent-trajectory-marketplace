import type { InstallState } from "./install-state";
import {
	runBoundedUpdate,
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

export const reconcileCurrentUpdateService = async (
	request: CurrentServiceReconciliationRequest,
): Promise<boolean | undefined> => {
	try {
		await runBoundedUpdate(
			UPDATE_TIMEOUTS.serviceHandoverMs,
			request.signal,
			(signal) => request.service.activate({
				fromVersion: request.currentVersion,
				toVersion: request.currentVersion,
				installState: request.installState,
				signal,
			}),
		);
		return undefined;
	} catch (caught: unknown) {
		if (!(caught instanceof Error)) throw caught;
		return rollbackUpdateService({
			fromVersion: request.currentVersion,
			toVersion: request.currentVersion,
			installState: request.installState,
			service: request.service,
		});
	}
};
