#!/usr/bin/env bun
// Browser QA for the seller-custodied supply states: seeds wanted, candidate,
// committed (open auction), and fulfilled (released entitlement) records,
// signs a fixture buyer in through the real email-code flow, and captures a
// screenshot plus action-availability assertions per state. Exits non-zero
// if any state shows a forbidden action (bid outside committed, any download
// anywhere) or leaks buyer identity.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { chromium } from "playwright"

import { hashRegistryApiKey, parseClosedAlphaAccessRecords } from "../src/registry/access.ts"
import {
  readRegistryOperatorState,
  writeRegistryOperatorState,
} from "../src/registry/operator-state.ts"
import { parseRegistryServeConfig, startRegistryServer } from "../src/registry/server.ts"

const sellerKey = "supply-qa-seller-key"
const buyerKey = "supply-qa-buyer-key"
const buyerAccessId = "access-buyer-qa"
const buyerEmail = "supply-qa-buyer@example.test"
const entitlementListingId = "listing-00000000000000aa"

class SupplyQaError extends Error {
  constructor(message) {
    super(message)
    this.name = "SupplyQaError"
  }
}

const parseOutDir = (args) => {
  const outFlag = args.indexOf("--out")
  if (outFlag === -1) {
    return ".omo/evidence/task-7-marketplace-supply-operating-model-ui"
  }
  const value = args[outFlag + 1]
  if (value === undefined || value.startsWith("--")) {
    throw new SupplyQaError("--out requires a directory path")
  }
  return value
}

const readFixture = (path) => JSON.parse(readFileSync(path, "utf8"))

const postJson = async (baseUrl, path, body, apiKey) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }),
    },
    body: JSON.stringify(body),
  })
  const parsed = await response.json()
  if (!response.ok) {
    throw new SupplyQaError(`POST ${path} failed: ${JSON.stringify(parsed)}`)
  }
  return parsed
}

const runOperatorCli = async (args) => {
  const child = Bun.spawn({
    cmd: [process.execPath, "src/cli/index.ts", "trajectory", "registry", "operator", ...args],
    cwd: process.cwd(),
    env: { ...process.env, LANG: "en_US.UTF-8" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) {
    throw new SupplyQaError(`operator ${args[0]} ${args[1] ?? ""} failed: ${stderr}`)
  }
  return JSON.parse(stdout)
}

const waitForOutboxCode = async (outboxPath, email) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const entries = readFileSync(outboxPath, "utf8")
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line))
        .filter((entry) => entry.to === email)
      const latest = entries.at(-1)
      if (latest !== undefined) {
        return latest.code
      }
    } catch {
      // outbox not written yet
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 100))
  }
  throw new SupplyQaError(`outbox code never arrived for ${email}`)
}

const seedCommittedSupply = async (baseUrl, title, auctionDeadline) => {
  const candidateFixture = readFixture("test/fixtures/candidate-valid.json")
  const candidate = await postJson(
    baseUrl,
    "/v1/supply/candidates",
    { ...candidateFixture, title },
    sellerKey,
  )
  const commitmentFixture = readFixture("test/fixtures/commitment-valid.json")
  const committed = await postJson(
    baseUrl,
    "/v1/supply/commitments",
    { ...commitmentFixture, supplyId: candidate.supply.supplyId, auctionDeadline },
    sellerKey,
  )
  return committed.supply
}

const detailActionSnapshot = async (page) => {
  return page.evaluate(() => {
    const detail = document.querySelector("#detail-panel-content")
    const actionText = [...detail.querySelectorAll("button, a")]
      .map((node) => node.textContent ?? "")
      .join(" | ")
    return {
      interestVisible: detail.querySelectorAll(".interest-button").length > 0,
      bidVisible: detail.querySelectorAll(".bid-form").length > 0,
      downloadVisible:
        detail.querySelectorAll(".file-row").length > 0 || /\bDownload\b/.test(actionText),
      accessReleasedVisible: detail.querySelectorAll(".access-released").length > 0,
      detailText: detail.textContent ?? "",
    }
  })
}

const main = async () => {
  const outDir = parseOutDir(process.argv.slice(2))
  mkdirSync(outDir, { recursive: true })
  mkdirSync(".tmp", { recursive: true })
  const workRoot = mkdtempSync(join(resolve(".tmp"), "qa-supply-states-"))
  const outboxPath = join(workRoot, "email-outbox.jsonl")
  const operatorStatePath = join(workRoot, "operator-state.json")
  const dbPath = join(workRoot, "registry.sqlite")

  const records = [
    {
      accessId: "access-approved-seller",
      role: "seller",
      participantId: "participant-seller",
      sellerId: "agent-local",
      waitlistState: "approved",
      apiKeyHash: hashRegistryApiKey(sellerKey),
      apiKeyState: "active",
    },
    {
      accessId: buyerAccessId,
      role: "buyer",
      participantId: "qa-buyer",
      waitlistState: "approved",
      apiKeyHash: hashRegistryApiKey(buyerKey),
      apiKeyState: "active",
    },
  ]
  writeRegistryOperatorState(operatorStatePath, {
    schemaVersion: 1,
    records: parseClosedAlphaAccessRecords(records).records,
    auditEvents: [],
  })

  const server = startRegistryServer(
    parseRegistryServeConfig({
      emailAuth: {
        secret: "supply-qa-auth-secret",
        delivery: { mode: "local-outbox", outboxPath },
      },
      host: "127.0.0.1",
      port: "0",
      db: dbPath,
      storage: join(workRoot, "storage"),
      tmp: join(workRoot, "tmp"),
      accessRecords: records,
      accessRecordsLoader: () => readRegistryOperatorState(operatorStatePath).records,
      operatorState: operatorStatePath,
    }),
  )
  const browser = await chromium.launch()
  const failures = []
  const assertions = { buyerIdentityLeaks: [] }
  try {
    const baseUrl = server.baseUrl

    // Create the buyer account server-side and link it to the approved buyer
    // record so the browser session carries approval + entitlements.
    await postJson(baseUrl, "/v1/auth/signup", { acceptedTerms: true, email: buyerEmail })
    const code = await waitForOutboxCode(outboxPath, buyerEmail)
    const login = await fetch(`${baseUrl}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: buyerEmail, code }),
    })
    const loginBody = await login.json()
    if (!login.ok) {
      throw new SupplyQaError(`login failed: ${JSON.stringify(loginBody)}`)
    }
    const accountId = loginBody.account.accountId
    const state = readRegistryOperatorState(operatorStatePath)
    writeRegistryOperatorState(operatorStatePath, {
      ...state,
      records: state.records.map((record) =>
        record.accessId === buyerAccessId ? { ...record, accountId } : record,
      ),
    })

    // Seed one record per state.
    const wantedFixture = readFixture("test/fixtures/wanted-dataset.json")
    await postJson(baseUrl, "/v1/supply/wanted", wantedFixture, buyerKey)
    const candidateFixture = readFixture("test/fixtures/candidate-valid.json")
    await postJson(baseUrl, "/v1/supply/candidates", candidateFixture, sellerKey)
    const openCommitted = await seedCommittedSupply(
      baseUrl,
      "Committed bundle / open auction",
      "2027-01-01T00:00:00.000Z",
    )
    await postJson(
      baseUrl,
      `/v1/supply/commitments/${openCommitted.commitmentId}/auction/bids`,
      { amountMinorUnits: 480000, currency: "USD" },
      buyerKey,
    )
    const fulfilledCommitted = await seedCommittedSupply(
      baseUrl,
      "Committed bundle / fulfilled",
      "2027-01-01T00:00:00.000Z",
    )
    await postJson(
      baseUrl,
      `/v1/supply/commitments/${fulfilledCommitted.commitmentId}/auction/bids`,
      { amountMinorUnits: 500000, currency: "USD" },
      buyerKey,
    )
    await runOperatorCli([
      "auction",
      "close",
      "--db",
      dbPath,
      "--commitment-id",
      fulfilledCommitted.commitmentId,
      "--actor",
      "operator-qa",
      "--json",
    ])
    const opened = await runOperatorCli([
      "fulfillment",
      "open",
      "--db",
      dbPath,
      "--commitment-id",
      fulfilledCommitted.commitmentId,
      "--buyer-access-id",
      buyerAccessId,
      "--listing-id",
      entitlementListingId,
      "--actor",
      "operator-qa",
      "--json",
    ])
    const transactionId = opened.fulfillment.transactionId
    await runOperatorCli([
      "fulfillment",
      "mark-delivered",
      "--db",
      dbPath,
      "--state",
      operatorStatePath,
      "--transaction-id",
      transactionId,
      "--delivery-manifest",
      "test/fixtures/fulfillment-delivered-package.json",
      "--actor",
      "operator-qa",
      "--json",
    ])
    await runOperatorCli([
      "fulfillment",
      "validate",
      "--db",
      dbPath,
      "--state",
      operatorStatePath,
      "--transaction-id",
      transactionId,
      "--validation-report",
      "test/fixtures/fulfillment-validation-match.json",
      "--actor",
      "operator-qa",
      "--json",
    ])
    await runOperatorCli([
      "fulfillment",
      "release-entitlement",
      "--db",
      dbPath,
      "--state",
      operatorStatePath,
      "--transaction-id",
      transactionId,
      "--buyer-access-id",
      buyerAccessId,
      "--listing-id",
      entitlementListingId,
      "--actor",
      "operator-qa",
      "--json",
    ])

    // Sign the buyer in through the real browser flow.
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
    const page = await context.newPage()
    await page.goto(`${baseUrl}/marketplace`, { waitUntil: "networkidle" })
    await page.locator("#account-auth-open").click()
    await page.locator("#account-email").fill(buyerEmail)
    await page.locator("#account-auth-submit").click()
    await page.locator("#account-code-form").waitFor({ state: "visible" })
    const browserCode = await waitForOutboxCode(outboxPath, buyerEmail)
    await page.locator("#account-code").fill(browserCode)
    await page.locator("#account-code-submit").click()
    await page.locator(".supply-card").first().waitFor({ timeout: 10_000 })

    const capture = async (name, selector, readySelector) => {
      await page.locator(selector).first().click()
      try {
        await page
          .locator(`#detail-panel-content ${readySelector}`)
          .first()
          .waitFor({ timeout: 10_000 })
      } catch (error) {
        const debugText = await page.evaluate(
          () => document.querySelector("#detail-panel-content")?.textContent ?? "<missing>",
        )
        const registryState = await page.evaluate(
          () => document.querySelector("#registry-state")?.textContent ?? "<missing>",
        )
        console.error(
          `capture(${name}) timeout; registry-state=${registryState}; detailTail=${debugText.slice(-700)}`,
        )
        throw error
      }
      const snapshot = await detailActionSnapshot(page)
      await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: false })
      const pageText = await page.evaluate(() => document.body.textContent ?? "")
      for (const secret of [buyerEmail.split("@")[0], buyerAccessId, accountId]) {
        // The signed-in account note legitimately shows the account's own
        // email in the top bar; identity must never appear in the catalog or
        // detail surfaces.
        if (snapshot.detailText.includes(secret)) {
          assertions.buyerIdentityLeaks.push(`${name}: detail contains ${secret}`)
        }
      }
      if (pageText.includes(buyerAccessId) || pageText.includes(accountId)) {
        assertions.buyerIdentityLeaks.push(`${name}: page contains a raw access/account id`)
      }
      return snapshot
    }

    const wanted = await capture("wanted", '.supply-card[data-state="wanted"]', ".interest-button")
    assertions.wanted = wanted
    const candidate = await capture(
      "candidate",
      '.supply-card[data-state="candidate"]',
      ".interest-button",
    )
    assertions.candidate = candidate
    const committed = await capture(
      "committed",
      `.supply-card[data-record-id="${openCommitted.supplyId}"]`,
      ".bid-form",
    )
    assertions.committed = committed
    const fulfilled = await capture(
      "fulfilled",
      `.supply-card[data-record-id="${fulfilledCommitted.supplyId}"]`,
      ".access-released",
    )
    assertions.fulfilled = fulfilled

    const expectState = (name, snapshot, expected) => {
      for (const [key, value] of Object.entries(expected)) {
        if (snapshot[key] !== value) {
          failures.push(`${name}: expected ${key}=${value}, saw ${snapshot[key]}`)
        }
      }
    }
    expectState("wanted", wanted, {
      interestVisible: true,
      bidVisible: false,
      downloadVisible: false,
    })
    expectState("candidate", candidate, {
      interestVisible: true,
      bidVisible: false,
      downloadVisible: false,
    })
    expectState("committed", committed, {
      interestVisible: true,
      bidVisible: true,
      downloadVisible: false,
    })
    expectState("fulfilled", fulfilled, {
      bidVisible: false,
      downloadVisible: false,
      accessReleasedVisible: true,
    })
    if (assertions.buyerIdentityLeaks.length > 0) {
      failures.push(`buyer identity leaks: ${assertions.buyerIdentityLeaks.join("; ")}`)
    }

    for (const state of ["wanted", "candidate", "committed", "fulfilled"]) {
      assertions[state] = { ...assertions[state], detailText: undefined }
    }
    writeFileSync(
      join(outDir, "assertions.json"),
      `${JSON.stringify({ ...assertions, failures, passed: failures.length === 0 }, null, 2)}\n`,
    )
    if (failures.length > 0) {
      throw new SupplyQaError(`state assertions failed: ${failures.join(" | ")}`)
    }
    console.log(
      JSON.stringify({
        ok: true,
        outDir,
        screenshots: ["wanted.png", "candidate.png", "committed.png", "fulfilled.png"],
      }),
    )
  } finally {
    await browser.close()
    await server.stop()
    rmSync(workRoot, { force: true, recursive: true })
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error))
  process.exitCode = 1
})
