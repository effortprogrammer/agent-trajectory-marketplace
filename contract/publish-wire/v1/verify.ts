import { createHash } from "node:crypto"
import { dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { z } from "zod"

import { parsePublishBundle, PublishBundleError } from "../../../src/marketplace/publish-bundle"
import {
  PublishWireContractError,
  encodeCandidateJson,
  parsePublishResponse,
} from "../../../src/marketplace/publish-contract"
import { parsePublishFrame } from "../../../src/marketplace/publish-frame"

const fixtureSchema = z
  .object({
    file: z.string().regex(/^[a-z0-9-]+\.(frame|json)$/),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    verdict: z.enum(["accept", "reject"]),
    code: z.string().regex(/^[a-z_]+$/),
  })
  .strict()
const manifestSchema = z.object({ schemaVersion: z.literal(1), fixtures: z.array(fixtureSchema).min(1) }).strict()

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

const responseStatus = (file: string): number => {
  const match = /-(\d{3})\.json$/.exec(file)
  const value = match?.[1]
  if (value === undefined) throw new FixtureVerificationError(file, "response filename lacks HTTP status")
  return Number(value)
}

const responseCode = (response: ReturnType<typeof parsePublishResponse>): string => "code" in response ? response.code : response.status

const verifyFrame = (bytes: Uint8Array): string => {
  const frame = parsePublishFrame(bytes)
  const bundle = parsePublishBundle(frame.archive)
  if (!encodeCandidateJson(bundle.candidate).equals(encodeCandidateJson(frame.candidate))) {
    throw new PublishWireContractError("invalid_candidate")
  }
  return "accepted"
}

const verifyFixture = (fixture: Fixture, bytes: Uint8Array): void => {
  try {
    const code = fixture.file.endsWith(".frame")
      ? verifyFrame(bytes)
      : responseCode(parsePublishResponse(responseStatus(fixture.file), bytes))
    if (fixture.verdict !== "accept" || code !== fixture.code) {
      throw new FixtureVerificationError(fixture.file, `expected ${fixture.verdict}/${fixture.code}, received accept/${code}`)
    }
  } catch (error) {
    if (error instanceof FixtureVerificationError) throw error
    if (error instanceof PublishBundleError && fixture.verdict === "reject" && fixture.code === "invalid_candidate") return
    if (error instanceof PublishWireContractError && fixture.verdict === "reject" && error.code === fixture.code) return
    const code = error instanceof PublishWireContractError
      ? error.code
      : error instanceof PublishBundleError
        ? "invalid_candidate"
        : "unexpected_error"
    throw new FixtureVerificationError(fixture.file, `expected ${fixture.verdict}/${fixture.code}, received reject/${code}`)
  }
}

const manifestPath = argumentValue("--manifest")
const manifestFile = Bun.file(manifestPath)
const rawManifest = await manifestFile.json()
const parsedManifest = manifestSchema.safeParse(rawManifest)
if (!parsedManifest.success) throw new FixtureVerificationError(manifestPath, "invalid manifest")
const root = pathToFileURL(`${dirname(resolve(manifestPath))}/`)

for (const fixture of parsedManifest.data.fixtures) {
  const bytes = Buffer.from(await Bun.file(new URL(fixture.file, root)).arrayBuffer())
  const digest = createHash("sha256").update(bytes).digest("hex")
  if (digest !== fixture.sha256) throw new FixtureVerificationError(fixture.file, "sha256 mismatch")
  verifyFixture(fixture, bytes)
}

process.stdout.write(`verified ${parsedManifest.data.fixtures.length} publish-wire v1 fixtures\n`)
