import { afterEach, describe, expect, test } from "bun:test"
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const roots: string[] = []

const copyFixtureDirectory = (): Readonly<{ fixtureRoot: string; root: string }> => {
  const root = mkdtempSync(join(tmpdir(), "trajectory-wallet-wire-"))
  roots.push(root)
  const fixtureRoot = join(root, "v1")
  cpSync("contract/wallet-balance/v1", fixtureRoot, { recursive: true })
  return { fixtureRoot, root }
}

const verify = (fixtureRoot: string) => Bun.spawnSync([
  process.execPath,
  "contract/wallet-balance/v1/verify.ts",
  "--manifest",
  join(fixtureRoot, "manifest.json"),
], {
  cwd: process.cwd(),
  stderr: "pipe",
  stdout: "pipe",
})

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe("frozen wallet balance verifier", () => {
  test("rejects fixture-directory files not declared by the exact v1 set", () => {
    // Given: a byte-identical copied v1 fixture directory that verifies successfully.
    const { fixtureRoot } = copyFixtureDirectory()
    const baseline = verify(fixtureRoot)
    expect({
      exitCode: baseline.exitCode,
      stdout: new TextDecoder().decode(baseline.stdout),
    }).toEqual({
      exitCode: 0,
      stdout: "verified 3 wallet-balance v1 fixtures\n",
    })

    // When: an unlisted stale fixture is present beside the frozen set.
    writeFileSync(join(fixtureRoot, "extra-unlisted.json"), "stale")
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

  test("rejects a fixture whose bytes no longer match the manifest hash", () => {
    // Given: a copied fixture directory whose balance payload is mutated after hashing.
    const { fixtureRoot } = copyFixtureDirectory()
    const balancePath = join(fixtureRoot, "balance-200.json")
    const original = readFileSync(balancePath, "utf8")
    writeFileSync(balancePath, original.replace("17", "18"))

    // When: the verifier runs against the stale manifest.
    const stale = verify(fixtureRoot)

    // Then: the hash binding fails closed.
    expect({
      exitCode: stale.exitCode,
      stderr: new TextDecoder().decode(stale.stderr),
    }).toEqual({
      exitCode: 1,
      stderr: expect.stringContaining("sha256 mismatch"),
    })
  })

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

  test("rejects a symlinked fixture root", () => {
    // Given: a symlink outside the fixture tree that redirects the verifier into it.
    const { fixtureRoot, root } = copyFixtureDirectory()
    const link = join(root, "linked-v1")
    symlinkSync(fixtureRoot, link)

    // When: the verifier runs through the symlinked root.
    const linked = verify(link)

    // Then: out-of-tree redirection is rejected before any fixture is read.
    expect(linked.exitCode).toBe(1)
  })

  test("rejects a symlinked fixture file", () => {
    // Given: a fixture entry replaced by a symlink to identical bytes outside the tree.
    const { fixtureRoot, root } = copyFixtureDirectory()
    const balancePath = join(fixtureRoot, "balance-200.json")
    const outsidePath = join(root, "outside-balance.json")
    cpSync(balancePath, outsidePath)
    rmSync(balancePath)
    symlinkSync(outsidePath, balancePath)

    // When: the verifier enumerates an otherwise byte-identical fixture set.
    const linked = verify(fixtureRoot)

    // Then: the symlink itself is rejected even though hashes and membership match.
    expect(linked.exitCode).toBe(1)
  })
})
