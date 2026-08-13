import { normalizeAuthServerUrl } from "../auth/server-url";
import { WorldClientError, createWorldClient } from "../worlds/client";
import { parseWorldCommand } from "./world-command";

export class WorldCliError extends Error {
  readonly name = "WorldCliError";

  constructor(readonly code: "invalid_arguments" | "invalid_response") {
    super(code);
  }
}

const help = "Usage: trajectory world --help | trajectory world list --server <url> | trajectory world detail <worldId> --server <url> | trajectory world run <worldId> --server <url> --contract-id <uuid> --pack-digest <64hex> --seed <nonnegative-int> --idempotency-key <nonempty> --api-key <token> [--json] | trajectory world status <worldId> <instanceId> --server <url> --contract-id <uuid> --pack-digest <64hex> --api-key <token> [--json] | trajectory world download <entitlementId> --server <url> --api-key <token> [--json]";

const invalid = (): never => {
  throw new WorldCliError("invalid_arguments");
};

const hostedResult = (
  response: Awaited<ReturnType<ReturnType<typeof createWorldClient>["createHostedInstance"]>>,
  worldId: string,
  packDigest: string,
) => {
  if (!response.ok) throw new WorldCliError("invalid_response");
  const result = response.result;
  if (result["worldId"] !== worldId || result["packDigest"] !== packDigest) {
    throw new WorldCliError("invalid_response");
  }
  return response;
};

export const isWorldInvocation = (argumentsList: readonly string[]): boolean => {
  const offset = argumentsList[0] === "trajectory" ? 1 : 0;
  return argumentsList[offset] === "world";
};

export const runWorldCli = async (argumentsList: readonly string[], signal: AbortSignal): Promise<void> => {
  try {
    const command = parseWorldCommand(argumentsList);
    switch (command.command) {
      case "world-help":
        console.log(help);
        return;
      case "world-list":
        console.log(JSON.stringify(await createWorldClient(normalizeAuthServerUrl(command.server), signal).catalog()));
        return;
      case "world-detail":
        console.log(JSON.stringify(await createWorldClient(normalizeAuthServerUrl(command.server), signal).world({ worldId: command.worldId })));
        return;
      case "world-run": {
        if (signal.aborted) throw new WorldClientError("cancelled", 0);
        const client = createWorldClient(normalizeAuthServerUrl(command.server), signal);
        const response = await client.createHostedInstance({
          accessToken: command.apiKey,
          body: { seed: command.seed },
          contractId: command.contractId,
          idempotencyKey: command.idempotencyKey,
          packDigest: command.packDigest,
        });
        console.log(JSON.stringify(hostedResult(response, command.worldId, command.packDigest)));
        return;
      }
      case "world-status": {
        if (signal.aborted) throw new WorldClientError("cancelled", 0);
        const client = createWorldClient(normalizeAuthServerUrl(command.server), signal);
        const response = await client.hostedStatus({
          accessToken: command.apiKey,
          contractId: command.contractId,
          instanceId: command.instanceId,
          packDigest: command.packDigest,
        });
        console.log(JSON.stringify(hostedResult(response, command.worldId, command.packDigest)));
        return;
      }
      case "world-download": {
        if (signal.aborted) throw new WorldClientError("cancelled", 0);
        const response = await createWorldClient(normalizeAuthServerUrl(command.server), signal).redeemDownload({
          accessToken: command.apiKey,
          entitlementId: command.entitlementId,
        });
        if (response.entitlementId !== command.entitlementId) throw new WorldCliError("invalid_response");
        console.log(JSON.stringify(response));
        return;
      }
      case "invalid_world_command":
        return invalid();
    }
    const exhaustive: never = command;
    return exhaustive;
  } catch (error) {
    const code = error instanceof WorldClientError
      ? error.code === "invalid_request" ? "invalid_arguments" : error.code
      : error instanceof WorldCliError ? error.code : "invalid_response";
    process.stderr.write(`${JSON.stringify({ error: { code, message: code } })}\n`);
    process.exitCode = 2;
  }
};
