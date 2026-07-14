import { describe, expect, test } from "bun:test"

import type { EngineSetupDeps } from "../src/trajectory/privacy/engine-setup"
import { setupPrivacyEngine } from "../src/trajectory/privacy/engine-setup"

type Call = readonly [string, readonly string[], string | undefined]

const fakeDeps = (
  overrides: Partial<EngineSetupDeps> & { calls?: Call[] } = {},
): { deps: EngineSetupDeps; calls: Call[] } => {
  const calls: Call[] = overrides.calls ?? []
  const deps: EngineSetupDeps = {
    run: (command, args, cwd) => {
      calls.push([command, args, cwd])
      return { success: true, output: "" }
    },
    probe: () => Promise.resolve(false),
    platform: "darwin",
    fileExists: () => false,
    readFile: () => "",
    sleep: () => Promise.resolve(),
    ...overrides,
  }
  return { deps, calls }
}

describe("setupPrivacyEngine", () => {
  test("short-circuits when the engine is already healthy", async () => {
    const { deps, calls } = fakeDeps({ probe: () => Promise.resolve(true) })
    const result = await setupPrivacyEngine({}, deps)
    expect(result.status).toBe("already_running")
    expect(calls).toHaveLength(0)
  })

  test("skips on non-macOS platforms", async () => {
    const { deps } = fakeDeps({ platform: "linux" })
    const result = await setupPrivacyEngine({}, deps)
    expect(result.status).toBe("skipped")
    expect(result.detail).toContain("macOS")
  })

  test("skips with guidance when uv is missing", async () => {
    const { deps } = fakeDeps({
      run: (command) => ({ success: command !== "uv", output: "" }),
    })
    const result = await setupPrivacyEngine({}, deps)
    expect(result.status).toBe("skipped")
    expect(result.detail).toContain("uv not found")
  })

  test("clones, syncs, installs, then reports running once healthy", async () => {
    let probes = 0
    const { deps, calls } = fakeDeps({
      probe: () => Promise.resolve(probes++ >= 2),
    })
    const result = await setupPrivacyEngine({ engineDir: "/tmp/engine", port: 9999 }, deps)
    expect(result.status).toBe("running")
    expect(calls.map(([cmd, args]) => [cmd, args[0]])).toEqual([
      ["uv", "--version"],
      ["git", "clone"],
      ["uv", "sync"],
      ["uv", "run"],
    ])
    const install = calls[3]
    expect(install?.[1]).toEqual(["run", "engine-service", "install", "--port", "9999"])
    expect(install?.[2]).toBe("/tmp/engine")
  })

  test("skips with an auth hint when the private clone fails", async () => {
    const { deps } = fakeDeps({
      run: (command) => ({ success: command !== "git", output: "denied" }),
    })
    const result = await setupPrivacyEngine({ engineDir: "/tmp/engine" }, deps)
    expect(result.status).toBe("skipped")
    expect(result.detail).toContain("private repo")
  })

  test("reuses an existing checkout without cloning", async () => {
    const { deps, calls } = fakeDeps({ fileExists: (path) => path === "/tmp/engine" })
    const result = await setupPrivacyEngine({ engineDir: "/tmp/engine", healthWaitMs: 0 }, deps)
    expect(result.status).toBe("pending")
    expect(calls.some(([cmd]) => cmd === "git")).toBe(false)
  })

  test("recovers the engine dir from an existing LaunchAgent plist", async () => {
    const plist = "/Users/x/Library/LaunchAgents/com.privacy-filter-engine.plist"
    const { deps, calls } = fakeDeps({
      fileExists: (path) =>
        path.endsWith("com.privacy-filter-engine.plist") || path === "/existing/engine",
      readFile: () => "<key>WorkingDirectory</key>\n    <string>/existing/engine</string>",
    })
    void plist
    const result = await setupPrivacyEngine({ healthWaitMs: 0 }, deps)
    expect(result.engineDir).toBe("/existing/engine")
    expect(calls.some(([cmd]) => cmd === "git")).toBe(false)
  })
})
