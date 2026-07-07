import type { Command } from "commander"

import {
  inspectOperatorKey,
  linkOperatorAccount,
  mutateRegistryOperatorState,
  type RegistryOperatorState,
  readRegistryOperatorState,
  unlinkOperatorAccount,
} from "../registry/operator"

type OperatorStateOptions = Readonly<{
  state: string
}>

type OperatorActorOptions = OperatorStateOptions &
  Readonly<{
    actor: string
    accessId: string
  }>

type OperatorAccountLinkOptions = OperatorActorOptions &
  Readonly<{
    accountId: string
  }>

const printJson = (value: unknown) => {
  console.log(JSON.stringify(value, null, 2))
}

const mutateState = (
  options: OperatorStateOptions,
  mutate: (state: RegistryOperatorState) => RegistryOperatorState,
) => {
  const nextState = mutateRegistryOperatorState(options.state, mutate)
  printJson(nextState)
}

export const registerOperatorAccountCommands = (operatorCommand: Command) => {
  const accountCommand = operatorCommand.command("account").description("Link accounts to access")
  accountCommand
    .command("link")
    .description("Link a web account to an access record")
    .requiredOption("--state <path>", "Operator access state JSON path")
    .requiredOption("--access-id <id>", "Access record id")
    .requiredOption("--account-id <id>", "Account id to link")
    .requiredOption("--actor <id>", "Operator actor id for audit")
    .action((options: OperatorAccountLinkOptions) => {
      mutateState(options, (state) =>
        linkOperatorAccount(state, {
          accessId: options.accessId,
          accountId: options.accountId,
          actorId: options.actor,
        }),
      )
    })

  accountCommand
    .command("unlink")
    .description("Remove a web account link from an access record")
    .requiredOption("--state <path>", "Operator access state JSON path")
    .requiredOption("--access-id <id>", "Access record id")
    .requiredOption("--actor <id>", "Operator actor id for audit")
    .action((options: OperatorActorOptions) => {
      mutateState(options, (state) =>
        unlinkOperatorAccount(state, {
          accessId: options.accessId,
          actorId: options.actor,
        }),
      )
    })

  accountCommand
    .command("inspect")
    .description("Inspect account linkage for an access record")
    .requiredOption("--state <path>", "Operator access state JSON path")
    .requiredOption("--access-id <id>", "Access record id")
    .action((options: OperatorStateOptions & Readonly<{ accessId: string }>) => {
      printJson(inspectOperatorKey(readRegistryOperatorState(options.state), options.accessId))
    })
}
