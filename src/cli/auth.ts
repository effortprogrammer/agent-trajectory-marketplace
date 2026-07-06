import type { Command } from "commander"

import {
  pollRegistryDeviceToken,
  readRegistryAuthStatus,
  registrySignupUrl,
  revokeRegistryAuthToken,
  startRegistryDeviceAuthorization,
} from "../registry/client-auth"
import { normalizeRegistryBaseUrl, RegistryClientError } from "../registry/client-transport"
import {
  readStoredRegistrySession,
  removeStoredRegistrySession,
  writeStoredRegistrySession,
} from "./auth-store"

type AuthLoginOptions = Readonly<{
  client?: string
  json?: boolean
  pollIntervalMs?: string
  registry: string
  timeoutMs?: string
}>

type AuthRegistryOptions = Readonly<{
  json?: boolean
  registry: string
}>

const defaultClientName = "trajectory-marketplace-cli"

const printJson = (value: unknown) => {
  console.log(JSON.stringify(value, null, 2))
}

const parsePositiveIntegerOption = (
  value: string | undefined,
  name: string,
): number | undefined => {
  if (value === undefined) {
    return undefined
  }
  const parsed = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new RegistryClientError(
      "invalid_request",
      `invalid_request: ${name} must be a positive integer`,
      0,
    )
  }
  return parsed
}

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })

const tokenExpiresAt = (expiresInSeconds: number): string =>
  new Date(Date.now() + expiresInSeconds * 1_000).toISOString()

const pollUntilAuthorized = async (input: {
  readonly deviceCode: string
  readonly intervalMs: number
  readonly registryUrl: string
  readonly timeoutMs: number
}) => {
  const deadline = Date.now() + input.timeoutMs
  let intervalMs = input.intervalMs
  while (Date.now() <= deadline) {
    const result = await pollRegistryDeviceToken({
      deviceCode: input.deviceCode,
      registryUrl: input.registryUrl,
    })
    if (result.state === "authorized") {
      return result.token
    }
    if (result.state === "slow_down") {
      intervalMs += input.intervalMs
    }
    const remainingMs = deadline - Date.now()
    if (remainingMs > 0) {
      await sleep(Math.min(intervalMs, remainingMs))
    }
  }
  throw new RegistryClientError(
    "device_authorization_timeout",
    "device_authorization_timeout: approve the device login before the timeout",
    0,
  )
}

const loggedOutStatus = (registryUrl: string) => ({
  loggedIn: false,
  registryUrl: normalizeRegistryBaseUrl(registryUrl),
})

const runLogin = async (options: AuthLoginOptions) => {
  const authorization = await startRegistryDeviceAuthorization({
    client: options.client ?? defaultClientName,
    registryUrl: options.registry,
  })
  const intervalMs =
    parsePositiveIntegerOption(options.pollIntervalMs, "--poll-interval-ms") ??
    authorization.interval * 1_000
  const timeoutMs =
    parsePositiveIntegerOption(options.timeoutMs, "--timeout-ms") ??
    authorization.expires_in * 1_000
  if (options.json !== true) {
    console.log(`Open ${authorization.verification_uri_complete}`)
    console.log(`Enter code ${authorization.user_code}`)
  }
  const token = await pollUntilAuthorized({
    deviceCode: authorization.device_code,
    intervalMs,
    registryUrl: options.registry,
    timeoutMs,
  })
  writeStoredRegistrySession({
    accessToken: token.access_token,
    expiresAt: tokenExpiresAt(token.expires_in),
    registryUrl: options.registry,
    tokenType: token.token_type,
  })
  printJson({
    loggedIn: true,
    registryUrl: normalizeRegistryBaseUrl(options.registry),
    tokenType: token.token_type,
    verificationUri: authorization.verification_uri_complete,
    userCode: authorization.user_code,
  })
}

const runStatus = async (options: AuthRegistryOptions) => {
  const session = readStoredRegistrySession(options.registry)
  if (session === undefined) {
    printJson(loggedOutStatus(options.registry))
    return
  }
  try {
    const status = await readRegistryAuthStatus({
      accessToken: session.accessToken,
      registryUrl: options.registry,
    })
    if (status.account === null) {
      printJson(loggedOutStatus(options.registry))
      return
    }
    printJson({
      loggedIn: true,
      registryUrl: normalizeRegistryBaseUrl(options.registry),
      account: {
        accountId: status.account.accountId,
        email: status.account.email,
      },
      access: status.access,
    })
  } catch (caught: unknown) {
    if (caught instanceof RegistryClientError && caught.code === "unauthorized") {
      printJson(loggedOutStatus(options.registry))
      return
    }
    throw caught
  }
}

const runLogout = async (options: AuthRegistryOptions) => {
  const session = readStoredRegistrySession(options.registry)
  let revoked = false
  if (session !== undefined) {
    try {
      revoked = await revokeRegistryAuthToken({
        accessToken: session.accessToken,
        registryUrl: options.registry,
      })
    } catch (caught: unknown) {
      if (!(caught instanceof RegistryClientError && caught.code === "unauthorized")) {
        throw caught
      }
    }
  }
  removeStoredRegistrySession(options.registry)
  printJson({
    loggedOut: true,
    registryUrl: normalizeRegistryBaseUrl(options.registry),
    revoked,
  })
}

export const registerAuthCommand = (trajectoryCommand: Command) => {
  const authCommand = trajectoryCommand
    .command("auth")
    .description("Authenticate the CLI with a marketplace web account")

  authCommand
    .command("login")
    .description("Log in with browser device-code authorization")
    .requiredOption("--registry <url>", "Marketplace registry base URL")
    .option("--client <name>", "Device client display name", defaultClientName)
    .option("--poll-interval-ms <milliseconds>", "Override device polling interval")
    .option("--timeout-ms <milliseconds>", "Override device login timeout")
    .option("--json", "Print login result as JSON")
    .action(async (options: AuthLoginOptions) => {
      await runLogin(options)
    })

  authCommand
    .command("status")
    .description("Show the current CLI marketplace account")
    .requiredOption("--registry <url>", "Marketplace registry base URL")
    .option("--json", "Print auth status as JSON")
    .action(async (options: AuthRegistryOptions) => {
      await runStatus(options)
    })

  authCommand
    .command("logout")
    .description("Revoke and remove the stored CLI marketplace credential")
    .requiredOption("--registry <url>", "Marketplace registry base URL")
    .option("--json", "Print logout result as JSON")
    .action(async (options: AuthRegistryOptions) => {
      await runLogout(options)
    })

  authCommand
    .command("signup")
    .description("Print the web signup URL; CLI account creation is intentionally disabled")
    .requiredOption("--registry <url>", "Marketplace registry base URL")
    .option("--json", "Print signup URL as JSON")
    .action((options: AuthRegistryOptions) => {
      printJson({ signupUrl: registrySignupUrl(options.registry) })
    })
}
