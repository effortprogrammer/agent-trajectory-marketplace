import { existsSync, realpathSync, statSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve } from "node:path"

type PathErrorThrower<TCode extends string> = (code: TCode, path: string) => never

type ProjectPathInput<TCode extends string> = Readonly<{
  code: TCode
  inputPath: string
  throwPathError: PathErrorThrower<TCode>
}>

const isWithinRoot = (candidatePath: string, rootPath: string) => {
  const relativePath = relative(rootPath, candidatePath)
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

const assertWithinProjectRoot = <TCode extends string>(
  candidatePath: string,
  projectRoot: string,
  code: TCode,
  throwPathError: PathErrorThrower<TCode>,
) => {
  if (!isWithinRoot(candidatePath, projectRoot)) {
    throwPathError(code, candidatePath)
  }
}

const readRealPath = <TCode extends string>(
  path: string,
  code: TCode,
  throwPathError: PathErrorThrower<TCode>,
): string => {
  try {
    return realpathSync(path)
  } catch {
    throwPathError(code, path)
  }
}

const findExistingAncestor = (path: string) => {
  let currentPath = path
  while (!existsSync(currentPath)) {
    const parentPath = dirname(currentPath)
    if (parentPath === currentPath) {
      return currentPath
    }
    currentPath = parentPath
  }
  return currentPath
}

const projectRoots = <TCode extends string>(
  code: TCode,
  throwPathError: PathErrorThrower<TCode>,
) => {
  const lexicalProjectRoot = resolve(process.cwd())
  return {
    lexicalProjectRoot,
    realProjectRoot: readRealPath(lexicalProjectRoot, code, throwPathError),
  }
}

export const resolveReadableProjectPath = <TCode extends string>({
  code,
  inputPath,
  throwPathError,
}: ProjectPathInput<TCode>) => {
  const { lexicalProjectRoot, realProjectRoot } = projectRoots(code, throwPathError)
  const absolutePath = resolve(inputPath)

  assertWithinProjectRoot(absolutePath, lexicalProjectRoot, code, throwPathError)
  if (existsSync(absolutePath)) {
    assertWithinProjectRoot(
      readRealPath(absolutePath, code, throwPathError),
      realProjectRoot,
      code,
      throwPathError,
    )
  }

  return absolutePath
}

export const resolveWritableProjectPath = <TCode extends string>({
  code,
  inputPath,
  throwPathError,
}: ProjectPathInput<TCode>) => {
  const { lexicalProjectRoot, realProjectRoot } = projectRoots(code, throwPathError)
  const absolutePath = resolve(inputPath)

  assertWithinProjectRoot(absolutePath, lexicalProjectRoot, code, throwPathError)

  const existingAncestor = findExistingAncestor(absolutePath)
  if (existingAncestor !== absolutePath && !statSync(existingAncestor).isDirectory()) {
    throwPathError(code, absolutePath)
  }

  const realAncestor = readRealPath(existingAncestor, code, throwPathError)
  assertWithinProjectRoot(realAncestor, realProjectRoot, code, throwPathError)
  const realizedPath = resolve(realAncestor, relative(existingAncestor, absolutePath))
  assertWithinProjectRoot(realizedPath, realProjectRoot, code, throwPathError)

  return absolutePath
}
