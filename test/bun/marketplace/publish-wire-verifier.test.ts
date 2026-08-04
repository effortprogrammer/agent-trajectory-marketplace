import { afterEach, describe, expect, test } from "bun:test"
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const roots: string[] = []

const copyFixtureDirectory = (): string => {
  const root = mkdtempSync(join(tmpdir(), "trajectory-publish-wire-"))
  roots.push(root)
  const fixtureRoot = join(root, "v1")
  cpSync("contract/publish-wire/v1", fixtureRoot, { recursive: true })
  return fixtureRoot
}

const verify = (fixtureRoot: string) => Bun.spawnSync([
  process.execPath,
  "contract/publish-wire/v1/verify.ts",
  "--manifest",
  join(fixtureRoot, "manifest.json"),
], {
  cwd: process.cwd(),
  stderr: "pipe",
  stdout: "pipe",
})

const checkGenerated = (fixtureRoot: string) => Bun.spawnSync([
  process.execPath,
  "contract/publish-wire/v1/generate.ts",
  "--check",
  fixtureRoot,
], {
  cwd: process.cwd(),
  stderr: "pipe",
  stdout: "pipe",
})

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe("frozen publish wire verifier", () => {
  test("rejects fixture-directory files not declared by the exact v1 set", () => {
    // Given: a byte-identical copied v1 fixture directory that verifies successfully.
    const fixtureRoot = copyFixtureDirectory()
    const baseline = verify(fixtureRoot)
    expect({
      exitCode: baseline.exitCode,
      stdout: new TextDecoder().decode(baseline.stdout),
    }).toEqual({
      exitCode: 0,
      stdout: "verified 13 publish-wire v1 fixtures\n",
    })

    // When: an unlisted stale frame is present beside the frozen set.
    writeFileSync(join(fixtureRoot, "extra-unlisted.frame"), "stale")
    const extra = verify(fixtureRoot)

    // Then: directory drift is rejected by the real verifier process.
    expect({
      exitCode: extra.exitCode,
      stderr: new TextDecoder().decode(extra.stderr),
    }).toEqual({
      exitCode: 1,
      stderr: expect.stringContaining("fixture set mismatch"),
    })
  })

  test("rejects checked-in fixtures that differ from generator output", () => {
    // Given: a copied fixture corpus whose accepted frame differs from current generator output.
    const fixtureRoot = copyFixtureDirectory()
    const framePath = join(fixtureRoot, "candidate-valid.frame")
    const frame = readFileSync(framePath)
    frame[frame.length - 1] ^= 1
    writeFileSync(framePath, frame)

    // When: generator reproducibility is checked without rewriting the corpus.
    const generated = checkGenerated(fixtureRoot)

    // Then: stale checked-in output fails the machine-observable generation gate.
    expect({
      exitCode: generated.exitCode,
      stderr: new TextDecoder().decode(generated.stderr),
    }).toEqual({
      exitCode: 1,
      stderr: expect.stringContaining("fixture generation mismatch"),
    })
  })
})
