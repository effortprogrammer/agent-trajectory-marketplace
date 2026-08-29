import { createHash } from "node:crypto"
import { lstatSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { z } from "zod"

import { FixtureReadError, readFixtureFile } from "../../../src/marketplace/fixture-reader"
import { parseAdmissionJson } from "../../../src/marketplace/json-preflight"
import { PayoutRequestContractError, parsePayoutRequestResponse } from "../../../src/marketplace/payout-request-contract"

const expectedFixtureFiles = [
  "get-empty-200.json",
  "requested-201.json",
  "requested-replay-200.json",
  "pending-200.json",
  "approved-200.json",
  "processing-200.json",
  "cancelled-200.json",
  "rejected-200.json",
  "paid-200.json",
  "withdrawn-200.json",
  "error-400-invalid-request.json",
  "error-401-unauthorized.json",
  "error-403-forbidden.json",
  "error-409-open-request.json",
  "error-409-not-withdrawable.json",
  "error-409-conflict.json",
  "error-422-below-threshold.json",
  "error-429-rate-limited.json",
  "error-503-creation-disabled.json",
  "error-503-service-unavailable.json",
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
    parsePayoutRequestResponse(fixture.status, bytes)
  } catch (error) {
    if (error instanceof Error && error.name === "PayoutRequestContractError") {
      throw new FixtureVerificationError(fixture.file, `expected accept/${fixture.status}, received reject`)
    }
    throw error
  }
}

const regularFile = (path: string): boolean => {
  try {
    const stat = lstatSync(path)
    return stat.isFile() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

const manifestByteCap = 64 * 1024
const fixtureByteCap = 16 * 1024 * 1024

const readBounded = (path: string, maximumBytes: number): Buffer => {
  try {
    return readFixtureFile(path, maximumBytes)
  } catch (error) {
    if (error instanceof FixtureReadError) throw new FixtureVerificationError(path, error.reason)
    throw error
  }
}

const manifestPath = argumentValue("--manifest")
const manifestInput = parseAdmissionJson(readBounded(manifestPath, manifestByteCap))
if (manifestInput === undefined) throw new FixtureVerificationError(manifestPath, "invalid manifest")
const parsedManifest = manifestSchema.safeParse(manifestInput)
if (!parsedManifest.success) throw new FixtureVerificationError(manifestPath, "invalid manifest")
if (parsedManifest.data.fixtures.some((fixture, index) => fixture.file !== expectedFixtureFiles[index])) {
  throw new FixtureVerificationError(manifestPath, "fixture set mismatch")
}
const fixtureRoot = dirname(resolve(manifestPath))
const rootStat = lstatSync(fixtureRoot)
if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
  throw new FixtureVerificationError(manifestPath, "fixture root is not a regular directory")
}
const actualDirectoryFiles = readdirSync(fixtureRoot).sort()
if (
  actualDirectoryFiles.length !== expectedDirectoryFiles.length ||
  actualDirectoryFiles.some((file, index) => file !== expectedDirectoryFiles[index]) ||
  actualDirectoryFiles.some((file) => !regularFile(join(fixtureRoot, file)))
) {
  throw new FixtureVerificationError(manifestPath, "fixture set mismatch")
}

for (const fixture of parsedManifest.data.fixtures) {
  const bytes = readBounded(join(fixtureRoot, fixture.file), fixtureByteCap)
  const digest = createHash("sha256").update(bytes).digest("hex")
  if (digest !== fixture.sha256) throw new FixtureVerificationError(fixture.file, "sha256 mismatch")
  verifyFixture(fixture, bytes)
}

process.stdout.write(`verified ${parsedManifest.data.fixtures.length} payout-request v1 fixtures\n`)
