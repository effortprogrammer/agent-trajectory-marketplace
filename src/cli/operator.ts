import type { Command } from "commander"

import {
  createOperatorSeller,
  exportOperatorAudit,
  grantOperatorBuyer,
  inspectOperatorKey,
  type RegistryOperatorState,
  readRegistryOperatorState,
  requestOperatorAccess,
  revokeOperatorKey,
  rotateOperatorKey,
  transitionOperatorWaitlist,
  writeRegistryOperatorState,
} from "../registry/operator"
import { registerOperatorAccountCommands } from "./operator-account"
import { registerOperatorManualCommerceCommands } from "./operator-manual-commerce"
import { registerOperatorStorageCommands } from "./operator-storage"

type OperatorStateOptions = Readonly<{
  state: string
}>

type OperatorActorOptions = OperatorStateOptions &
  Readonly<{
    actor: string
    accessId: string
  }>

type OperatorKeyOptions = Readonly<{
  key?: string
  keyEnv?: string
}>

type OperatorSellerOptions = OperatorActorOptions &
  OperatorKeyOptions &
  Readonly<{
    participantId: string
    sellerId: string
  }>

type OperatorBuyerOptions = OperatorActorOptions &
  OperatorKeyOptions &
  Readonly<{
    participantId: string
  }>

type OperatorWaitlistRequestOptions = OperatorActorOptions &
  Readonly<{
    participantId: string
    role: string
    sellerId?: string
  }>

type OperatorKeyRotateOptions = OperatorActorOptions & OperatorKeyOptions

const printJson = (value: unknown) => {
  console.log(JSON.stringify(value, null, 2))
}

const parseOperatorRole = (value: string): "buyer" | "seller" => {
  if (value === "buyer" || value === "seller") {
    return value
  }
  throw new Error("invalid_request: --role must be buyer or seller")
}

const resolveOperatorKey = (options: OperatorKeyOptions): string => {
  if (options.key !== undefined && options.keyEnv !== undefined) {
    throw new Error("invalid_request: use either --key-env or deprecated --key, not both")
  }
  if (options.keyEnv !== undefined) {
    const key = process.env[options.keyEnv]
    if (key === undefined || key.trim().length === 0) {
      throw new Error(`invalid_request: --key-env ${options.keyEnv} is unset or empty`)
    }
    return key
  }
  if (options.key !== undefined) {
    console.error("warning: --key is unsafe/deprecated; prefer --key-env <ENV_NAME>")
    return options.key
  }
  throw new Error("invalid_request: pass --key-env <ENV_NAME>")
}

const mutateState = (
  options: OperatorStateOptions,
  mutate: (state: RegistryOperatorState) => RegistryOperatorState,
) => {
  const nextState = mutate(readRegistryOperatorState(options.state))
  writeRegistryOperatorState(options.state, nextState)
  printJson(nextState)
}

export const registerOperatorCommand = (registryCommand: Command) => {
  const operatorCommand = registryCommand
    .command("operator")
    .description("Run closed-alpha registry operator actions against local staging state")

  const sellerCommand = operatorCommand.command("seller").description("Manage seller access")
  sellerCommand
    .command("create")
    .description("Create approved seller access and issue a staging API key")
    .requiredOption("--state <path>", "Operator access state JSON path")
    .requiredOption("--access-id <id>", "Access record id")
    .requiredOption("--participant-id <id>", "Waitlist participant id")
    .requiredOption("--seller-id <id>", "Seller id allowed to publish")
    .option("--key-env <name>", "Read key material from an environment variable")
    .option("--key <key>", "UNSAFE/deprecated: plaintext key material in argv")
    .requiredOption("--actor <id>", "Operator actor id for audit")
    .action((options: OperatorSellerOptions) => {
      mutateState(options, (state) =>
        createOperatorSeller(state, {
          accessId: options.accessId,
          actorId: options.actor,
          key: resolveOperatorKey(options),
          participantId: options.participantId,
          sellerId: options.sellerId,
        }),
      )
    })

  const buyerCommand = operatorCommand.command("buyer").description("Manage buyer access")
  buyerCommand
    .command("grant")
    .description("Create approved buyer access and issue a staging API key")
    .requiredOption("--state <path>", "Operator access state JSON path")
    .requiredOption("--access-id <id>", "Access record id")
    .requiredOption("--participant-id <id>", "Waitlist participant id")
    .option("--key-env <name>", "Read key material from an environment variable")
    .option("--key <key>", "UNSAFE/deprecated: plaintext key material in argv")
    .requiredOption("--actor <id>", "Operator actor id for audit")
    .action((options: OperatorBuyerOptions) => {
      mutateState(options, (state) =>
        grantOperatorBuyer(state, {
          accessId: options.accessId,
          actorId: options.actor,
          key: resolveOperatorKey(options),
          participantId: options.participantId,
        }),
      )
    })

  const waitlistCommand = operatorCommand.command("waitlist").description("Review waitlist intake")
  waitlistCommand
    .command("request")
    .description("Record waitlist intake")
    .requiredOption("--state <path>", "Operator access state JSON path")
    .requiredOption("--access-id <id>", "Access record id")
    .requiredOption("--participant-id <id>", "Waitlist participant id")
    .requiredOption("--role <role>", "Access role: buyer or seller")
    .option("--seller-id <id>", "Required when role is seller")
    .requiredOption("--actor <id>", "Operator actor id for audit")
    .action((options: OperatorWaitlistRequestOptions) => {
      mutateState(options, (state) =>
        requestOperatorAccess(state, {
          accessId: options.accessId,
          actorId: options.actor,
          participantId: options.participantId,
          role: parseOperatorRole(options.role),
          ...(options.sellerId === undefined ? {} : { sellerId: options.sellerId }),
        }),
      )
    })

  for (const transition of ["invite", "approve", "reject", "revoke"] as const) {
    const waitlistState = (
      {
        invite: "invited",
        approve: "approved",
        reject: "rejected",
        revoke: "revoked",
      } as const
    )[transition]
    waitlistCommand
      .command(transition)
      .description(`Move access record to ${waitlistState}`)
      .requiredOption("--state <path>", "Operator access state JSON path")
      .requiredOption("--access-id <id>", "Access record id")
      .requiredOption("--actor <id>", "Operator actor id for audit")
      .action((options: OperatorActorOptions) => {
        mutateState(options, (state) =>
          transitionOperatorWaitlist(state, {
            accessId: options.accessId,
            actorId: options.actor,
            waitlistState,
          }),
        )
      })
  }

  registerOperatorManualCommerceCommands(operatorCommand, waitlistCommand)

  const keyCommand = operatorCommand.command("key").description("Rotate, revoke, and inspect keys")
  keyCommand
    .command("rotate")
    .description("Rotate a staging API key for approved access")
    .requiredOption("--state <path>", "Operator access state JSON path")
    .requiredOption("--access-id <id>", "Access record id")
    .option("--key-env <name>", "Read key material from an environment variable")
    .option("--key <key>", "UNSAFE/deprecated: plaintext key material in argv")
    .requiredOption("--actor <id>", "Operator actor id for audit")
    .action((options: OperatorKeyRotateOptions) => {
      mutateState(options, (state) =>
        rotateOperatorKey(state, {
          accessId: options.accessId,
          actorId: options.actor,
          key: resolveOperatorKey(options),
        }),
      )
    })

  keyCommand
    .command("revoke")
    .description("Revoke a staging API key")
    .requiredOption("--state <path>", "Operator access state JSON path")
    .requiredOption("--access-id <id>", "Access record id")
    .requiredOption("--actor <id>", "Operator actor id for audit")
    .action((options: OperatorActorOptions) => {
      mutateState(options, (state) =>
        revokeOperatorKey(state, {
          accessId: options.accessId,
          actorId: options.actor,
        }),
      )
    })

  keyCommand
    .command("inspect")
    .description("Inspect staging key status without exposing key material")
    .requiredOption("--state <path>", "Operator access state JSON path")
    .requiredOption("--access-id <id>", "Access record id")
    .action((options: OperatorStateOptions & Readonly<{ accessId: string }>) => {
      printJson(inspectOperatorKey(readRegistryOperatorState(options.state), options.accessId))
    })

  registerOperatorAccountCommands(operatorCommand)

  registerOperatorStorageCommands(operatorCommand)

  const auditCommand = operatorCommand.command("audit").description("Export redacted audit records")
  auditCommand
    .command("export")
    .description("Print a redacted closed-alpha operator audit export")
    .requiredOption("--state <path>", "Operator access state JSON path")
    .action((options: OperatorStateOptions) => {
      printJson(exportOperatorAudit(readRegistryOperatorState(options.state)))
    })
}
