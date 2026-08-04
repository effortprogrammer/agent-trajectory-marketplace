import { createHash } from "node:crypto"
import { readdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { z } from "zod"

import { parseWalletBalanceResponse } from "../../../src/marketplace/wallet-balance-contract"

const expectedFixtureFiles = [
  "balance-200.json",
  "error-401.json",
  "error-403.json",
] as const
const expectedDirectoryFiles = [
  ...expectedFixtureFiles,
  "manifest.json",
  "verify.ts",
].sort()

const fixtureSchema = z
  .object({
    file: z.string().regex(/^[a-z0-9-]+\.json$/),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    status: z.number().int().min(100).max(599),
    verdict: z.literal("accept"),
  })
  .strict()
const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    fixtures: z.array(fixtureSchema).length(expectedFixtureFiles.length),
  })
  .strict()

type Fixture = z.infer<typeof fixtureSchema>

class FixtureVerificationError extends Error {
  public constructor(public readonly file: string, public readonly reason: string) {
    super(`${file}: ${reason}`)
    this.name = "FixtureVerificationError"
  }
}

const argumentValue = (name: string): string => {
  const index = Bun.argv.indexOf(name)
  const value = Bun.argv[index + 1]
  if (index === -1 || value === undefined) throw new FixtureVerificationError("arguments", `missing ${name}`)
  return value
}

const verifyFixture = (fixture: Fixture, bytes: Uint8Array): void => {
  try {
    parseWalletBalanceResponse(fixture.status, bytes)
  } catch (error) {
    if (error instanceof Error && error.name === "WalletBalanceContractError") {
      throw new FixtureVerificationError(fixture.file, `expected accept/${fixture.status}, received reject`)
    }
    throw error
  }
}

const manifestPath = argumentValue("--manifest")
const manifestFile = Bun.file(manifestPath)
const rawManifest = await manifestFile.json()
const parsedManifest = manifestSchema.safeParse(rawManifest)
if (!parsedManifest.success) throw new FixtureVerificationError(manifestPath, "invalid manifest")
if (parsedManifest.data.fixtures.some((fixture, index) => fixture.file !== expectedFixtureFiles[index])) {
  throw new FixtureVerificationError(manifestPath, "fixture set mismatch")
}
const fixtureRoot = dirname(resolve(manifestPath))
const actualDirectoryFiles = readdirSync(fixtureRoot).sort()
if (
  actualDirectoryFiles.length !== expectedDirectoryFiles.length ||
  actualDirectoryFiles.some((file, index) => file !== expectedDirectoryFiles[index])
) {
  throw new FixtureVerificationError(manifestPath, "fixture set mismatch")
}
const root = pathToFileURL(`${fixtureRoot}/`)

for (const fixture of parsedManifest.data.fixtures) {
  const bytes = Buffer.from(await Bun.file(new URL(fixture.file, root)).arrayBuffer())
  const digest = createHash("sha256").update(bytes).digest("hex")
  if (digest !== fixture.sha256) throw new FixtureVerificationError(fixture.file, "sha256 mismatch")
  verifyFixture(fixture, bytes)
}

process.stdout.write(`verified ${parsedManifest.data.fixtures.length} wallet-balance v1 fixtures\n`)
