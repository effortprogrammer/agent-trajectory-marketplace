#!/usr/bin/env bun

import packageJson from "../../package.json";
import {
  captureCollectorError,
  captureCollectorInstalled,
  captureDailyCollectorHeartbeat,
  resolveCollectorTelemetryConfig,
  sendCollectorTelemetry,
} from "@/trajectory/telemetry";
import { runUpdateCli } from "@/trajectory/update-cli";
import { installUpdateServiceSchedule } from "@/trajectory/update-service-schedule";

import { parseCollectorCommand, runCollectorCli, runCollectorResidentCli, type CollectorCommand } from "./collector";
import { runDefaultDoctorCli } from "./doctor";
import { isAuthInvocation, runAuthCli } from "./auth";
import { isMarketplaceInvocation, runMarketplaceCli } from "./marketplace";
import { maybePrintCliUpdateNotice } from "./update-notice";
import { isWorldInvocation, runWorldCli } from "./world";

const rootHelp = `Usage: trajectory <command>

Commands:
  collect runtimes|sessions|export|watch|service|telemetry
  auth signup|login|verify|status|logout
  marketplace seller sessions list
  marketplace seller sessions inspect
  marketplace seller sessions choose
  marketplace seller candidate bundle
  marketplace seller candidate publish
  marketplace seller candidate status
  marketplace seller wallet balance
  world --help|list|detail|run|status|download
  doctor
  update

Run a command with --help for command-specific usage.`;

const doctorHelp = `Usage: trajectory doctor

Checks the installed CLI, Bun runtime, and latest stable release.
Returns machine-readable JSON.`;

const updateHelp = `Usage: trajectory update

Install the latest verified stable release.`;

const isCommandHelp = (
  argumentsList: readonly string[],
  command: "doctor" | "update",
): boolean =>
  (
    argumentsList.length === 2 &&
    argumentsList[0] === command &&
    (argumentsList[1] === "--help" || argumentsList[1] === "-h")
  ) ||
  (
    argumentsList.length === 3 &&
    argumentsList[0] === "trajectory" &&
    argumentsList[1] === command &&
    (argumentsList[2] === "--help" || argumentsList[2] === "-h")
  );

const isNamedInvocation = (
  argumentsList: readonly string[],
  command: "doctor" | "update",
): boolean =>
  argumentsList[0] === command ||
  (argumentsList[0] === "trajectory" && argumentsList[1] === command);

const collectorErrorCode = (error: unknown): string => {
  if (error instanceof Error && "code" in error && typeof error.code === "string") return error.code;
  return error instanceof Error ? error.message : "collector_failed";
};

const telemetryOutDir = (command: CollectorCommand): string | undefined => {
  switch (command.command) {
    case "telemetry":
      return command.outDir;
    case "watch":
      return command.outDir ?? command.outputRoot;
    case "service":
      return command.verb === "install" ? command.outDir ?? command.outputRoot : undefined;
    case "export":
    case "runtimes":
    case "sessions":
      return undefined;
  }
};

const captureTelemetryError = async (command: CollectorCommand | undefined, errorCode: string): Promise<void> => {
  if (command === undefined) return;
  const outDir = telemetryOutDir(command);
  const configuration = resolveCollectorTelemetryConfig();
  if (outDir === undefined || configuration === undefined) return;
  await captureCollectorError({
    configuration,
    errorCode,
    now: new Date(),
    outDir,
    send: (payload) => sendCollectorTelemetry(configuration, payload),
    version: packageJson.version,
  });
};

const captureTelemetryHeartbeat = async (command: CollectorCommand, summary: Parameters<typeof captureDailyCollectorHeartbeat>[0]["summary"]): Promise<void> => {
  const outDir = telemetryOutDir(command);
  const configuration = resolveCollectorTelemetryConfig();
  if (outDir === undefined || configuration === undefined) return;
  await captureDailyCollectorHeartbeat({
    configuration,
    now: new Date(),
    outDir,
    send: (payload) => sendCollectorTelemetry(configuration, payload),
    summary,
    version: packageJson.version,
  });
};

const captureTelemetryInstallation = async (command: CollectorCommand): Promise<Readonly<{ captured: boolean }>> => {
  const configuration = resolveCollectorTelemetryConfig();
  if (command.command !== "telemetry" || configuration === undefined) return { captured: false };
  return captureCollectorInstalled({
    configuration,
    now: new Date(),
    outDir: command.outDir,
    send: (payload) => sendCollectorTelemetry(configuration, payload),
    version: packageJson.version,
  });
};

const main = async (): Promise<void> => {
  const argumentsList = process.argv.slice(2);
  const commandAbortController = new AbortController();
  let running = true;
  let command: CollectorCommand | undefined;
  const stop = (): void => {
    running = false;
    if (!commandAbortController.signal.aborted) commandAbortController.abort();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    if (argumentsList.length === 1 && (argumentsList[0] === "--help" || argumentsList[0] === "-h")) {
      console.log(rootHelp);
      return;
    }
    if (isCommandHelp(argumentsList, "doctor")) {
      console.log(doctorHelp);
      return;
    }
    if (isCommandHelp(argumentsList, "update")) {
      console.log(updateHelp);
      return;
    }
    if (
      argumentsList.length === 6 &&
      argumentsList[0] === "trajectory" &&
      argumentsList[1] === "update" &&
      argumentsList[2] === "service" &&
      argumentsList[3] === "install" &&
      argumentsList[4] === "--state-root"
    ) {
      const schedule = installUpdateServiceSchedule({ stateRoot: argumentsList[5] ?? "" });
      console.log(JSON.stringify(schedule));
      if (!schedule.installed) process.exitCode = 1;
      return;
    }
    const updateInvocation = isNamedInvocation(argumentsList, "update");
    if (updateInvocation) {
      console.log(JSON.stringify(await runUpdateCli(argumentsList)));
      return;
    }
    const doctorInvocation = isNamedInvocation(argumentsList, "doctor");
    if (doctorInvocation) {
      const result = await runDefaultDoctorCli(
        argumentsList,
        commandAbortController.signal,
      );
      if (!commandAbortController.signal.aborted) {
        console.log(JSON.stringify(result));
      }
      return;
    }
    if (isAuthInvocation(argumentsList)) {
      await runAuthCli(argumentsList, commandAbortController.signal);
      return;
    }
    if (isMarketplaceInvocation(argumentsList)) {
      await runMarketplaceCli(argumentsList, commandAbortController.signal);
      return;
    }
    if (isWorldInvocation(argumentsList)) {
      await runWorldCli(argumentsList, commandAbortController.signal);
      return;
    }
    command = parseCollectorCommand(argumentsList);
    const parsedCommand = command;
    if (parsedCommand.command === "telemetry") {
      console.log(JSON.stringify(await captureTelemetryInstallation(parsedCommand)));
      return;
    }
    if (parsedCommand.command === "watch" && !parsedCommand.once) {
      await runCollectorResidentCli(
        argumentsList,
        async (summary) => {
          await captureTelemetryHeartbeat(parsedCommand, summary);
          console.log(JSON.stringify(summary));
        },
        () => running,
      );
    } else {
      const result = runCollectorCli(argumentsList);
      if (parsedCommand.command === "watch" && "exported" in result) {
        await captureTelemetryHeartbeat(parsedCommand, result);
      }
      console.log(JSON.stringify(result));
    }
  } catch (error: unknown) { // no-excuse-ok: catch — CLI boundary serializes all failures.
    const errorCode = collectorErrorCode(error);
    await captureTelemetryError(command, errorCode);
    console.error(JSON.stringify({ error: errorCode }));
    process.exitCode = 1;
  } finally {
    await maybePrintCliUpdateNotice(
      argumentsList,
      commandAbortController.signal,
      process.exitCode,
    );
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
};

void main();
