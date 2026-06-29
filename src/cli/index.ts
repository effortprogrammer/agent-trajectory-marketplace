#!/usr/bin/env bun

import { Command } from "commander"

import { registerTrajectoryCommand } from "./trajectory"

const program = new Command()

program
  .name("trajectory-marketplace")
  .description("Agent Trajectory Marketplace CLI")
  .version("0.1.0")

program
  .command("health")
  .description("Print CLI readiness")
  .action(() => {
    console.log("trajectory-marketplace cli ready")
  })

registerTrajectoryCommand(program)

await program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message)
  } else {
    console.error("Unknown CLI failure")
  }
  process.exitCode = 1
})
