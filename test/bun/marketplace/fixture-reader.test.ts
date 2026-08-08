import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FixtureReadError, readFixtureFile } from "../../../src/marketplace/fixture-reader"

const roots: string[] = []

const root = (): string => {
  const value = mkdtempSync(join(tmpdir(), "fixture-reader-"))
  roots.push(value)
  return value
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { force: true, recursive: true })
})

describe("bounded descriptor fixture reader", () => {
  test("reads a regular in-root file within the byte cap", () => {
    // Given: a regular fixture file below the cap.
    const directory = root()
    const path = join(directory, "fixture.json")
    writeFileSync(path, "fixture-bytes")

    // When: the descriptor reader loads it.
    const bytes = readFixtureFile(path, 1024)

    // Then: exact bytes are returned.
    expect(Buffer.from(bytes).toString("utf8")).toBe("fixture-bytes")
  })

  test("rejects a symlink without following it", () => {
    // Given: a symlink whose target bytes live outside the fixture root.
    const directory = root()
    const target = join(directory, "outside.json")
    writeFileSync(target, "outside-bytes")
    const link = join(directory, "linked.json")
    symlinkSync(target, link)

    // When: the reader is asked to load the link.
    const read = (): void => {
      readFixtureFile(link, 1024)
    }

    // Then: the link itself is rejected.
    expect(read).toThrow(FixtureReadError)
  })

  test("rejects a fifo without blocking", () => {
    // Given: a named pipe where a blocking open would hang the verifier.
    const directory = root()
    const path = join(directory, "fixture.fifo")
    const made = Bun.spawnSync(["mkfifo", path])
    if (made.exitCode !== 0) throw new Error("mkfifo failed")

    // When: the reader opens it.
    const started = Date.now()
    const read = (): void => {
      readFixtureFile(path, 1024)
    }

    // Then: the non-regular entry is rejected immediately.
    expect(read).toThrow(FixtureReadError)
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  test("rejects a file above the byte cap before reading it", () => {
    // Given: a regular file larger than the verifier cap.
    const directory = root()
    const path = join(directory, "oversized.json")
    writeFileSync(path, Buffer.alloc(2048, 120))

    // When: the reader checks the descriptor size.
    const read = (): void => {
      readFixtureFile(path, 1024)
    }

    // Then: the oversize file is rejected.
    expect(read).toThrow(FixtureReadError)
  })

  test("rejects a same-path replacement between open and read completion", () => {
    // Given: a regular fixture that is atomically replaced after the descriptor opens.
    const directory = root()
    const path = join(directory, "fixture.json")
    writeFileSync(path, "original-bytes")

    // When: the replacement lands through the deterministic seam.
    const read = (): void => {
      readFixtureFile(path, 1024, {
        afterOpen: () => {
          rmSync(path, { force: true })
          writeFileSync(path, "replaced!")
        },
      })
    }

    // Then: identity drift is rejected instead of publishing mixed bytes.
    expect(read).toThrow(FixtureReadError)
  })
})
