#!/usr/bin/env bun

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { chromium, type Page } from "playwright"

import { hashRegistryApiKey, parseClosedAlphaAccessRecords } from "../src/registry/access"
import { registryUploadSuccessSchema } from "../src/registry/contract"
import { prepareHostedPackage, runHostedCli } from "../src/registry/hosted-e2e-cli"
import {
  readRegistryOperatorState,
  writeRegistryOperatorState,
} from "../src/registry/operator-state"
import { parseRegistryServeConfig, startRegistryServer } from "../src/registry/server"

const redactedEmailCode = "<redacted-email-code>"
const approvedSellerKey = "browser-qa-seller-key"

// The page.evaluate callbacks below run inside the browser. Declare the DOM
// globals they touch with module-local types instead of pulling lib.dom into
// the shared tsconfig compilation.
type BrowserRect = Readonly<{
  width: number
  left: number
  right: number
  top: number
  bottom: number
}>
type BrowserElement = {
  children: ArrayLike<BrowserElement>
  className: string
  tagName: string
  textContent: string | null
  getBoundingClientRect: () => BrowserRect
  querySelectorAll: (selector: string) => Iterable<BrowserElement> & ArrayLike<BrowserElement>
}
declare const document: {
  querySelector: (selector: string) => BrowserElement | null
  documentElement: { scrollWidth: number; clientWidth: number }
  body: { scrollWidth: number }
}
declare const window: {
  getComputedStyle: (element: BrowserElement) => { visibility: string; display: string }
}

type CliOptions = Readonly<{
  evidenceDir: string
  widths: readonly number[]
}>

type StateCheck = Readonly<{
  width: number
  state: string
  passed: boolean
  detail: string
}>

class BrowserQaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BrowserQaError"
  }
}

const parseOptions = (args: readonly string[]): CliOptions => {
  let evidenceDir = ".omo/evidence/frictionless-auth-permission-downloads"
  let widths: readonly number[] = [390, 1280]
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const value = args[index + 1]
    switch (arg) {
      case "--evidence-dir":
        if (value === undefined || value.startsWith("--")) {
          throw new BrowserQaError("--evidence-dir requires a path")
        }
        evidenceDir = value
        index += 1
        break
      case "--widths": {
        if (value === undefined || value.startsWith("--")) {
          throw new BrowserQaError("--widths requires a comma-separated list")
        }
        widths = value.split(",").map((part) => {
          const width = Number(part.trim())
          if (!Number.isInteger(width) || width < 320 || width > 3840) {
            throw new BrowserQaError(`invalid width: ${part}`)
          }
          return width
        })
        index += 1
        break
      }
      default:
        throw new BrowserQaError(`unknown option: ${arg}`)
    }
  }
  return { evidenceDir, widths }
}

const widthLabel = (width: number): string => {
  if (width <= 600) {
    return "mobile"
  }
  if (width >= 1024) {
    return "desktop"
  }
  return `w${width}`
}

const requestRequiredMetadata = {
  schemaVersion: 1,
  price: { mode: "request_access", display: "Request access" },
  license: { name: "Closed Alpha Evaluation", url: "https://example.test/license" },
  usageTerms: { allowed: ["evaluation", "benchmarking"], prohibited: ["resale"] },
  sellerProfile: { displayName: "Agent Local", supportUrl: "https://example.test/support" },
  sample: { summary: "Browser QA sample", maxPreviewEvents: 3 },
  accessPolicy: "request_required",
} as const

const readLatestOutboxCode = (outboxPath: string, email: string): string => {
  const entries = readFileSync(outboxPath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { to: string; code: string })
    .filter((entry) => entry.to === email)
  const latest = entries.at(-1)
  if (latest === undefined) {
    throw new BrowserQaError(`no outbox entry for ${email}`)
  }
  return latest.code
}

const waitForOutboxCode = async (outboxPath: string, email: string): Promise<string> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return readLatestOutboxCode(outboxPath, email)
    } catch {
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 100))
    }
  }
  throw new BrowserQaError(`outbox code never arrived for ${email}`)
}

const assertControlsNotClipped = async (page: Page, scopeSelector: string): Promise<string> => {
  const clipped = await page.evaluate((selector) => {
    const scope = document.querySelector(selector)
    if (scope === null) {
      return [`scope not found: ${selector}`]
    }
    const scopeRect = scope.getBoundingClientRect()
    const found: string[] = []
    for (const control of scope.querySelectorAll("button, input, select")) {
      const rect = control.getBoundingClientRect()
      if (rect.width === 0) {
        continue
      }
      if (rect.right > scopeRect.right + 1 || rect.left < scopeRect.left - 1) {
        found.push(
          `${control.tagName}:"${control.textContent?.trim().slice(0, 24)}" clipped (${Math.round(rect.right - scopeRect.right)}px past edge)`,
        )
      }
    }
    return found
  }, scopeSelector)
  if (clipped.length > 0) {
    throw new BrowserQaError(`clipped controls in ${scopeSelector}: ${clipped.join("; ")}`)
  }
  return `no clipped controls in ${scopeSelector}`
}

const assertNoHorizontalOverflow = async (page: Page): Promise<string> => {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement
    return Math.max(
      root.scrollWidth - root.clientWidth,
      document.body.scrollWidth - root.clientWidth,
    )
  })
  if (overflow > 1) {
    throw new BrowserQaError(`horizontal overflow of ${overflow}px detected`)
  }
  return `no horizontal overflow (delta ${overflow}px)`
}

const assertNoTextOverlap = async (page: Page, scopeSelector: string): Promise<string> => {
  const overlaps = await page.evaluate((selector) => {
    const scope = document.querySelector(selector)
    if (scope === null) {
      return [`scope not found: ${selector}`]
    }
    const leaves = [...scope.querySelectorAll("*")].filter((element) => {
      if (element.children.length > 0) {
        return false
      }
      const text = element.textContent?.trim() ?? ""
      if (text.length === 0) {
        return false
      }
      const style = window.getComputedStyle(element)
      return style.visibility !== "hidden" && style.display !== "none"
    })
    const found: string[] = []
    for (let a = 0; a < leaves.length; a += 1) {
      for (let b = a + 1; b < leaves.length; b += 1) {
        const first = leaves[a]?.getBoundingClientRect()
        const second = leaves[b]?.getBoundingClientRect()
        if (first === undefined || second === undefined) {
          continue
        }
        if (first.width === 0 || second.width === 0) {
          continue
        }
        const xOverlap = Math.min(first.right, second.right) - Math.max(first.left, second.left)
        const yOverlap = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top)
        if (xOverlap > 2 && yOverlap > 2) {
          found.push(
            `${leaves[a]?.tagName}:"${leaves[a]?.textContent?.trim().slice(0, 24)}" overlaps ${leaves[b]?.tagName}:"${leaves[b]?.textContent?.trim().slice(0, 24)}"`,
          )
        }
      }
    }
    return found
  }, scopeSelector)
  if (overlaps.length > 0) {
    throw new BrowserQaError(`text overlap in ${scopeSelector}: ${overlaps.join("; ")}`)
  }
  return `no text overlap in ${scopeSelector}`
}

const main = async (args: readonly string[]) => {
  const options = parseOptions(args)
  mkdirSync(options.evidenceDir, { recursive: true })
  mkdirSync(".tmp", { recursive: true })
  const workRoot = mkdtempSync(join(resolve(".tmp"), "marketplace-browser-qa-"))
  const outboxPath = join(workRoot, "email-outbox.jsonl")
  const operatorStatePath = join(workRoot, "operator-state.json")
  const checks: StateCheck[] = []
  const record = (width: number, state: string, detail: string) => {
    checks.push({ width, state, passed: true, detail })
    console.error(`browser-qa[${width}]: ${state} - ${detail}`)
  }

  const sellerRecord = {
    accessId: "access-approved-seller",
    role: "seller",
    participantId: "participant-seller",
    sellerId: "agent-local",
    waitlistState: "approved",
    apiKeyHash: hashRegistryApiKey(approvedSellerKey),
    apiKeyState: "active",
  } as const
  writeRegistryOperatorState(operatorStatePath, {
    schemaVersion: 1,
    records: parseClosedAlphaAccessRecords([sellerRecord]).records,
    auditEvents: [],
  })
  const server = startRegistryServer(
    parseRegistryServeConfig({
      emailAuth: {
        secret: "browser-qa-auth-secret",
        delivery: { mode: "local-outbox", outboxPath },
      },
      host: "127.0.0.1",
      port: "0",
      db: join(workRoot, "registry.sqlite"),
      storage: join(workRoot, "storage"),
      tmp: join(workRoot, "tmp"),
      accessRecords: [sellerRecord],
      accessRecordsLoader: () => readRegistryOperatorState(operatorStatePath).records,
      operatorState: operatorStatePath,
    }),
  )
  const browser = await chromium.launch()
  try {
    const metadataPath = join(workRoot, "metadata.json")
    writeFileSync(metadataPath, `${JSON.stringify(requestRequiredMetadata, null, 2)}\n`, "utf8")
    const packageDir = await prepareHostedPackage(workRoot, metadataPath)
    const publishResult = await runHostedCli(
      [
        "trajectory",
        "seller",
        "publish",
        "--path",
        packageDir,
        "--registry",
        server.baseUrl,
        "--json",
      ],
      { TRAJECTORY_REGISTRY_API_KEY: approvedSellerKey },
    )
    if (publishResult.exitCode !== 0) {
      throw new BrowserQaError(`seller publish failed: ${publishResult.stderr}`)
    }
    registryUploadSuccessSchema.parse(JSON.parse(publishResult.stdout))

    for (const width of options.widths) {
      const label = widthLabel(width)
      const email = `browser-qa-${label}@example.test`
      const context = await browser.newContext({ viewport: { width, height: 940 } })
      const page = await context.newPage()
      const shot = async (suffix: string) => {
        await page.screenshot({
          path: join(options.evidenceDir, `task-10-${label}-${suffix}.png`),
          fullPage: false,
        })
      }

      await page.goto(`${server.baseUrl}/marketplace`, { waitUntil: "networkidle" })

      // Signed-out catalog gate + no password affordance anywhere.
      await page
        .locator("#listing-grid")
        .getByText("Sign in to browse datasets and request access.")
        .waitFor({ timeout: 10_000 })
      if ((await page.locator("#account-password, input[type=password]").count()) > 0) {
        throw new BrowserQaError("password field present in marketplace UI")
      }
      record(width, "signed-out-gate", "catalog gated behind sign-in; no password field")
      record(width, "layout", await assertNoHorizontalOverflow(page))

      // Email entry state.
      await page.locator("#account-auth-open").click()
      await page.locator("#account-auth-dialog").waitFor({ state: "visible" })
      if (!(await page.locator("#account-email").isEditable())) {
        throw new BrowserQaError("account modal email input is not editable")
      }
      record(width, "modal-overlap", await assertNoTextOverlap(page, "#account-auth-dialog"))
      await shot("email-entry")
      record(width, "email-entry", "account dialog open with email step")

      // Code sent state.
      await page.locator("#account-email").fill(email)
      await page.locator("#account-auth-submit").click()
      await page.locator("#account-code-form").waitFor({ state: "visible" })
      await page.getByText(`Code sent to ${email}`).waitFor()
      await shot("code-sent")
      record(width, "code-sent", "verify step visible after signup start")

      // Invalid code state: dialog stays open, error note renders, still signed out.
      const realCode = await waitForOutboxCode(outboxPath, email)
      const wrongCode = realCode === "000000" ? "000001" : "000000"
      await page.locator("#account-code").fill(wrongCode)
      await page.locator("#account-code-submit").click()
      await page.locator("#account-auth-note").getByText("Invalid or expired code").waitFor()
      if (!(await page.locator("#account-auth-dialog").isVisible())) {
        throw new BrowserQaError("dialog closed after invalid code")
      }
      await shot("invalid-code")
      record(width, "invalid-code", "typed error rendered; dialog stays open; still signed out")

      // Signed-in catalog after entering the real one-time code.
      await page.locator("#account-code").fill(realCode)
      await page.locator("#account-code-submit").click()
      await page.locator(".listing-card").first().waitFor({ timeout: 10_000 })
      record(
        width,
        "signed-in-catalog",
        `listing visible after email-code sign-in (${redactedEmailCode})`,
      )

      // Detail + access request submitted + gated download state.
      await page.locator(".listing-card").first().click()
      await page.locator("#detail-panel-content .file-row").first().waitFor({ timeout: 10_000 })
      const requestButton = page
        .locator("#detail-panel-content .file-row button", { hasText: "Request access" })
        .first()
      await requestButton.waitFor()
      await requestButton.click()
      await page
        .locator("#detail-panel-content")
        .getByText("Request submitted")
        .first()
        .waitFor({ timeout: 10_000 })
      const detailText = (await page.locator("#detail-panel-content").innerText()).replaceAll(
        "\n",
        " ",
      )
      if (!detailText.includes("Entitlement not granted")) {
        throw new BrowserQaError("gated download state missing: Entitlement not granted not shown")
      }
      if (!detailText.includes("Checkout disabled")) {
        throw new BrowserQaError("gated download state missing: Checkout disabled not shown")
      }
      record(width, "access-request-submitted", "request submitted state visible in detail")
      record(width, "gated-download", "entitlement not granted + checkout disabled visible")
      record(
        width,
        "detail-overlap",
        await assertNoTextOverlap(page, "#detail-panel-content .detail-module"),
      )
      record(
        width,
        "detail-clipping",
        await assertControlsNotClipped(page, "#detail-panel-content"),
      )
      record(width, "layout-final", await assertNoHorizontalOverflow(page))

      await page.screenshot({
        path: join(options.evidenceDir, `task-10-${label}.png`),
        fullPage: true,
      })
      record(width, "screenshot", `task-10-${label}.png captured`)
      await context.close()
    }

    writeFileSync(
      join(options.evidenceDir, "task-10-browser-log.json"),
      `${JSON.stringify(
        {
          registryUrl: server.baseUrl,
          widths: options.widths,
          emailCode: redactedEmailCode,
          checks,
        },
        null,
        2,
      )}\n`,
      "utf8",
    )
    console.error("browser-qa: all states passed")
  } finally {
    await browser.close()
    await server.stop()
    rmSync(workRoot, { force: true, recursive: true })
  }
}

await main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "unknown browser qa failure")
  process.exitCode = 1
})
