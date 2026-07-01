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
import { registerOperatorStorageCommands } from "./operator-storage"

type OperatorStateOptions = Readonly<{
  state: string
}>

type OperatorActorOptions = OperatorStateOptions &
  Readonly<{
    actor: string
    accessId: string
  }>

type OperatorSellerOptions = OperatorActorOptions &
  Readonly<{
    key: string
    participantId: string
    sellerId: string
  }>

type OperatorBuyerOptions = OperatorActorOptions &
  Readonly<{
    key: string
    participantId: string
  }>

type OperatorWaitlistRequestOptions = OperatorActorOptions &
  Readonly<{
    participantId: string
    role: string
    sellerId?: string
  }>

type OperatorKeyRotateOptions = OperatorActorOptions & Readonly<{ key: string }>

const printJson = (value: unknown) => {
  console.log(JSON.stringify(value, null, 2))
}

const parseOperatorRole = (value: string): "buyer" | "seller" => {
  if (value === "buyer" || value === "seller") {
    return value
  }
  throw new Error("invalid_request: --role must be buyer or seller")
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
    .requiredOption("--key <key>", "Plaintext key material to hash into state")
    .requiredOption("--actor <id>", "Operator actor id for audit")
    .action((options: OperatorSellerOptions) => {
      mutateState(options, (state) =>
        createOperatorSeller(state, {
          accessId: options.accessId,
          actorId: options.actor,
          key: options.key,
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
    .requiredOption("--key <key>", "Plaintext key material to hash into state")
    .requiredOption("--actor <id>", "Operator actor id for audit")
    .action((options: OperatorBuyerOptions) => {
      mutateState(options, (state) =>
        grantOperatorBuyer(state, {
          accessId: options.accessId,
          actorId: options.actor,
          key: options.key,
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

  const keyCommand = operatorCommand.command("key").description("Rotate, revoke, and inspect keys")
  keyCommand
    .command("rotate")
    .description("Rotate a staging API key for approved access")
    .requiredOption("--state <path>", "Operator access state JSON path")
    .requiredOption("--access-id <id>", "Access record id")
    .requiredOption("--key <key>", "Plaintext key material to hash into state")
    .requiredOption("--actor <id>", "Operator actor id for audit")
    .action((options: OperatorKeyRotateOptions) => {
      mutateState(options, (state) =>
        rotateOperatorKey(state, {
          accessId: options.accessId,
          actorId: options.actor,
          key: options.key,
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
