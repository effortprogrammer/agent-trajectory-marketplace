import { afterEach, describe, expect, test } from "bun:test"
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const roots: string[] = []

const copyFixtureDirectory = (): string => {
  const root = mkdtempSync(join(tmpdir(), "trajectory-wallet-wire-"))
  roots.push(root)
  const fixtureRoot = join(root, "v1")
  cpSync("contract/wallet-balance/v1", fixtureRoot, { recursive: true })
  return fixtureRoot
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
    const fixtureRoot = copyFixtureDirectory()
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
    const fixtureRoot = copyFixtureDirectory()
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
})
