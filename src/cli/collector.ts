import {
  collectWatchServiceStatus,
  installCollectWatchService,
  type CollectServiceInstallResult,
  type CollectServiceStatusResult,
  type CollectServiceUninstallResult,
  uninstallCollectWatchService,
} from "@/trajectory/collect-service";
import {
  type CollectSweepConfig,
  type CollectSweepSummary,
  resolveCollectWatchRuntimes,
  runCollectSweep,
  runCollectWatchLoop,
} from "@/trajectory/collect-watch";
import {
  type CollectExportResult,
  type CollectRuntimeSummary,
  type CollectSessionsResult,
  exportCollectedSession,
  listCollectRuntimes,
  listCollectSessions,
} from "@/trajectory/collect";

type CollectorCliResult =
  | readonly CollectRuntimeSummary[]
  | CollectSessionsResult
  | CollectExportResult
  | CollectSweepSummary
  | CollectServiceInstallResult
  | CollectServiceStatusResult
  | CollectServiceUninstallResult;

export class CollectorRequestError extends Error {
  readonly name = "CollectorRequestError";

  constructor() {
    super("invalid_collector_request");
  }
}

type CollectWatchRequest = Readonly<{ readonly command: "watch"; readonly intervalSeconds: number; readonly once: boolean; readonly outDir?: string; readonly outputRoot?: string; readonly runtimes: readonly string[]; readonly settleSeconds: number; readonly sourceDir?: string }>;

export type CollectorCommand = Readonly<{ readonly command: "runtimes" }> | Readonly<{ readonly command: "sessions"; readonly limit: number; readonly runtime: string; readonly sourceDir?: string }> | Readonly<{ readonly command: "export"; readonly exportPath: string; readonly outputRoot?: string; readonly runtime: string; readonly session: string; readonly sourceDir?: string }> | CollectWatchRequest | Readonly<{ readonly command: "service"; readonly verb: "status" | "uninstall" }> | Readonly<{ readonly command: "service"; readonly dryRun: boolean; readonly intervalSeconds: number; readonly outDir?: string; readonly outputRoot?: string; readonly runtimes?: readonly string[]; readonly settleSeconds: number; readonly sourceDir?: string; readonly verb: "install" }> | Readonly<{ readonly command: "telemetry"; readonly outDir: string; readonly verb: "installed" }>;

type RawOptions = Readonly<{ flags: ReadonlySet<string>; values: Readonly<Record<string, string>>; variadic: Readonly<Record<string, readonly string[]>> }>;

const invalid = (): never => { throw new CollectorRequestError(); };

const integer = (value: string | undefined, fallback: number, positive = false): number => { const parsed = value === undefined ? fallback : Number(value); if (!Number.isInteger(parsed) || (positive ? parsed <= 0 : parsed < 0)) invalid(); return parsed; };

const readOptions = (
  args: readonly string[],
  valueNames: ReadonlySet<string>,
  flagNames: ReadonlySet<string> = new Set(),
  variadicNames: ReadonlySet<string> = new Set(),
): RawOptions => {
  const values: Record<string, string> = {};
  const variadic: Record<string, readonly string[]> = {};
  const flags = new Set<string>();
  for (let index = 0; index < args.length;) {
    const option = args[index];
    if (option === undefined || !option.startsWith("--")) invalid();
    if (flagNames.has(option)) {
      if (flags.has(option)) invalid();
      flags.add(option);
      index += 1;
      continue;
    }
    if (!valueNames.has(option) || option in values || (option in variadic && !variadicNames.has(option))) invalid();
    const first = args[index + 1];
    if (first === undefined || first.startsWith("--")) invalid();
    if (variadicNames.has(option)) {
      const collected: string[] = [];
      while (index + 1 < args.length && !args[index + 1]?.startsWith("--")) {
        const value = args[index + 1];
        if (value === undefined) invalid();
        collected.push(value);
        index += 1;
      }
      variadic[option] = [...(variadic[option] ?? []), ...collected];
      index += 1;
      continue;
    }
    values[option] = first;
    index += 2;
  }
  return { flags, values, variadic };
};

const required = (value: string | undefined): string => (value === undefined || value.length === 0 ? invalid() : value);

const parseCollectWatch = (args: readonly string[], canonical: boolean, service = false): CollectorCommand => {
  const values = canonical ? new Set(["--out", "--runtime", "--source", "--interval-seconds", "--settle-seconds"]) : new Set(["--runtime", "--source-dir", "--output-root", "--interval-seconds", "--settle-seconds"]);
  const options = readOptions(args, values, new Set(service ? ["--dry-run"] : ["--once"]), canonical ? new Set(["--runtime"]) : new Set());
  const runtimes = canonical ? options.variadic["--runtime"] ?? [] : options.values["--runtime"] === undefined ? [] : [options.values["--runtime"]];
  const sourceDir = options.values[canonical ? "--source" : "--source-dir"];
  if (!canonical) { required(options.values["--runtime"]); required(sourceDir); }
  if (sourceDir !== undefined && runtimes.length !== 1) invalid();
  const outDir = options.values["--out"];
  const outputRoot = options.values["--output-root"];
  if (canonical) required(outDir);
  else required(outputRoot);
  const parsed: CollectWatchRequest = {
    command: "watch",
    intervalSeconds: integer(options.values["--interval-seconds"], 30, true),
    once: options.flags.has("--once"),
    ...(outDir === undefined ? {} : { outDir }),
    ...(outputRoot === undefined ? {} : { outputRoot }),
    runtimes,
    settleSeconds: integer(options.values["--settle-seconds"], 60),
    ...(sourceDir === undefined ? {} : { sourceDir }),
  };
  if (!service) return parsed;
  const serviceRequest = {
    command: "service" as const,
    dryRun: options.flags.has("--dry-run"),
    intervalSeconds: parsed.intervalSeconds,
    ...(parsed.outDir === undefined ? {} : { outDir: parsed.outDir }),
    ...(parsed.outputRoot === undefined ? {} : { outputRoot: parsed.outputRoot }),
    runtimes: parsed.runtimes,
    settleSeconds: parsed.settleSeconds,
    ...(parsed.sourceDir === undefined ? {} : { sourceDir: parsed.sourceDir }),
    verb: "install" as const,
  };
  return serviceRequest;
};

const parseCanonical = (args: readonly string[]): CollectorCommand => {
  const action = args[2];
  if (args[0] !== "trajectory" || args[1] !== "collect" || action === undefined) invalid();
  if (action === "runtimes") return args.length === 3 ? { command: "runtimes" } : invalid();
  if (action === "sessions") {
    const runtime = args[3];
    if (runtime === undefined || runtime.startsWith("--")) invalid();
    const options = readOptions(args.slice(4), new Set(["--source", "--limit"]));
    return { command: "sessions", limit: integer(options.values["--limit"], 20, true), runtime, ...(options.values["--source"] === undefined ? {} : { sourceDir: options.values["--source"] }) };
  }
  if (action === "export") {
    const runtime = args[3];
    if (runtime === undefined || runtime.startsWith("--")) invalid();
    const options = readOptions(args.slice(4), new Set(["--session", "--export", "--source"]));
    return { command: "export", exportPath: required(options.values["--export"]), runtime, session: required(options.values["--session"]), ...(options.values["--source"] === undefined ? {} : { sourceDir: options.values["--source"] }) };
  }
  if (action === "watch") return parseCollectWatch(args.slice(3), true);
  if (action === "telemetry") {
    if (args[3] !== "installed") invalid();
    const options = readOptions(args.slice(4), new Set(["--out"]));
    return { command: "telemetry", outDir: required(options.values["--out"]), verb: "installed" };
  }
  if (action === "service") {
    const verb = args[3];
    if (verb === "status" || verb === "uninstall") return args.length === 4 ? { command: "service", verb } : invalid();
    if (verb !== "install") invalid();
    return parseCollectWatch(args.slice(4), true, true);
  }
  return invalid();
};

const parseFlat = (args: readonly string[]): CollectorCommand => {
  const action = args[0];
  if (action === "runtimes") return args.length === 1 ? { command: "runtimes" } : invalid();
  if (action === "sessions") {
    const options = readOptions(args.slice(1), new Set(["--runtime", "--source-dir", "--limit"]));
    return { command: "sessions", limit: integer(options.values["--limit"], 20, true), runtime: required(options.values["--runtime"]), sourceDir: required(options.values["--source-dir"]) };
  }
  if (action === "export") {
    const options = readOptions(args.slice(1), new Set(["--runtime", "--source-dir", "--output-root", "--session", "--export-path"]));
    return { command: "export", exportPath: required(options.values["--export-path"]), outputRoot: required(options.values["--output-root"]), runtime: required(options.values["--runtime"]), session: required(options.values["--session"]), sourceDir: required(options.values["--source-dir"]) };
  }
  if (action === "watch") return parseCollectWatch(args.slice(1), false);
  if (action === "service") {
    const verb = args[1];
    if (verb === "status" || verb === "uninstall") return args.length === 2 ? { command: "service", verb } : invalid();
    if (verb !== "install") invalid();
    return parseCollectWatch(args.slice(2), false, true);
  }
  return invalid();
};

export const parseCollectorCommand = (argumentsList: readonly string[]): CollectorCommand => {
  if (argumentsList[0] === "trajectory") return parseCanonical(argumentsList);
  if (argumentsList[0] === "collect") return parseCanonical(["trajectory", ...argumentsList]);
  return parseFlat(argumentsList);
};

const collectSweepConfig = (command: CollectWatchRequest): CollectSweepConfig => {
  const outDir = command.outDir ?? command.outputRoot;
  if (outDir === undefined) return invalid();
  return {
    outDir,
    runtimes: command.runtimes,
    settleSeconds: command.settleSeconds,
    ...(command.sourceDir === undefined ? {} : { sourceDir: command.sourceDir }),
  };
};

export const runCollectorCli = (argumentsList: readonly string[]): CollectorCliResult => {
  const command = parseCollectorCommand(argumentsList);
  switch (command.command) {
    case "runtimes":
      return listCollectRuntimes();
    case "sessions":
      return listCollectSessions({
        limit: command.limit,
        runtime: command.runtime,
        ...(command.sourceDir === undefined ? {} : { sourceDir: command.sourceDir }),
      });
    case "export":
      return exportCollectedSession({
        exportPath: command.exportPath,
        ...(command.outputRoot === undefined ? {} : { outputRoot: command.outputRoot }),
        runtime: command.runtime,
        session: command.session,
        ...(command.sourceDir === undefined ? {} : { sourceDir: command.sourceDir }),
      });
    case "watch": {
      if (!command.once) return invalid();
      return runCollectSweep(collectSweepConfig(command));
    }
    case "service": {
      switch (command.verb) {
        case "install": {
          const sweep = collectSweepConfig({ ...command, command: "watch", once: false, runtimes: command.runtimes ?? [] });
          return installCollectWatchService({
            config: {
              ...sweep,
              intervalSeconds: command.intervalSeconds,
              runtimes: [...resolveCollectWatchRuntimes(sweep.runtimes)],
            },
            dryRun: command.dryRun,
          });
        }
        case "status":
          return collectWatchServiceStatus();
        case "uninstall":
          return uninstallCollectWatchService();
      }
    }
    case "telemetry":
      return invalid();
  }
};

export const runCollectorResidentCli = async (
  argumentsList: readonly string[],
  onSweep: (summary: CollectSweepSummary) => void,
  shouldContinue: () => boolean,
): Promise<void> => {
  const command = parseCollectorCommand(argumentsList);
  if (command.command !== "watch") return invalid();
  const config = collectSweepConfig(command);
  if (command.once) {
    onSweep(runCollectSweep(config));
    return;
  }
  await runCollectWatchLoop({
    config,
    intervalSeconds: command.intervalSeconds,
    onSweep,
    shouldContinue,
  });
};
