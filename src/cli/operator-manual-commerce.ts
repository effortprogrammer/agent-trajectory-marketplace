import type { Command } from "commander"

import {
  grantOperatorEntitlement,
  inspectOperatorCommerce,
  listOperatorWaitlist,
  type RegistryOperatorState,
  readRegistryOperatorState,
  revokeOperatorEntitlement,
  writeRegistryOperatorState,
} from "../registry/operator"

type OperatorStateOptions = Readonly<{
  state: string
}>

type OperatorActorOptions = OperatorStateOptions &
  Readonly<{
    actor: string
    accessId: string
  }>

type OperatorEntitlementOptions = OperatorActorOptions &
  Readonly<{
    listingId: string
  }>

type OperatorListingOptions = OperatorStateOptions &
  Readonly<{
    listingId: string
  }>

const printJson = (value: unknown) => {
  console.log(JSON.stringify(value, null, 2))
}

const mutateState = (
  options: OperatorStateOptions,
  mutate: (state: RegistryOperatorState) => RegistryOperatorState,
) => {
  const nextState = mutate(readRegistryOperatorState(options.state))
  writeRegistryOperatorState(options.state, nextState)
  printJson(nextState)
}

export const registerOperatorManualCommerceCommands = (
  operatorCommand: Command,
  waitlistCommand: Command,
) => {
  waitlistCommand
    .command("list")
    .description("List redacted closed-alpha waitlist records")
    .requiredOption("--state <path>", "Operator access state JSON path")
    .option("--json", "Print JSON output")
    .action((options: OperatorStateOptions) => {
      printJson(listOperatorWaitlist(readRegistryOperatorState(options.state)))
    })

  const entitlementCommand = operatorCommand
    .command("entitlement")
    .description("Manually grant and revoke listing entitlements")
  entitlementCommand
    .command("grant")
    .description("Grant a buyer access record an active listing entitlement")
    .requiredOption("--state <path>", "Operator access state JSON path")
    .requiredOption("--access-id <id>", "Buyer access record id")
    .requiredOption("--listing-id <id>", "Listing id to grant")
    .requiredOption("--actor <id>", "Operator actor id for audit")
    .option("--json", "Print JSON output")
    .action((options: OperatorEntitlementOptions) => {
      mutateState(options, (state) =>
        grantOperatorEntitlement(state, {
          accessId: options.accessId,
          actorId: options.actor,
          listingId: options.listingId,
        }),
      )
    })

  entitlementCommand
    .command("revoke")
    .description("Revoke a buyer access record listing entitlement")
    .requiredOption("--state <path>", "Operator access state JSON path")
    .requiredOption("--access-id <id>", "Buyer access record id")
    .requiredOption("--listing-id <id>", "Listing id to revoke")
    .requiredOption("--actor <id>", "Operator actor id for audit")
    .option("--json", "Print JSON output")
    .action((options: OperatorEntitlementOptions) => {
      mutateState(options, (state) =>
        revokeOperatorEntitlement(state, {
          accessId: options.accessId,
          actorId: options.actor,
          listingId: options.listingId,
        }),
      )
    })

  const commerceCommand = operatorCommand
    .command("commerce")
    .description("Inspect manual closed-alpha commerce state")
  commerceCommand
    .command("inspect")
    .description("Inspect redacted entitlement state for a listing")
    .requiredOption("--state <path>", "Operator access state JSON path")
    .requiredOption("--listing-id <id>", "Listing id to inspect")
    .option("--json", "Print JSON output")
    .action((options: OperatorListingOptions) => {
      printJson(
        inspectOperatorCommerce(readRegistryOperatorState(options.state), options.listingId),
      )
    })
}
