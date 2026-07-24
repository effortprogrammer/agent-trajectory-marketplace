// The pi family: coding agents that inherited badlogic/pi-mono's session
// subsystem. oh-my-pi and senpi are detached forks of pi-mono; gajae-code
// brands itself independent but its session layer is oh-my-pi-derived (same
// header/entry taxonomy, extended with v4/v5 append-only patch records). All
// three persist sessions as JSONL under `~/<configDir>/agent/sessions/`, so
// one parser core serves every variant — but each variant registers as its own
// runtime so exported traces are attributable to the exact tool that produced
// them.
export type PiFamilyRuntime = "oh-my-pi" | "senpi" | "gajae-code"

export type PiFamilyVariant = Readonly<{
  runtime: PiFamilyRuntime
  displayName: string
  // Home-relative config directory the tool rebranded to (".omp", ".senpi",
  // ".gjc"). Doubles as the strongest provenance marker: a session path that
  // traverses another variant's config dir is misattributed.
  configDirName: string
  logHint: string
  // Highest session header version this variant is known to write. gajae-code
  // moved to v4/v5 (patch records); oh-my-pi and senpi still write v3.
  maxSessionVersion: number
}>

export const piFamilyVariants: readonly PiFamilyVariant[] = [
  {
    runtime: "oh-my-pi",
    displayName: "Oh My Pi",
    configDirName: ".omp",
    logHint: "~/.omp/agent/sessions/<dir-encoded>/<timestamp>_<sessionId>.jsonl",
    maxSessionVersion: 3,
  },
  {
    runtime: "senpi",
    displayName: "Senpi",
    configDirName: ".senpi",
    logHint: "~/.senpi/agent/sessions/--<dir-encoded>--/<timestamp>_<sessionId>.jsonl",
    maxSessionVersion: 3,
  },
  {
    runtime: "gajae-code",
    displayName: "Gajae Code",
    configDirName: ".gjc",
    logHint: "~/.gjc/agent/sessions/v2-<workspace-digest>/<timestamp>_<sessionId>.jsonl",
    maxSessionVersion: 5,
  },
] as const

export const piFamilyVariantByRuntime: ReadonlyMap<PiFamilyRuntime, PiFamilyVariant> = new Map(
  piFamilyVariants.map((variant) => [variant.runtime, variant]),
)
