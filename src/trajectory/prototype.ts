import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path"

import { z } from "zod"

import { renderPythonDemoRunner } from "./runner-template"
import {
  renderInitReadme,
  renderPatternYaml,
  renderPythonBootstrap,
  renderPythonCore,
  renderPythonFixture,
  renderPythonPackageInit,
} from "./workspace-templates"

const runtimeSchema = z.enum(["hermes", "openclaw"])

const workspaceInputSchema = z.object({
  runtime: runtimeSchema,
  workspace: z.string().min(1),
})

const demoInputSchema = workspaceInputSchema.extend({
  exportPath: z.string().min(1),
  patternPath: z.string().min(1).optional(),
})

const demoSummarySchema = z.object({
  status: z.string().min(1),
  exportPath: z.string().min(1),
  sqlitePath: z.string().min(1),
  targetResult: z.string().min(1),
  eventCount: z.number().int().nonnegative(),
})

type TrajectoryRuntime = z.infer<typeof runtimeSchema>

type PrototypeWorkspacePaths = Readonly<{
  workspace: string
  artifactsDir: string
  defaultPatternPath: string
  mismatchPatternPath: string
  runDemoPath: string
}>

type PrototypeInitResult = Readonly<{
  runtime: TrajectoryRuntime
  workspace: string
  createdFiles: readonly string[]
}>

type PrototypeDemoResult = z.infer<typeof demoSummarySchema>

const TrajectoryPrototypeErrorCode = {
  InvalidExportPath: "invalid_export_path",
  MissingPython: "missing_python",
  MissingPattern: "missing_pattern",
  DemoFailed: "demo_failed",
} as const

type TrajectoryPrototypeErrorCode =
  (typeof TrajectoryPrototypeErrorCode)[keyof typeof TrajectoryPrototypeErrorCode]

export class TrajectoryPrototypeError extends Error {
  readonly code: TrajectoryPrototypeErrorCode

  constructor(code: TrajectoryPrototypeErrorCode, message: string) {
    super(message)
    this.name = "TrajectoryPrototypeError"
    this.code = code
  }
}

const resolveWorkspacePaths = (
  workspace: string,
  runtime: TrajectoryRuntime,
): PrototypeWorkspacePaths => {
  const absoluteWorkspace = resolve(workspace)
  return {
    workspace: absoluteWorkspace,
    artifactsDir: join(absoluteWorkspace, "artifacts"),
    defaultPatternPath: join(absoluteWorkspace, "patterns", runtime, "dev.yaml"),
    mismatchPatternPath: join(absoluteWorkspace, "patterns", runtime, "mismatch.yaml"),
    runDemoPath: join(absoluteWorkspace, "run_demo.py"),
  }
}

const ensureParentDir = (path: string) => {
  mkdirSync(dirname(path), { recursive: true })
}

const writeTextFile = (path: string, content: string) => {
  ensureParentDir(path)
  writeFileSync(path, content, "utf8")
}

const isWithinRoot = (candidatePath: string, rootPath: string) => {
  const relativePath = relative(rootPath, candidatePath)
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

const assertAllowedExportPath = (workspacePath: string, exportPath: string) => {
  const allowedWorkspaceRoot = resolve(workspacePath)
  const allowedEvidenceRoot = resolve(process.cwd(), ".omo", "evidence")

  if (
    isWithinRoot(exportPath, allowedWorkspaceRoot) ||
    isWithinRoot(exportPath, allowedEvidenceRoot)
  ) {
    return
  }

  throw new TrajectoryPrototypeError(
    TrajectoryPrototypeErrorCode.InvalidExportPath,
    `invalid_export_path: ${exportPath}`,
  )
}

const detectPythonCommand = (): "python3" | "python" => {
  const python3Result = spawnSync("python3", ["--version"], { stdio: "ignore" })
  if (python3Result.status === 0) {
    return "python3"
  }

  const pythonResult = spawnSync("python", ["--version"], { stdio: "ignore" })
  if (pythonResult.status === 0) {
    return "python"
  }

  throw new TrajectoryPrototypeError(
    TrajectoryPrototypeErrorCode.MissingPython,
    "Python 3 is required for the trajectory prototype demo",
  )
}

export const initPrototypeWorkspace = (input: {
  readonly runtime: string
  readonly workspace: string
}): PrototypeInitResult => {
  const parsed = workspaceInputSchema.parse(input)
  const paths = resolveWorkspacePaths(parsed.workspace, parsed.runtime)

  mkdirSync(paths.workspace, { recursive: true })
  mkdirSync(paths.artifactsDir, { recursive: true })

  const files = {
    readme: join(paths.workspace, "README.md"),
    packageInit: join(paths.workspace, "trajectory_collector", "__init__.py"),
    core: join(paths.workspace, "trajectory_collector", "core.py"),
    bootstrap: join(paths.workspace, "trajectory_collector", "bootstrap.py"),
    fixture: join(paths.workspace, "fixtures", "demo_target.py"),
    demoRunner: paths.runDemoPath,
    defaultPattern: paths.defaultPatternPath,
    mismatchPattern: paths.mismatchPatternPath,
  } as const

  writeTextFile(files.readme, renderInitReadme(parsed.runtime))
  writeTextFile(files.packageInit, renderPythonPackageInit())
  writeTextFile(files.core, renderPythonCore())
  writeTextFile(files.bootstrap, renderPythonBootstrap())
  writeTextFile(files.fixture, renderPythonFixture(parsed.runtime))
  writeTextFile(files.demoRunner, renderPythonDemoRunner())
  writeTextFile(files.defaultPattern, renderPatternYaml(parsed.runtime, "run_demo_task"))
  writeTextFile(files.mismatchPattern, renderPatternYaml(parsed.runtime, "missing_function"))

  return {
    runtime: parsed.runtime,
    workspace: paths.workspace,
    createdFiles: Object.values(files),
  }
}

export const runPrototypeDemo = (input: {
  readonly runtime: string
  readonly workspace: string
  readonly exportPath: string
  readonly patternPath?: string
}): PrototypeDemoResult => {
  const parsed = demoInputSchema.parse(input)
  const paths = resolveWorkspacePaths(parsed.workspace, parsed.runtime)
  const pythonCommand = detectPythonCommand()
  const exportPath = resolve(parsed.exportPath)
  const patternPath = resolve(parsed.patternPath ?? paths.defaultPatternPath)
  const sqlitePath = join(
    paths.artifactsDir,
    `${basename(exportPath, extname(exportPath)) || "trace"}.sqlite3`,
  )
  const runnerDir = mkdtempSync(join(tmpdir(), "trajectory-marketplace-runner-"))
  const trustedRunnerPath = join(runnerDir, "trusted-runner.py")
  const { PATH = "", HOME = "", LANG = "en_US.UTF-8" } = process.env

  if (!existsSync(patternPath)) {
    throw new TrajectoryPrototypeError(
      TrajectoryPrototypeErrorCode.MissingPattern,
      `Trajectory pattern not found at ${patternPath}`,
    )
  }

  assertAllowedExportPath(paths.workspace, exportPath)
  writeTextFile(trustedRunnerPath, renderPythonDemoRunner())
  rmSync(sqlitePath, { force: true })

  try {
    const result = spawnSync(pythonCommand, [trustedRunnerPath], {
      cwd: paths.workspace,
      encoding: "utf8",
      env: {
        PATH,
        HOME,
        LANG,
        TRAJECTORY_RUNTIME: parsed.runtime,
        TRAJECTORY_PATTERN_PATH: patternPath,
        TRAJECTORY_EXPORT_PATH: exportPath,
        TRAJECTORY_SQLITE_PATH: sqlitePath,
      },
    })

    if (result.status !== 0) {
      const stderr = result.stderr.trim()
      const stdout = result.stdout.trim()
      throw new TrajectoryPrototypeError(
        TrajectoryPrototypeErrorCode.DemoFailed,
        `Trajectory demo failed (exit ${result.status ?? "unknown"}). stdout=${stdout || "(empty)"} stderr=${stderr || "(empty)"}`,
      )
    }

    const rawSummary: unknown = JSON.parse(result.stdout)
    return demoSummarySchema.parse(rawSummary)
  } finally {
    rmSync(runnerDir, { force: true, recursive: true })
  }
}
