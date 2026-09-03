import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const roots: string[] = []

const copyFixtureDirectory = (): string => {
  const root = mkdtempSync(join(tmpdir(), "trajectory-inference-credit-"))
  roots.push(root)
  const fixtureRoot = join(root, "v1")
  cpSync("contract/inference-credit/v1", fixtureRoot, { recursive: true })
  return fixtureRoot
}

const verify = (fixtureRoot: string) => Bun.spawnSync([
  process.execPath,
  "contract/inference-credit/v1/verify.ts",
  "--manifest",
  join(fixtureRoot, "manifest.json"),
], { cwd: process.cwd(), stderr: "pipe", stdout: "pipe" })

const replaceDigest = (fixtureRoot: string, file: string): void => {
  const manifestPath = join(fixtureRoot, "manifest.json")
  const digest = createHash("sha256").update(readFileSync(join(fixtureRoot, file))).digest("hex")
  const manifest = readFileSync(manifestPath, "utf8")
  const pattern = new RegExp(`("file":"${file}","kind":"[a-z-]+","sha256":")[0-9a-f]{64}`)
  writeFileSync(manifestPath, manifest.replace(pattern, `$1${digest}`))
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe("inference credit v1 fixture verifier", () => {
  test("rejects a dirty or stale fixture directory when the verifier runs", () => {
    // Given: copied, digest-bound v1 fixtures that verify through the real process.
    const fixtureRoot = copyFixtureDirectory()
    expect(verify(fixtureRoot).exitCode).toBe(0)

    // When: a stale payload changes, then an undeclared dirty file is added.
    writeFileSync(join(fixtureRoot, "quote-200.json"), "{}")
    const stale = verify(fixtureRoot)
    writeFileSync(join(fixtureRoot, "unexpected.json"), "{}")
    const dirty = verify(fixtureRoot)

    // Then: digest binding and exact directory membership each fail closed.
    expect(new TextDecoder().decode(stale.stderr)).toContain("sha256 mismatch")
    expect(new TextDecoder().decode(dirty.stderr)).toContain("fixture set mismatch")
  })

  test("rejects private fields even when an untrusted manifest carries their digest", () => {
    // Given: a copied quote with its manifest digest deliberately updated after mutation.
    const fixtureRoot = copyFixtureDirectory()
    const quotePath = join(fixtureRoot, "quote-200.json")
    writeFileSync(quotePath, readFileSync(quotePath, "utf8").replace(
      '"provider":"relay-alpha",',
      '"provider":"relay-alpha","openrouterApiKey":"x",',
    ))
    replaceDigest(fixtureRoot, "quote-200.json")

    // When: the verifier admits the attacker-controlled manifest and fixture pair.
    const result = verify(fixtureRoot)

    // Then: the strict provider-neutral schema still rejects the quoted private field.
    expect(new TextDecoder().decode(result.stderr)).toContain("expected accept, received reject")
  })

  test("rejects malformed manifests, symlinked fixtures, and interrupted streams", () => {
    // Given: independent fixture roots for malformed, untrusted, and interrupted inputs.
    const malformedRoot = copyFixtureDirectory()
    const symlinkRoot = copyFixtureDirectory()
    const interruptedRoot = copyFixtureDirectory()
    const malformedPath = join(malformedRoot, "manifest.json")
    const streamPath = join(interruptedRoot, "request-stream-final.sse")

    // When: duplicate manifest keys, a redirected fixture, and a missing terminal sentinel appear.
    writeFileSync(malformedPath, readFileSync(malformedPath, "utf8").replace(
      '"schemaVersion":1', '"schemaVersion":0,"schemaVersion":1',
    ))
    const outside = join(symlinkRoot, "..", "outside-quote.json")
    writeFileSync(outside, readFileSync(join(symlinkRoot, "quote-200.json")))
    rmSync(join(symlinkRoot, "quote-200.json"))
    symlinkSync(outside, join(symlinkRoot, "quote-200.json"))
    writeFileSync(streamPath, readFileSync(streamPath, "utf8").replace("data: [DONE]\n", ""))
    replaceDigest(interruptedRoot, "request-stream-final.sse")
    const malformed = verify(malformedRoot)
    const symlinked = verify(symlinkRoot)
    const interrupted = verify(interruptedRoot)

    // Then: no parser differential, redirection, or ambiguous stream becomes a final fact.
    expect(new TextDecoder().decode(malformed.stderr)).toContain("invalid manifest")
    expect(new TextDecoder().decode(symlinked.stderr)).toContain("fixture set mismatch")
    expect(new TextDecoder().decode(interrupted.stderr)).toContain("expected accept, received reject")
  })
})
