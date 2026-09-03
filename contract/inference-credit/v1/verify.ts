import { createHash } from "node:crypto"
import { lstatSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { z } from "zod"

import { FixtureReadError, readFixtureFile } from "../../../src/marketplace/fixture-reader"
import {
  InferenceCreditContractError,
  inferenceCreditMaximumDocumentBytes,
  parseInferenceCreditDocument,
  parseInferenceCreditFinalStream,
} from "../../../src/marketplace/inference-credit-contract"
import { parseAdmissionJson } from "../../../src/marketplace/json-preflight"

const expectedFixtureFiles = [
  "key-create-request.json", "key-created-201.json", "key-list-200.json", "key-revoked-200.json",
  "quote-request.json", "quote-200.json", "request-create.json", "request-202.json", "request-stream-final.sse", "cancel-200.json",
  "probe-200.json", "usage-200.json", "privacy-200.json", "error-400.json", "error-401.json", "error-403.json",
  "error-404.json", "error-409-quote-expired.json", "error-409-conflict.json",
] as const
const fixtureKinds = [
  "key-create-request", "key-create", "key-list", "key-revoke", "quote-request", "quote", "request-create",
  "request", "stream-final", "cancel", "probe", "usage", "privacy", "error", "error", "error", "error", "error", "error",
] as const
const expectedDirectoryFiles = [...expectedFixtureFiles, "manifest.json", "verify.ts"].sort()

const fixtureSchema = z.object({
  file: z.string().regex(/^[a-z0-9-]+\.(?:json|sse)$/),
  kind: z.enum(fixtureKinds),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.number().int().min(0).max(599),
  verdict: z.literal("accept"),
}).strict()
const manifestSchema = z.object({ schemaVersion: z.literal(1), fixtures: z.array(fixtureSchema).length(expectedFixtureFiles.length) }).strict()
type Fixture = z.infer<typeof fixtureSchema>

class FixtureVerificationError extends Error {
  public readonly name = "FixtureVerificationError"
  public constructor(readonly file: string, readonly reason: string) { super(`${file}: ${reason}`) }
}

const argumentValue = (name: string): string => {
  const index = Bun.argv.indexOf(name)
  const value = Bun.argv[index + 1]
  if (index === -1 || value === undefined) throw new FixtureVerificationError("arguments", `missing ${name}`)
  return value
}

const verifyFixture = (fixture: Fixture, bytes: Uint8Array): void => {
  try {
    if (fixture.kind === "stream-final") {
      if (fixture.status !== 200) throw new InferenceCreditContractError()
      parseInferenceCreditFinalStream(bytes)
      return
    }
    parseInferenceCreditDocument(fixture.kind, fixture.status, bytes)
  } catch (error) {
    if (error instanceof InferenceCreditContractError) throw new FixtureVerificationError(fixture.file, "expected accept, received reject")
    throw error
  }
}

const regularFile = (path: string): boolean => {
  try {
    const stat = lstatSync(path)
    return stat.isFile() && !stat.isSymbolicLink()
  } catch (error) {
    if (error instanceof Error) return false
    throw error
  }
}

const readBounded = (path: string): Buffer => {
  try {
    return readFixtureFile(path, inferenceCreditMaximumDocumentBytes)
  } catch (error) {
    if (error instanceof FixtureReadError) throw new FixtureVerificationError(path, error.reason)
    throw error
  }
}

const manifestPath = argumentValue("--manifest")
const manifestInput = parseAdmissionJson(readBounded(manifestPath))
if (manifestInput === undefined) throw new FixtureVerificationError(manifestPath, "invalid manifest")
const parsedManifest = manifestSchema.safeParse(manifestInput)
if (!parsedManifest.success) throw new FixtureVerificationError(manifestPath, "invalid manifest")
if (parsedManifest.data.fixtures.some((fixture, index) => fixture.file !== expectedFixtureFiles[index] || fixture.kind !== fixtureKinds[index])) {
  throw new FixtureVerificationError(manifestPath, "fixture set mismatch")
}
const fixtureRoot = dirname(resolve(manifestPath))
const rootStat = lstatSync(fixtureRoot)
if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new FixtureVerificationError(manifestPath, "fixture root is not a regular directory")
const directoryFiles = readdirSync(fixtureRoot).sort()
if (
  directoryFiles.length !== expectedDirectoryFiles.length ||
  directoryFiles.some((file, index) => file !== expectedDirectoryFiles[index]) ||
  directoryFiles.some((file) => !regularFile(join(fixtureRoot, file)))
) throw new FixtureVerificationError(manifestPath, "fixture set mismatch")

for (const fixture of parsedManifest.data.fixtures) {
  const bytes = readBounded(join(fixtureRoot, fixture.file))
  if (createHash("sha256").update(bytes).digest("hex") !== fixture.sha256) throw new FixtureVerificationError(fixture.file, "sha256 mismatch")
  verifyFixture(fixture, bytes)
}

process.stdout.write(`verified ${parsedManifest.data.fixtures.length} inference-credit v1 fixtures\n`)
