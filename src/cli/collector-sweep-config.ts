import type { CollectSweepConfig } from "@/trajectory/collect-watch";

import { CollectorRequestError } from "./collector-error";

type CollectSweepRequest = Readonly<{
  declareRuntime?: "pi";
  outDir?: string;
  outputRoot?: string;
  runtimes: readonly string[];
  settleSeconds: number;
  sourceDir?: string;
}>;

export const collectSweepConfig = (command: CollectSweepRequest): CollectSweepConfig => {
  const outDir = command.outDir ?? command.outputRoot;
  if (outDir === undefined) throw new CollectorRequestError();
  return {
    ...(command.declareRuntime === undefined ? {} : { declareRuntime: command.declareRuntime }),
    outDir,
    runtimes: command.runtimes,
    settleSeconds: command.settleSeconds,
    ...(command.sourceDir === undefined ? {} : { sourceDir: command.sourceDir }),
  };
};
