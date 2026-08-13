import { isAbsolute } from "node:path";

import {
  exportAtfToTrl,
  TrlExportError,
  TrlExportErrorCode,
  type TrlExportResult,
} from "@/training/trl-export";

export type DatasetCommand = Readonly<{
  command: "trl";
  inputPath: string;
  outputPath: string;
}>;

export class DatasetRequestError extends TrlExportError {
  constructor() {
    super(TrlExportErrorCode.InvalidDatasetRequest);
    this.name = "DatasetRequestError";
  }
}

const invalid = (): never => {
  throw new DatasetRequestError();
};

export const isDatasetInvocation = (argumentsList: readonly string[]): boolean =>
  argumentsList[0] === "dataset" ||
  (argumentsList[0] === "trajectory" && argumentsList[1] === "dataset");

export const datasetHelpText =
  "Usage: trajectory dataset trl --input <absolute-atf-json> --out <absolute-jsonl>\n\nConvert one credential-redacted ATF v2 trajectory into one Hugging Face TRL conversational JSONL training example.";

export const isDatasetHelpInvocation = (argumentsList: readonly string[]): boolean => {
  const args = argumentsList[0] === "trajectory" ? argumentsList.slice(1) : argumentsList;
  return args.length === 3 && args[0] === "dataset" && args[1] === "trl" && args[2] === "--help";
};

export const parseDatasetCommand = (argumentsList: readonly string[]): DatasetCommand => {
  const args = argumentsList[0] === "trajectory" ? argumentsList.slice(1) : argumentsList;
  if (args[0] !== "dataset" || args[1] !== "trl") return invalid();
  const values: Record<string, string> = {};
  for (let index = 2; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (
      (option !== "--input" && option !== "--out") ||
      value === undefined ||
      value.startsWith("--") ||
      option in values
    ) {
      return invalid();
    }
    values[option] = value;
  }
  const inputPath = values["--input"];
  const outputPath = values["--out"];
  if (
    inputPath === undefined ||
    outputPath === undefined ||
    !isAbsolute(inputPath) ||
    !isAbsolute(outputPath) ||
    inputPath === outputPath
  ) {
    return invalid();
  }
  return { command: "trl", inputPath, outputPath };
};

export const runDatasetCli = (argumentsList: readonly string[]): TrlExportResult => {
  const command = parseDatasetCommand(argumentsList);
  return exportAtfToTrl({
    inputPath: command.inputPath,
    outputPath: command.outputPath,
  });
};
