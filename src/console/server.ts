import { statSync } from "node:fs";

import { parseConsoleCommand } from "./command";
import { ConsoleError } from "./contract";
import { handleConsoleRequest } from "./routes";

export type ConsoleServer = Readonly<{
  readonly url: string;
  readonly stop: () => Promise<void>;
}>;

const assertReadableRoot = (root: string): void => {
  try {
    if (!statSync(root).isDirectory()) throw new ConsoleError("invalid_root");
  } catch (error) {
    if (error instanceof ConsoleError) throw error;
    throw new ConsoleError("invalid_root");
  }
};

export const startConsoleServer = (
  options: Readonly<{ root: string; hostname: string; port: number }>,
): ConsoleServer => {
  assertReadableRoot(options.root);
  const server = Bun.serve({
    hostname: options.hostname,
    port: options.port,
    fetch: (request) => handleConsoleRequest(request, options.root),
  });
  return {
    url: `http://${options.hostname}:${server.port}`,
    stop: async () => {
      await server.stop(true);
    },
  };
};

export const runConsoleCli = async (
  argumentsList: readonly string[],
  write: (line: string) => void,
): Promise<number> => {
  const command = parseConsoleCommand(argumentsList);
  if (command.command === "invalid_command") {
    write("usage: trajectory console --root <absolute-dir> [--port <n>] [--hostname <loopback>] [--open]");
    return 2;
  }
  let server: ConsoleServer;
  try {
    server = startConsoleServer(command);
  } catch (error) {
    write(error instanceof ConsoleError ? error.code : "console_failed");
    return 1;
  }
  write(`console ready at ${server.url}`);
  write(`root ${command.root}`);
  if (command.open) Bun.spawn(["open", server.url]).unref();
  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      void server.stop().then(resolve);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
  return 0;
};
