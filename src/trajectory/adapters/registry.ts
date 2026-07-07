import { claudeCodeAdapter } from "./claude-code"
import { codexAdapter } from "./codex"
import { type HarnessAdapter, TrajectoryAdapterError } from "./contract"

// Built-in adapter registry. Adding support for another harness (opencode,
// hermes, openclaw, ...) means implementing HarnessAdapter in its own module
// and appending it here — the collect CLI picks it up unchanged.
const builtInAdapters: readonly HarnessAdapter[] = [claudeCodeAdapter, codexAdapter]

const adaptersByRuntime = new Map(builtInAdapters.map((adapter) => [adapter.runtime, adapter]))

export const listHarnessAdapters = (): readonly HarnessAdapter[] =>
  [...adaptersByRuntime.values()].sort((left, right) => left.runtime.localeCompare(right.runtime))

export const getHarnessAdapter = (runtime: string): HarnessAdapter => {
  const adapter = adaptersByRuntime.get(runtime)
  if (adapter === undefined) {
    const available = listHarnessAdapters()
      .map((candidate) => candidate.runtime)
      .join(", ")
    throw new TrajectoryAdapterError(
      "unknown_runtime",
      `unknown_runtime: ${runtime} (available: ${available})`,
    )
  }
  return adapter
}

export const registerHarnessAdapter = (adapter: HarnessAdapter): void => {
  if (adaptersByRuntime.has(adapter.runtime)) {
    throw new TrajectoryAdapterError(
      "unknown_runtime",
      `duplicate_runtime: ${adapter.runtime} is already registered`,
    )
  }
  adaptersByRuntime.set(adapter.runtime, adapter)
}
