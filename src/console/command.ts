import { isAbsolute } from "node:path";

const loopbackHostnames = new Set(["127.0.0.1", "::1", "localhost"]);
const defaultPort = 4317;

export type ConsoleCommand =
  | Readonly<{
      readonly command: "console";
      readonly root: string;
      readonly hostname: string;
      readonly port: number;
      readonly open: boolean;
    }>
  | Readonly<{ readonly command: "invalid_command" }>;

const invalid: ConsoleCommand = { command: "invalid_command" };

export const isConsoleInvocation = (argumentsList: readonly string[]): boolean =>
  argumentsList[0] === "console";

export const parseConsoleCommand = (argumentsList: readonly string[]): ConsoleCommand => {
  if (!isConsoleInvocation(argumentsList)) return invalid;
  let root: string | undefined;
  let hostname: string | undefined;
  let port: number | undefined;
  let open = false;

  for (let index = 1; index < argumentsList.length; index += 1) {
    const flag = argumentsList[index];
    if (flag === "--open") {
      open = true;
      continue;
    }
    const value = argumentsList[index + 1];
    if (value === undefined || value.startsWith("--")) return invalid;
    index += 1;
    switch (flag) {
      case "--root": {
        if (root !== undefined) return invalid;
        root = value;
        break;
      }
      case "--hostname": {
        if (hostname !== undefined) return invalid;
        hostname = value;
        break;
      }
      case "--port": {
        if (port !== undefined) return invalid;
        if (!/^\d+$/u.test(value)) return invalid;
        port = Number.parseInt(value, 10);
        break;
      }
      default:
        return invalid;
    }
  }

  if (root === undefined || !isAbsolute(root)) return invalid;
  const resolvedHostname = hostname ?? "127.0.0.1";
  if (!loopbackHostnames.has(resolvedHostname)) return invalid;
  const resolvedPort = port ?? defaultPort;
  if (resolvedPort < 1 || resolvedPort > 65_535) return invalid;

  return { command: "console", root, hostname: resolvedHostname, port: resolvedPort, open };
};
