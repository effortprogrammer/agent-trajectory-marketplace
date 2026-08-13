// The pi family: upstream Pi and coding agents that inherited its session
// subsystem. Every variant persists JSONL under
// `~/<configDir>/agent/sessions/`, so one parser core serves the family while
// each runtime stays explicitly attributable.
export type PiFamilyRuntime = "pi" | "oh-my-pi" | "senpi" | "gajae-code";

export type PiFamilyVariant = Readonly<{
  runtime: PiFamilyRuntime;
  displayName: string;
  // Home-relative config directory (".pi", ".omp", ".senpi", ".gjc").
  // Doubles as the strongest provenance marker: a session path that traverses
  // another variant's config dir is misattributed.
  configDirName: string;
  logHint: string;
  // Highest session header version this variant is known to write. gajae-code
  // moved to v4/v5 (patch records); oh-my-pi and senpi still write v3.
  maxSessionVersion: number;
}>;

export const piFamilyVariants: readonly PiFamilyVariant[] = [
  {
    runtime: "pi",
    displayName: "Pi",
    configDirName: ".pi",
    logHint: "~/.pi/agent/sessions/--<dir-encoded>--/<timestamp>_<sessionId>.jsonl",
    maxSessionVersion: 3,
  },
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
] as const;
