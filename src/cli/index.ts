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
import { isAuthInvocation, runAuthCli } from "./auth";
import { datasetHelpText, isDatasetHelpInvocation, isDatasetInvocation, runDatasetCli } from "./dataset";
import { isMarketplaceInvocation, runMarketplaceCli } from "./marketplace";

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
    const updateInvocation = argumentsList[0] === "update" ||
      (argumentsList[0] === "trajectory" && argumentsList[1] === "update");
    if (updateInvocation) {
      console.log(JSON.stringify(await runUpdateCli(argumentsList)));
      return;
    }
    if (isAuthInvocation(argumentsList)) {
      await runAuthCli(argumentsList, commandAbortController.signal);
      return;
    }
    if (isDatasetInvocation(argumentsList)) {
      if (isDatasetHelpInvocation(argumentsList)) {
        console.log(datasetHelpText);
        return;
      }
      console.log(JSON.stringify(runDatasetCli(argumentsList)));
      return;
    }
    if (isMarketplaceInvocation(argumentsList)) {
      await runMarketplaceCli(argumentsList, commandAbortController.signal);
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
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
};

void main();
