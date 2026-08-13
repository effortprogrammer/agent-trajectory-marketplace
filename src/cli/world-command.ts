import {
  worldDigestSchema,
  worldIdentifierSchema,
  worldUuidSchema,
} from "../worlds/contracts";

type WorldHelpCommand = Readonly<{ readonly command: "world-help" }>;
type WorldListCommand = Readonly<{ readonly command: "world-list"; readonly server: string }>;
type WorldDetailCommand = Readonly<{ readonly command: "world-detail"; readonly server: string; readonly worldId: string }>;
type WorldRunCommand = Readonly<{
  readonly apiKey: string;
  readonly command: "world-run";
  readonly contractId: string;
  readonly idempotencyKey: string;
  readonly json: boolean;
  readonly packDigest: string;
  readonly seed: number;
  readonly server: string;
  readonly worldId: string;
}>;
type WorldStatusCommand = Readonly<{
  readonly apiKey: string;
  readonly command: "world-status";
  readonly contractId: string;
  readonly instanceId: string;
  readonly json: boolean;
  readonly packDigest: string;
  readonly server: string;
  readonly worldId: string;
}>;
type WorldDownloadCommand = Readonly<{
  readonly apiKey: string;
  readonly command: "world-download";
  readonly entitlementId: string;
  readonly json: boolean;
  readonly server: string;
}>;
type InvalidWorldCommand = Readonly<{ readonly command: "invalid_world_command" }>;

export type WorldCommand =
  | WorldHelpCommand
  | WorldListCommand
  | WorldDetailCommand
  | WorldRunCommand
  | WorldStatusCommand
  | WorldDownloadCommand
  | InvalidWorldCommand;

type ParsedOptions = Readonly<{ readonly json: boolean; readonly values: Readonly<Record<string, string>> }>;

const invalid = (): InvalidWorldCommand => ({ command: "invalid_world_command" });
const validText = (value: string | undefined): value is string =>
  value !== undefined && value.length > 0 && value.trim() === value && !/[\u0000-\u0020\u007f]/u.test(value);
const validIdentifier = (value: string | undefined): value is string =>
  worldIdentifierSchema.safeParse(value).success && validText(value);
const validUuid = (value: string | undefined): value is string =>
  worldUuidSchema.safeParse(value).success;
const validDigest = (value: string | undefined): value is string =>
  worldDigestSchema.safeParse(value).success;

const readOptions = (
  argumentsList: readonly string[],
  names: readonly string[],
): ParsedOptions | undefined => {
  const values: Record<string, string> = {};
  let json = false;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const option = argumentsList[index];
    if (option === "--json") {
      if (json) return undefined;
      json = true;
      continue;
    }
    if (option === undefined || !names.includes(option) || values[option] !== undefined) return undefined;
    const value = argumentsList[index + 1];
    if (!validText(value)) return undefined;
    values[option] = value;
    index += 1;
  }
  return { json, values };
};

export const parseWorldCommand = (argumentsList: readonly string[]): WorldCommand => {
  const argumentsWithoutExecutable = argumentsList[0] === "trajectory" ? argumentsList.slice(1) : argumentsList;
  if (argumentsWithoutExecutable[0] !== "world") return invalid();
  const action = argumentsWithoutExecutable[1];
  if (action === "--help") return argumentsWithoutExecutable.length === 2 ? { command: "world-help" } : invalid();
  if (action === "list") {
    const options = readOptions(argumentsWithoutExecutable.slice(2), ["--server"]);
    return options?.values["--server"] === undefined ? invalid() : { command: "world-list", server: options.values["--server"] };
  }
  if (action === "detail") {
    const worldId = argumentsWithoutExecutable[2];
    const options = readOptions(argumentsWithoutExecutable.slice(3), ["--server"]);
    return !validIdentifier(worldId) || options?.values["--server"] === undefined
      ? invalid()
      : { command: "world-detail", server: options.values["--server"], worldId };
  }
  if (action === "run") {
    const worldId = argumentsWithoutExecutable[2];
    const options = readOptions(argumentsWithoutExecutable.slice(3), ["--server", "--contract-id", "--pack-digest", "--seed", "--idempotency-key", "--api-key"]);
    const seed = options === undefined ? Number.NaN : Number(options.values["--seed"]);
    if (!validIdentifier(worldId) || !validUuid(options?.values["--contract-id"]) || !validDigest(options?.values["--pack-digest"]) ||
      !Number.isInteger(seed) || seed < 0 || !validText(options?.values["--idempotency-key"]) || options.values["--idempotency-key"].length > 128 ||
      !validText(options?.values["--server"]) || !validText(options?.values["--api-key"])) return invalid();
    return { apiKey: options.values["--api-key"], command: "world-run", contractId: options.values["--contract-id"], idempotencyKey: options.values["--idempotency-key"], json: options.json, packDigest: options.values["--pack-digest"], seed, server: options.values["--server"], worldId };
  }
  if (action === "status") {
    const worldId = argumentsWithoutExecutable[2];
    const instanceId = argumentsWithoutExecutable[3];
    const options = readOptions(argumentsWithoutExecutable.slice(4), ["--server", "--contract-id", "--pack-digest", "--api-key"]);
    if (!validIdentifier(worldId) || !validIdentifier(instanceId) || !validUuid(options?.values["--contract-id"]) || !validDigest(options?.values["--pack-digest"]) ||
      !validText(options?.values["--server"]) || !validText(options?.values["--api-key"])) return invalid();
    return { apiKey: options.values["--api-key"], command: "world-status", contractId: options.values["--contract-id"], instanceId, json: options.json, packDigest: options.values["--pack-digest"], server: options.values["--server"], worldId };
  }
  if (action === "download") {
    const entitlementId = argumentsWithoutExecutable[2];
    const options = readOptions(argumentsWithoutExecutable.slice(3), ["--server", "--api-key"]);
    if (!validUuid(entitlementId) || !validText(options?.values["--server"]) || !validText(options?.values["--api-key"])) return invalid();
    return { apiKey: options.values["--api-key"], command: "world-download", entitlementId, json: options.json, server: options.values["--server"] };
  }
  return invalid();
};
