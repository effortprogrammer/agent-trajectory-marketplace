import { claudeCodeAdapter } from "./claude-code";
import { type HarnessAdapter, TrajectoryAdapterError } from "./contract";
import { codexAdapter } from "./codex";
import { hermesAdapter } from "./hermes";
import { openclawAdapter } from "./openclaw";
import { opencodeAdapter } from "./opencode";
import { gajaeCodeAdapter, ohMyPiAdapter, senpiAdapter } from "./pi-family";

const builtInAdapters: readonly HarnessAdapter[] = [
  claudeCodeAdapter,
  codexAdapter,
  hermesAdapter,
  openclawAdapter,
  opencodeAdapter,
  // pi-family: three pi-mono-lineage forks sharing one session parser but
  // registered as distinct runtimes so traces attribute the exact tool.
  ohMyPiAdapter,
  senpiAdapter,
  gajaeCodeAdapter,
];

const adaptersByRuntime = new Map(builtInAdapters.map((adapter) => [adapter.runtime, adapter]));

export const registerHarnessAdapter = (adapter: HarnessAdapter): void => {
  if (adaptersByRuntime.has(adapter.runtime)) {
    throw new TrajectoryAdapterError("unknown_runtime", `duplicate_runtime: ${adapter.runtime}`);
  }
  adaptersByRuntime.set(adapter.runtime, adapter);
};

export const listHarnessAdapters = (): readonly HarnessAdapter[] =>
  [...adaptersByRuntime.values()].sort((left, right) => left.runtime.localeCompare(right.runtime));

export const getHarnessAdapter = (runtime: string): HarnessAdapter => {
  const adapter = adaptersByRuntime.get(runtime);
  if (adapter === undefined) {
    const available = listHarnessAdapters().map((candidate) => candidate.runtime).join(", ");
    throw new TrajectoryAdapterError("unknown_runtime", `unknown_runtime: ${runtime} (available: ${available})`);
  }
  return adapter;
};
