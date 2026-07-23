import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { z } from "zod";

const sessionsSchema = z.object({
  runtime: z.literal("codex"),
  sessionCount: z.literal(1),
  sourceDir: z.string(),
  sessions: z.array(z.object({ sessionId: z.literal("rollout-native-smoke") })).length(1),
});
const exportSchema = z.object({
  eventCount: z.number().int().positive(),
  exportPath: z.string(),
  runtime: z.literal("codex"),
  status: z.literal("collected"),
});
const runtimesSchema = z.array(z.object({ runtime: z.string() })).min(5);
const errorSchema = z.object({ error: z.literal("invalid_collector_request") });
const adapterErrorSchema = z.object({ error: z.literal("unknown_runtime") });

class SmokeFailure extends Error {
  constructor(readonly scenario: string, readonly exitCode: number) {
    super(`smoke_failed: ${scenario} exited ${exitCode}`);
    this.name = "SmokeFailure";
  }
}

const evidenceDir = resolve(process.argv[2] ?? ".omo/evidence/native-collector-smoke");
const fixtureRoot = mkdtempSync(join(tmpdir(), "native-collector-smoke-"));
const sourceDir = join(fixtureRoot, "sessions", "2026", "07", "23");
const exportPath = join(evidenceDir, "native-smoke.atf.json");
mkdirSync(sourceDir, { recursive: true });
mkdirSync(evidenceDir, { recursive: true });
writeFileSync(
  join(sourceDir, "rollout-native-smoke.jsonl"),
  [
    JSON.stringify({
      payload: { cwd: "/tmp", id: "native-smoke" },
      timestamp: "2026-07-23T00:00:00.000Z",
      type: "session_meta",
    }),
    JSON.stringify({
      payload: { message: "smoke", type: "user_message" },
      timestamp: "2026-07-23T00:00:01.000Z",
      type: "event_msg",
    }),
  ].join("\n") + "\n",
  "utf8",
);

const run = (scenario: string, command: readonly string[], expectedExitCode: number): string => {
  const result = Bun.spawnSync({ cmd: [...command], cwd: resolve(import.meta.dir, "../..") });
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  writeFileSync(join(evidenceDir, `${scenario}.stdout.json`), stdout, "utf8");
  writeFileSync(join(evidenceDir, `${scenario}.stderr.json`), stderr, "utf8");
  if (result.exitCode !== expectedExitCode) throw new SmokeFailure(scenario, result.exitCode);
  return expectedExitCode === 0 ? stdout : stderr;
};

try {
  const build = Bun.spawnSync({ cmd: ["bun", "run", "build:collector"], cwd: resolve(import.meta.dir, "../..") });
  writeFileSync(join(evidenceDir, "build.stdout.log"), build.stdout, "utf8");
  writeFileSync(join(evidenceDir, "build.stderr.log"), build.stderr, "utf8");
  if (build.exitCode !== 0) throw new SmokeFailure("build", build.exitCode);

  const sessions = sessionsSchema.parse(
    JSON.parse(run("canonical-sessions", ["bun", "dist/collector.js", "collect", "sessions", "codex", "--source", sourceDir, "--limit", "1"], 0)),
  );
  const exported = exportSchema.parse(
    JSON.parse(run("canonical-export", ["bun", "dist/collector.js", "collect", "export", "codex", "--source", sourceDir, "--session", "rollout-native-smoke", "--export", exportPath], 0)),
  );
  const runtimes = runtimesSchema.parse(
    JSON.parse(run("flat-runtimes", ["bun", "dist/collector.js", "runtimes"], 0)),
  );
  const error = errorSchema.parse(
    JSON.parse(run("canonical-error", ["bun", "dist/collector.js", "collect", "wat"], 1)),
  );
  const adapterError = adapterErrorSchema.parse(
    JSON.parse(run("canonical-adapter-error", ["bun", "dist/collector.js", "collect", "sessions", "unknown", "--source", sourceDir], 1)),
  );
  const summary = {
    adapterError: adapterError.error,
    error: error.error,
    exportPath: exported.exportPath,
    runtimeCount: runtimes.length,
    sessionCount: sessions.sessionCount,
  };
  writeFileSync(join(evidenceDir, "smoke-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary));
} finally {
  rmSync(fixtureRoot, { force: true, recursive: true });
}
