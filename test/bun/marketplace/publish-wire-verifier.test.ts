import { afterEach, describe, expect, test } from "bun:test"
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const roots: string[] = []

const copyFixtureDirectory = (): Readonly<{ fixtureRoot: string; root: string }> => {
  const root = mkdtempSync(join(tmpdir(), "trajectory-publish-wire-"))
  roots.push(root)
  const fixtureRoot = join(root, "v1")
  cpSync("contract/publish-wire/v1", fixtureRoot, { recursive: true })
  return { fixtureRoot, root }
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
  test("rejects a manifest with duplicate JSON keys", () => {
    // Given: a copied manifest whose duplicate schemaVersion collapses to a valid parse.
    const { fixtureRoot } = copyFixtureDirectory()
    const manifestPath = join(fixtureRoot, "manifest.json")
    const original = readFileSync(manifestPath, "utf8")
    writeFileSync(manifestPath, original.replace('"schemaVersion": 1', '"schemaVersion": 0,\n  "schemaVersion": 1'))

    // When: the verifier parses the manifest.
    const duplicate = verify(fixtureRoot)

    // Then: parser differentials in the frozen manifest are rejected.
    expect({
      exitCode: duplicate.exitCode,
      stderr: new TextDecoder().decode(duplicate.stderr),
    }).toEqual({
      exitCode: 1,
      stderr: expect.stringContaining("invalid manifest"),
    })
  })

  test("rejects a symlinked manifest", () => {
    // Given: a manifest path replaced by a symlink to identical bytes outside the tree.
    const { fixtureRoot, root } = copyFixtureDirectory()
    const manifestPath = join(fixtureRoot, "manifest.json")
    const outsidePath = join(root, "outside-manifest.json")
    cpSync(manifestPath, outsidePath)
    rmSync(manifestPath)
    symlinkSync(outsidePath, manifestPath)

    // When: the verifier opens the manifest.
    const linked = verify(fixtureRoot)

    // Then: the symlinked manifest is rejected before parsing.
    expect(linked.exitCode).toBe(1)
  })

  test("rejects a symlinked fixture file", () => {
    // Given: a frame entry replaced by a symlink to identical bytes outside the tree.
    const { fixtureRoot, root } = copyFixtureDirectory()
    const framePath = join(fixtureRoot, "candidate-valid.frame")
    const outsidePath = join(root, "outside-frame.bin")
    cpSync(framePath, outsidePath)
    rmSync(framePath)
    symlinkSync(outsidePath, framePath)

    // When: the verifier enumerates an otherwise byte-identical fixture set.
    const linked = verify(fixtureRoot)

    // Then: the symlink itself is rejected even though hashes and membership match.
    expect(linked.exitCode).toBe(1)
  })

  test("rejects fixture-directory files not declared by the exact v1 set", () => {
    // Given: a byte-identical copied v1 fixture directory that verifies successfully.
    const { fixtureRoot } = copyFixtureDirectory()
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
    const { fixtureRoot } = copyFixtureDirectory()
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
